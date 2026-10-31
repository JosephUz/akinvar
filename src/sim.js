// Akın Var — savaş simülasyonu. Tarayıcıdan bağımsız, tohumlu ve belirlenimci: aynı tohum ve aynı emirler aynı savaşı verir.
// İki katman: bölük (emir, yürüyüş, hedef, çatışma) ve asker (yuvasını izler, yakın dövüşte hedef seçer, vurur).
// Asker verisi düz dizilerde tutulur; 10 binlerce asker için nesne oluşturulmaz.
import { TICK, BOLUK, SPACING, BOLUK_GAP, SOLDIER, ENGAGE, RETARGET, VISION, AUTO_RANGE, ZONE, MAX_SOLDIERS } from './config.js';

export const PER_BOLUK = BOLUK.cols * BOLUK.rows;
export const BOLUK_W = BOLUK.cols * SPACING + BOLUK_GAP;
export const BOLUK_D = BOLUK.rows * SPACING + BOLUK_GAP * 1.5;
const CELL = 2;        // itme ve hedef arama ızgarası
export const VCELL = 3; // görüş (sis) ızgarası
const ORDER = { none: 0, move: 1, attack: 2 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * İki takım, her biri `soldiers / 2` asker. Ordular çember arenanın karşılıklı kenarlarında, merkeze bakar.
 * `human`: hangi takımları oyuncu yönetir (emirsiz bölükleri yerinde bekler); ötekiler botun yapay zekasıyla oynar.
 */
export function createBattle({ soldiers = 2000, seed = 1, human = [true, false] } = {}) {
  const perTeam = Math.max(1, Math.ceil(Math.min(soldiers, MAX_SOLDIERS) / 2 / PER_BOLUK));
  const B = perTeam * 2, N = B * PER_BOLUK;
  const rng = mulberry32(seed);

  const w = {
    t: 0, tick: 0, seed, rng, N, B, winner: -1, human,
    // asker
    x: new Float32Array(N), z: new Float32Array(N), px: new Float32Array(N), pz: new Float32Array(N),
    face: new Float32Array(N), hp: new Int8Array(N), team: new Uint8Array(N), boluk: new Int32Array(N),
    slot: new Int16Array(N), target: new Int32Array(N).fill(-1), cd: new Float32Array(N),
    swing: new Float32Array(N), diedAt: new Float32Array(N).fill(-1), zoneT: new Float32Array(N),
    // bölük
    bx: new Float32Array(B), bz: new Float32Array(B), bface: new Float32Array(B), bteam: new Uint8Array(B),
    bkind: new Uint8Array(B), btarget: new Int32Array(B).fill(-1), bengaged: new Uint8Array(B), balive: new Int16Array(B),
    cx: new Float32Array(B), cz: new Float32Array(B),
    border: new Uint8Array(B), otarget: new Int32Array(B).fill(-1), oface: new Float32Array(B),
    goal: new Uint8Array(B), gx: new Float32Array(B), gz: new Float32Array(B), offx: new Float32Array(B), offz: new Float32Array(B),
    alive: [0, 0], radius: 0, zone: 0,
  };

  // Dizilim: her ordu önde geniş bir cephe, arkada saflar; merkeze bakar. Mavi batıda, Kırmızı doğuda.
  const perLine = Math.min(perTeam, Math.max(4, Math.ceil(Math.sqrt(perTeam) * 2.2)));
  const lines = Math.ceil(perTeam / perLine), depth = lines * BOLUK_D;
  w.radius = Math.max(85, perLine * BOLUK_W * 0.62 + 20, depth + 60);
  w.zone = w.radius;
  const D = w.radius - depth / 2 - 12;
  for (let b = 0; b < B; b++) {
    const team = b < perTeam ? 0 : 1, k = b % perTeam, line = Math.floor(k / perLine), col = k % perLine;
    const sign = team === 0 ? -1 : 1, inLine = Math.min(perLine, perTeam - line * perLine);
    w.bteam[b] = team;
    w.bkind[b] = line % 2;           // şimdilik ön saflar mızraklı, arkadakiler kılıçlı
    w.bface[b] = w.oface[b] = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    w.bx[b] = sign * (D - depth / 2 + line * BOLUK_D + BOLUK_D / 2);
    w.bz[b] = (col - (inLine - 1) / 2) * BOLUK_W * -sign;
    w.offx[b] = w.bx[b] - sign * D; w.offz[b] = w.bz[b];
    w.cx[b] = w.bx[b]; w.cz[b] = w.bz[b];
    w.balive[b] = PER_BOLUK;
    for (let s = 0; s < PER_BOLUK; s++) {
      const i = b * PER_BOLUK + s;
      w.team[i] = team; w.boluk[i] = b; w.slot[i] = s; w.hp[i] = SOLDIER.hp; w.face[i] = w.bface[b];
      const p = slotPos(w, b, s);
      w.x[i] = w.px[i] = p.x + (rng() - 0.5) * 0.2;
      w.z[i] = w.pz[i] = p.z + (rng() - 0.5) * 0.2;
      w.cd[i] = rng();
    }
  }
  w.alive = [perTeam * PER_BOLUK, perTeam * PER_BOLUK];

  const span = Math.ceil((w.radius * 2) / CELL) + 2;
  w.grid = { span, off: w.radius + CELL, head: new Int32Array(span * span), next: new Int32Array(N) };
  const vs = Math.ceil((w.radius * 2) / VCELL) + 2;
  w.vgrid = { span: vs, off: w.radius + VCELL };
  w.vis = [new Uint8Array(vs * vs), new Uint8Array(vs * vs)];
  updateVision(w);
  return w;
}

// Yuva: ön sıra 0, sütunlar bölüğün sağından soluna. İleri yön (sin f, cos f).
function slotPos(w, b, s) {
  const c = s % BOLUK.cols, r = Math.floor(s / BOLUK.cols), f = w.bface[b];
  const lx = (c - (BOLUK.cols - 1) / 2) * SPACING, lz = ((BOLUK.rows - 1) / 2 - r) * SPACING;
  const sf = Math.sin(f), cf = Math.cos(f);
  return { x: w.bx[b] + cf * lx + sf * lz, z: w.bz[b] - sf * lx + cf * lz };
}

function buildGrid(w) {
  const { head, next, span, off } = w.grid;
  head.fill(-1);
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const gx = Math.min(span - 1, Math.max(0, Math.floor((w.x[i] + off) / CELL)));
    const gz = Math.min(span - 1, Math.max(0, Math.floor((w.z[i] + off) / CELL)));
    const c = gz * span + gx;
    next[i] = head[c]; head[c] = i;
  }
}

function nearestEnemy(w, i, range) {
  const { head, next, span, off } = w.grid;
  const x = w.x[i], z = w.z[i], team = w.team[i], r = Math.ceil(range / CELL);
  const gx = Math.floor((x + off) / CELL), gz = Math.floor((z + off) / CELL);
  let best = -1, bestD = range * range;
  for (let cz = Math.max(0, gz - r); cz <= Math.min(span - 1, gz + r); cz++)
    for (let cx = Math.max(0, gx - r); cx <= Math.min(span - 1, gx + r); cx++)
      for (let j = head[cz * span + cx]; j !== -1; j = next[j]) {
        if (w.team[j] === team) continue;
        const dx = w.x[j] - x, dz = w.z[j] - z, d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
  return best;
}

// Görüş: her canlı askerin çevresi. Ayrık askerler (kovalayan, kaçan) da görür.
// Önce bölük merkezinden geniş daire, sonra merkezden uzaklaşmış askerler için küçük daire.
function updateVision(w) {
  const { span, off } = w.vgrid, r = Math.ceil(VISION / VCELL), r2 = (VISION / VCELL) ** 2;
  for (const v of w.vis) v.fill(0);
  const mark = (team, x, z, rr, rr2) => {
    const v = w.vis[team], gx = Math.floor((x + off) / VCELL), gz = Math.floor((z + off) / VCELL);
    for (let dz = -rr; dz <= rr; dz++) {
      const cz = gz + dz; if (cz < 0 || cz >= span) continue;
      for (let dx = -rr; dx <= rr; dx++) {
        const cx = gx + dx; if (cx < 0 || cx >= span || dx * dx + dz * dz > rr2) continue;
        v[cz * span + cx] = 1;
      }
    }
  };
  for (let b = 0; b < w.B; b++) if (w.balive[b]) mark(w.bteam[b], w.cx[b], w.cz[b], r, r2);
  const sr = Math.ceil(r / 2), sr2 = r2 / 4, far2 = (VISION / 2) ** 2;
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i];
    if ((w.x[i] - w.cx[b]) ** 2 + (w.z[i] - w.cz[b]) ** 2 > far2) mark(w.team[i], w.x[i], w.z[i], sr, sr2);
  }
}

export function visibleTo(w, team, x, z) {
  const { span, off } = w.vgrid;
  const gx = Math.floor((x + off) / VCELL), gz = Math.floor((z + off) / VCELL);
  if (gx < 0 || gz < 0 || gx >= span || gz >= span) return false;
  return w.vis[team][gz * span + gx] === 1;
}

// Bölük merkezleri, yuvaların sıkışması, emirsiz bölüklerin hedefi. Saniyede bir.
function retarget(w) {
  w.balive.fill(0);
  const cx = w.cx, cz = w.cz;
  cx.fill(0); cz.fill(0);
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i];
    w.slot[i] = w.balive[b]++;
    cx[b] += w.x[i]; cz[b] += w.z[i];
  }
  for (let b = 0; b < w.B; b++) if (w.balive[b]) { cx[b] /= w.balive[b]; cz[b] /= w.balive[b]; }

  for (let b = 0; b < w.B; b++) {
    if (!w.balive[b]) { w.btarget[b] = -1; w.border[b] = ORDER.none; continue; }
    const team = w.bteam[b];
    if (w.bengaged[b]) { w.bx[b] = cx[b]; w.bz[b] = cz[b]; }
    if (w.border[b] === ORDER.attack) {
      const o = w.otarget[b];
      if (o >= 0 && w.balive[o]) { w.btarget[b] = o; continue; }
      w.border[b] = ORDER.none;
    }
    if (w.border[b] === ORDER.move) { w.btarget[b] = -1; continue; }

    // Emirsiz: görünen en yakın düşman bölüğü. Oyuncunun bölükleri yalnız yakındakine kendiliğinden gider.
    const limit = w.human[team] ? AUTO_RANGE * AUTO_RANGE : Infinity;
    let best = -1, bestD = limit;
    for (let o = 0; o < w.B; o++) {
      if (!w.balive[o] || w.bteam[o] === team || !visibleTo(w, team, cx[o], cz[o])) continue;
      const dx = cx[o] - cx[b], dz = cz[o] - cz[b], d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    w.btarget[b] = best;
    if (best >= 0) { w.goal[b] = 0; continue; }

    // Düşman görünmüyor: bot ordusu dizilişini bozmadan merkeze yürür (alan daralırsa daha da sıkışır).
    const zr = w.zone, dist = Math.hypot(w.bx[b], w.bz[b]);
    if (!w.human[team]) {
      const k = Math.min(0.6, (zr * 0.5) / (Math.hypot(w.offx[b], w.offz[b]) + 1));
      w.goal[b] = 1; w.gx[b] = w.offx[b] * k; w.gz[b] = w.offz[b] * k;
    } else if (dist > zr - 4) {
      // Oyuncunun emirsiz bölüğü alanın dışında kalmaya başlarsa içeri çekilir.
      const k = Math.max(0, zr - 10) / (dist || 1);
      w.goal[b] = 1; w.gx[b] = w.bx[b] * k; w.gz[b] = w.bz[b] * k;
    }
  }
}

/**
 * Oyuncu emri. `list`: bölük numaraları (o takımın).
 * move: {x, z} — bölükler hedefin çevresinde, yürüyüş yönüne dik saflar halinde dizilir.
 * attack: {target} — düşman bölüğü. stop: emirleri bırak, yakındaki düşmana kendiliğinden saldır.
 */
export function command(w, team, list, cmd) {
  list = list.filter((b) => w.bteam[b] === team && w.balive[b]);
  if (!list.length) return;
  if (cmd.type === 'stop') {
    for (const b of list) { w.border[b] = ORDER.none; w.goal[b] = 0; w.btarget[b] = -1; w.bx[b] = w.cx[b]; w.bz[b] = w.cz[b]; }
    return;
  }
  if (cmd.type === 'attack') {
    if (!w.balive[cmd.target] || w.bteam[cmd.target] === team) return;
    for (const b of list) { w.border[b] = ORDER.attack; w.otarget[b] = cmd.target; w.btarget[b] = cmd.target; w.goal[b] = 0; }
    return;
  }
  // move
  let mx = 0, mz = 0;
  for (const b of list) { mx += w.cx[b]; mz += w.cz[b]; }
  mx /= list.length; mz /= list.length;
  const dx = cmd.x - mx, dz = cmd.z - mz;
  const f = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz) : w.bface[list[0]];
  const sf = Math.sin(f), cf = Math.cos(f);
  const n = list.length, perRow = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 2.5))));
  // Öndekiler öne, soldakiler sola: yollar kesişmesin.
  const fwd = (b) => w.cx[b] * sf + w.cz[b] * cf, lat = (b) => w.cx[b] * cf - w.cz[b] * sf;
  const sorted = [...list].sort((a, b) => fwd(b) - fwd(a));
  for (let r = 0; r * perRow < n; r++) {
    const row = sorted.slice(r * perRow, (r + 1) * perRow).sort((a, b) => lat(a) - lat(b));
    row.forEach((b, c) => {
      const lx = (c - (row.length - 1) / 2) * BOLUK_W, lz = -r * BOLUK_D;
      w.gx[b] = cmd.x + cf * lx + sf * lz; w.gz[b] = cmd.z - sf * lx + cf * lz;
      w.goal[b] = 1; w.border[b] = ORDER.move; w.oface[b] = f; w.btarget[b] = -1; w.bengaged[b] = 0;
      w.bx[b] = w.cx[b]; w.bz[b] = w.cz[b]; // yürüyüş askerlerin şimdiki ortasından başlar
    });
  }
}

export function step(w) {
  const dt = TICK, rng = w.rng;
  w.px.set(w.x); w.pz.set(w.z);
  w.zone = w.t < ZONE.wait ? w.radius : Math.max(0, w.radius * (1 - (w.t - ZONE.wait) / ZONE.shrink));
  if (w.tick % Math.round(RETARGET / TICK) === 0) retarget(w);
  if (w.tick % 5 === 0) updateVision(w);

  // Bölükler: hedef bölüğe yürür ve yaklaşınca çatışır; yoksa yürüyüş noktasına gider.
  const walk = SOLDIER.walk * dt;
  for (let b = 0; b < w.B; b++) {
    if (!w.balive[b]) { w.bengaged[b] = 0; continue; }
    const o = w.btarget[b];
    if (o >= 0) {
      const dx = w.cx[o] - w.bx[b], dz = w.cz[o] - w.bz[b], d = Math.hypot(dx, dz);
      if (d > ENGAGE) {
        w.bengaged[b] = 0; w.bface[b] = Math.atan2(dx, dz);
        const v = Math.min(walk, d - ENGAGE);
        w.bx[b] += (dx / d) * v; w.bz[b] += (dz / d) * v;
      } else w.bengaged[b] = 1;
    } else {
      w.bengaged[b] = 0;
      if (!w.goal[b]) continue;
      const dx = w.gx[b] - w.bx[b], dz = w.gz[b] - w.bz[b], d = Math.hypot(dx, dz);
      if (d < 0.3) {
        w.goal[b] = 0;
        if (w.border[b] === ORDER.move) { w.border[b] = ORDER.none; w.bface[b] = w.oface[b]; }
        continue;
      }
      if (d > 2) w.bface[b] = Math.atan2(dx, dz);
      else if (w.border[b] === ORDER.move) w.bface[b] = w.oface[b];
      const v = Math.min(walk, d);
      w.bx[b] += (dx / d) * v; w.bz[b] += (dz / d) * v;
    }
  }

  buildGrid(w);
  const { head, next, span, off } = w.grid;
  const run = SOLDIER.run * dt, R2 = (SOLDIER.radius * 2) ** 2, zone2 = w.zone * w.zone;
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i];
    w.cd[i] -= dt; if (w.swing[i] > 0) w.swing[i] -= dt;

    // Daralan alanın dışında kalan asker aralıklarla can kaybeder.
    if (w.x[i] * w.x[i] + w.z[i] * w.z[i] > zone2) {
      w.zoneT[i] += dt;
      if (w.zoneT[i] >= ZONE.damageEvery) { w.zoneT[i] = 0; if (--w.hp[i] === 0) { kill(w, i); continue; } }
    } else w.zoneT[i] = 0;

    let t = w.target[i];
    if (t >= 0 && (w.hp[t] <= 0 || (w.x[t] - w.x[i]) ** 2 + (w.z[t] - w.z[i]) ** 2 > (SOLDIER.melee * 1.3) ** 2)) t = -1;
    // Hedef araması pahalı: her asker dört adımda bir arar. Yürüyüş emrindeki bölük yalnız dibindekiyle dövüşür.
    if (t < 0 && (i + w.tick) % 4 === 0) {
      const marching = w.border[b] === ORDER.move;
      t = nearestEnemy(w, i, w.bengaged[b] ? SOLDIER.melee : marching ? SOLDIER.reach * 1.5 : SOLDIER.acquire);
    }
    w.target[i] = t;

    let mx = 0, mz = 0;
    if (t >= 0) {
      const dx = w.x[t] - w.x[i], dz = w.z[t] - w.z[i], d = Math.hypot(dx, dz) || 1e-6;
      w.face[i] = Math.atan2(dx, dz);
      if (d > SOLDIER.reach) { const v = Math.min(run, d - SOLDIER.reach); mx = (dx / d) * v; mz = (dz / d) * v; }
      else if (w.cd[i] <= 0) {
        w.cd[i] = SOLDIER.cooldown[0] + rng() * (SOLDIER.cooldown[1] - SOLDIER.cooldown[0]);
        w.swing[i] = 0.35;
        if (rng() < SOLDIER.hitChance && --w.hp[t] === 0) kill(w, t);
      }
    } else if (w.bengaged[b] && w.btarget[b] >= 0) {
      // Çatışmadaki bölüğün boşta kalan askeri yuvasında beklemez, düşman bölüğün ortasına yürür.
      const o = w.btarget[b], dx = w.cx[o] - w.x[i], dz = w.cz[o] - w.z[i], d = Math.hypot(dx, dz) || 1e-6;
      const v = Math.min(run, d); mx = (dx / d) * v; mz = (dz / d) * v;
      w.face[i] = Math.atan2(dx, dz);
    } else {
      const p = slotPos(w, b, w.slot[i]), dx = p.x - w.x[i], dz = p.z - w.z[i], d = Math.hypot(dx, dz);
      if (d > 0.05) { const v = Math.min(run, d); mx = (dx / d) * v; mz = (dz / d) * v; }
      w.face[i] = d > 0.4 ? Math.atan2(dx, dz) : w.bface[b];
    }
    w.x[i] += mx; w.z[i] += mz;

    // İtme: üst üste binen askerler birbirinden ayrılır.
    const gx = Math.floor((w.x[i] + off) / CELL), gz = Math.floor((w.z[i] + off) / CELL);
    for (let cz = Math.max(0, gz - 1); cz <= Math.min(span - 1, gz + 1); cz++)
      for (let cx = Math.max(0, gx - 1); cx <= Math.min(span - 1, gx + 1); cx++)
        for (let j = head[cz * span + cx]; j !== -1; j = next[j]) {
          if (j === i || w.hp[j] <= 0) continue;
          const dx = w.x[i] - w.x[j], dz = w.z[i] - w.z[j], d2 = dx * dx + dz * dz;
          if (d2 >= R2 || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), push = (SOLDIER.radius * 2 - d) * 0.5;
          w.x[i] += (dx / d) * push; w.z[i] += (dz / d) * push;
        }
  }

  w.t += dt; w.tick++;
  if (w.winner < 0 && (w.alive[0] === 0 || w.alive[1] === 0)) w.winner = w.alive[0] > 0 ? 0 : w.alive[1] > 0 ? 1 : 2;
  return w;
}

function kill(w, i) {
  w.hp[i] = 0; w.diedAt[i] = w.t; w.alive[w.team[i]]--;
}
