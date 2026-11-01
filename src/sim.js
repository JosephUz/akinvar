// Akın Var — savaş simülasyonu. Tarayıcıdan bağımsız, tohumlu ve belirlenimci: aynı tohum ve aynı emirler aynı savaşı verir.
// İki katman: bölük (emir, yürüyüş, hedef, çatışma) ve asker (yuvasını izler, yakın dövüşte hedef seçer, vurur ya da ok atar).
// Asker verisi düz dizilerde tutulur; 10 binlerce asker için nesne oluşturulmaz.
// Savaş bitince aynı dünyada bayrak evresi sürer: kazananların askerleri seçilen bayrağa koşar, her biri bir can götürür.
import { TICK, BOLUK, SPACING, BOLUK_GAP, SOLDIER, ARROW, ENGAGE, RETARGET, AUTO_RANGE, SKIRMISH, CHARGE, ZONE, FLAG_TIME } from './config.js';
import { CLASSES, FAMILIES, hitChance, COMBAT } from './units.js';

export const PER_BOLUK = BOLUK.cols * BOLUK.rows;
const CELL = 2;         // itme ve hedef arama ızgarası
export const VCELL = 3; // görüş (sis) ızgarası
const ORDER = { none: 0, move: 1, attack: 2 };

// Durumu dışarıdan okunup yazılabilen (r.s) tohumlu üreteç: çevrim içi anlıklar üretecin yerini de taşır.
export function mulberry32(seed) {
  const r = () => {
    const a = r.s = (r.s + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.s = seed >>> 0;
  return r;
}

const spacingOf = (c) => SPACING * (c.mounted ? 1.55 : c.ranged ? 1.3 : 1);
export const bolukWidth = (c) => BOLUK.cols * spacingOf(c) + BOLUK_GAP;
const bolukDepth = (c) => BOLUK.rows * spacingOf(c) + BOLUK_GAP * 1.5;

/**
 * players: [{ team, human, units: [sınıf no, ...], talim: [sınıf no → geliştirme seviyesi] }]
 * Her birim bir bölük (20 asker). Takımlar çember arenanın karşılıklı kenarlarında, oyuncular yan yana, merkeze bakar.
 * Her bölük, insanınki de, botun yapay zekâsıyla başlar: sisin içinde ilerler, gördüğü düşmana saldırır (şartlar eşit).
 * Oyuncu bir bölüğe emir verince o bölük oyuncunun olur (bhuman): emri bitince yerinde bekler, yalnız yakındakine saldırır.
 */
export function createBattle({ players, seed = 1 }) {
  const rng = mulberry32(seed);
  // Dizilim sırası: önde yakın dövüş, arkada okçu, en arkada atlı.
  const rank = (c) => (c.mounted ? 2 : c.ranged ? 1 : 0);
  const blocks = players.map((p, pi) => {
    const list = p.units.map((u) => CLASSES[u]).sort((a, b) => rank(a) - rank(b) || a.index - b.index);
    const k = list.length, perLine = Math.min(k, Math.max(3, Math.ceil(Math.sqrt(k) * 1.6)));
    const lineW = Math.max(...list.map(bolukWidth), 8), lineD = Math.max(...list.map(bolukDepth), 6);
    return { pi, list, perLine, lines: Math.ceil(k / perLine) || 0, width: perLine * lineW, lineW, lineD };
  });
  const teamWidth = [0, 1].map((t) => blocks.filter((b) => players[b.pi].team === t).reduce((s, b) => s + b.width + 10, 0));
  const maxDepth = Math.max(10, ...blocks.map((b) => b.lines * b.lineD));
  const radius = Math.max(70, Math.max(...teamWidth) * 0.6 + 20, maxDepth + 55);
  const D = radius - maxDepth / 2 - 12;

  const B = blocks.reduce((s, b) => s + b.list.length, 0), N = B * PER_BOLUK;
  const w = {
    t: 0, tick: 0, seed, rng, N, B, winner: -1, phase: 'battle', players: players.length, radius, zone: radius,
    // asker
    x: new Float32Array(N), z: new Float32Array(N), px: new Float32Array(N), pz: new Float32Array(N),
    face: new Float32Array(N), hp: new Int8Array(N), team: new Uint8Array(N), boluk: new Int32Array(N),
    slot: new Int16Array(N), target: new Int32Array(N).fill(-1), cd: new Float32Array(N),
    swing: new Float32Array(N), diedAt: new Float32Array(N).fill(-1), zoneT: new Float32Array(N), spent: new Uint8Array(N),
    // bölük
    bx: new Float32Array(B), bz: new Float32Array(B), bface: new Float32Array(B), bteam: new Uint8Array(B),
    bcls: new Uint8Array(B), bowner: new Uint8Array(B), bhuman: new Uint8Array(B), bsp: new Float32Array(B),
    btarget: new Int32Array(B).fill(-1), bengaged: new Uint8Array(B), balive: new Int16Array(B),
    cx: new Float32Array(B), cz: new Float32Array(B),
    border: new Uint8Array(B), otarget: new Int32Array(B).fill(-1), oface: new Float32Array(B),
    goal: new Uint8Array(B), gx: new Float32Array(B), gz: new Float32Array(B), offx: new Float32Array(B), offz: new Float32Array(B),
    bflag: new Int32Array(B).fill(-1),
    bcharge: new Float32Array(B), bfree: new Float32Array(B).fill(CHARGE.rearm), // atlı hücumu: kalan süre, çatışma dışında geçen süre
    bshoot: new Int32Array(B).fill(-1), bkite: new Uint8Array(B), // atlı okçu: her adımda yeniden hesaplanır, anlığa girmez
    alive: [0, 0], arrows: [], flags: [], flagT: 0,
  };

  let b = 0;
  for (const t of [0, 1]) {
    const sign = t === 0 ? -1 : 1, mine = blocks.filter((bl) => players[bl.pi].team === t);
    let lateral = -(teamWidth[t] - 10) / 2;
    for (const bl of mine) {
      const p = players[bl.pi], centerLat = lateral + bl.width / 2;
      bl.list.forEach((c, k) => {
        const line = Math.floor(k / bl.perLine), col = k % bl.perLine, inLine = Math.min(bl.perLine, bl.list.length - line * bl.perLine);
        w.bteam[b] = t; w.bcls[b] = c.index; w.bowner[b] = bl.pi; w.bhuman[b] = 0; w.bsp[b] = spacingOf(c);
        // Düz dizilim çemberin kenarına bükülür: yanlara açılan takım çemberin dışına taşmaz, her bölük merkeze bakar.
        const rho = D - (bl.lines * bl.lineD) / 2 + line * bl.lineD + bl.lineD / 2;
        const ang = ((centerLat + (col - (inLine - 1) / 2) * bl.lineW) * -sign) / D;
        w.bx[b] = sign * rho * Math.cos(ang);
        w.bz[b] = rho * Math.sin(ang);
        w.bface[b] = w.oface[b] = Math.atan2(-w.bx[b], -w.bz[b]);
        w.offx[b] = w.bx[b] - sign * D; w.offz[b] = w.bz[b];
        w.cx[b] = w.bx[b]; w.cz[b] = w.bz[b]; w.balive[b] = PER_BOLUK;
        const hp = SOLDIER.hp + (p.talim?.[c.index] ?? 0);
        for (let s = 0; s < PER_BOLUK; s++) {
          const i = b * PER_BOLUK + s;
          w.team[i] = t; w.boluk[i] = b; w.slot[i] = s; w.hp[i] = hp; w.face[i] = w.bface[b];
          const q = slotPos(w, b, s);
          w.x[i] = w.px[i] = q.x + (rng() - 0.5) * 0.2;
          w.z[i] = w.pz[i] = q.z + (rng() - 0.5) * 0.2;
          w.cd[i] = rng() * c.cycle;
        }
        w.alive[t] += PER_BOLUK; b++;
      });
      lateral += bl.width + 10;
    }
  }

  // Izgaralar merkeze göre simetrik: başlangıç hücre boyunun katı. Değilse hücre sınırları kayar, aynalı konumdaki iki
  // takımdan biri öbürünü bir hücre önce görür (batıdaki taraf aynalı savaşların çoğunu kazanıyordu).
  const gridOff = Math.ceil(radius / CELL + 1) * CELL, span = (2 * gridOff) / CELL + 1;
  w.grid = { span, off: gridOff, head: new Int32Array(span * span), next: new Int32Array(Math.max(1, N)) };
  const vOff = Math.ceil(radius / VCELL + 1) * VCELL, vs = (2 * vOff) / VCELL + 1;
  w.vgrid = { span: vs, off: vOff };
  w.vis = [new Uint8Array(vs * vs), new Uint8Array(vs * vs)];
  updateVision(w);
  if (w.alive[0] === 0 || w.alive[1] === 0) w.winner = w.alive[0] > 0 ? 0 : w.alive[1] > 0 ? 1 : 2;
  return w;
}

// Yuva: ön sıra 0, sütunlar bölüğün sağından soluna. İleri yön (sin f, cos f).
function slotPos(w, b, s) {
  const c = s % BOLUK.cols, r = Math.floor(s / BOLUK.cols), f = w.bface[b], sp = w.bsp[b];
  const lx = (c - (BOLUK.cols - 1) / 2) * sp, lz = ((BOLUK.rows - 1) / 2 - r) * sp;
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
        if (w.team[j] === team || w.hp[j] <= 0) continue; // ızgara adım başında kuruldu, arada ölen olabilir
        const dx = w.x[j] - x, dz = w.z[j] - z, d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
  return best;
}

// Görüş: bölük merkezinden sınıfın görüşü kadar; merkezden uzaklaşmış askerler de çevresini görür.
function updateVision(w) {
  const { span, off } = w.vgrid;
  for (const v of w.vis) v.fill(0);
  const mark = (team, x, z, radius) => {
    const v = w.vis[team], rr = Math.ceil(radius / VCELL), rr2 = (radius / VCELL) ** 2;
    const gx = Math.floor((x + off) / VCELL), gz = Math.floor((z + off) / VCELL);
    for (let dz = -rr; dz <= rr; dz++) {
      const cz = gz + dz; if (cz < 0 || cz >= span) continue;
      for (let dx = -rr; dx <= rr; dx++) {
        const cx = gx + dx; if (cx < 0 || cx >= span || dx * dx + dz * dz > rr2) continue;
        v[cz * span + cx] = 1;
      }
    }
  };
  for (let b = 0; b < w.B; b++) if (w.balive[b]) mark(w.bteam[b], w.cx[b], w.cz[b], CLASSES[w.bcls[b]].vision);
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i];
    if ((w.x[i] - w.cx[b]) ** 2 + (w.z[i] - w.cz[b]) ** 2 > 121) mark(w.team[i], w.x[i], w.z[i], 11);
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
  if (w.phase !== 'battle') return;

  for (let b = 0; b < w.B; b++) {
    if (!w.balive[b]) { w.btarget[b] = -1; w.border[b] = ORDER.none; continue; }
    const team = w.bteam[b], cls = CLASSES[w.bcls[b]];
    if (w.bengaged[b] && !cls.ranged) { w.bx[b] = cx[b]; w.bz[b] = cz[b]; }
    if (w.border[b] === ORDER.attack) {
      const o = w.otarget[b];
      if (o >= 0 && w.balive[o]) { w.btarget[b] = o; continue; }
      w.border[b] = ORDER.none;
    }
    if (w.border[b] === ORDER.move) { w.btarget[b] = -1; continue; }

    // Emirsiz: görünen en yakın düşman bölüğü. Oyuncunun bölükleri yalnız yakındakine (okçu menzilindekine) kendiliğinden gider.
    const reachAuto = Math.max(AUTO_RANGE, cls.reach + 4);
    const limit = w.bhuman[b] ? reachAuto * reachAuto : Infinity;
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
    if (!w.bhuman[b]) {
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
 * Emir. `list`: bölük numaraları (o takımın).
 * move: {x, z} — bölükler hedefin çevresinde, yürüyüş yönüne dik saflar halinde dizilir.
 * attack: {target} — düşman bölüğü. stop: emirleri bırak, yakındaki düşmana kendiliğinden saldır.
 * flag: {flag} — bayrak evresinde bölüğün sağ kalanları o bayrağa koşar.
 * bot: {} — oyuncu koptu, bölüklerini bot yönetir (emirleri bırakılır). human: {} — döndü (bölükler bot gibi sürer, ilk emirde oyuncunun olur).
 * owner verilirse yalnız o oyuncunun (savaştaki sırası) bölükleri emir alır (çevrim içi denetim).
 */
export function command(w, team, list, cmd, owner = -1) {
  list = list.filter((b) => Number.isInteger(b) && b >= 0 && b < w.B && w.bteam[b] === team && w.balive[b] && (owner < 0 || w.bowner[b] === owner));
  if (!list.length) return;
  if (cmd.type === 'bot' || cmd.type === 'human') {
    if (cmd.type === 'bot') for (const b of list) { w.bhuman[b] = 0; w.border[b] = ORDER.none; w.goal[b] = 0; }
    return;
  }
  if (cmd.type !== 'flag') for (const b of list) w.bhuman[b] = 1; // emir alan bölük oyuncunun olur
  if (cmd.type === 'flag') {
    if (w.phase !== 'flag' || !w.flags[cmd.flag] || w.flags[cmd.flag].hp <= 0) return;
    for (const b of list) w.bflag[b] = cmd.flag;
    return;
  }
  if (w.phase !== 'battle') return;
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
  const colW = Math.max(...list.map((b) => bolukWidth(CLASSES[w.bcls[b]])));
  // Öndekiler öne, soldakiler sola: yollar kesişmesin.
  const fwd = (b) => w.cx[b] * sf + w.cz[b] * cf, lat = (b) => w.cx[b] * cf - w.cz[b] * sf;
  const sorted = [...list].sort((a, b) => fwd(b) - fwd(a));
  for (let r = 0; r * perRow < n; r++) {
    const row = sorted.slice(r * perRow, (r + 1) * perRow).sort((a, b) => lat(a) - lat(b));
    row.forEach((b, c) => {
      const lx = (c - (row.length - 1) / 2) * colW, lz = -r * colW * 0.85;
      w.gx[b] = cmd.x + cf * lx + sf * lz; w.gz[b] = cmd.z - sf * lx + cf * lz;
      w.goal[b] = 1; w.border[b] = ORDER.move; w.oface[b] = f; w.btarget[b] = -1; w.bengaged[b] = 0;
      w.bx[b] = w.cx[b]; w.bz[b] = w.cz[b]; // yürüyüş askerlerin şimdiki ortasından başlar
    });
  }
}

/** Savaşı kazanan takımın sağ kalanları için bayrak evresini başlatır. flags: [{ player, x, z, hp }] */
export function startFlagPhase(w, flags) {
  w.phase = 'flag'; w.flagT = 0; w.flags = flags.map((f) => ({ ...f, hits: 0 }));
  w.arrows.length = 0;
  for (let b = 0; b < w.B; b++) { w.border[b] = ORDER.none; w.goal[b] = 0; w.btarget[b] = -1; w.bengaged[b] = 0; w.bflag[b] = -1; w.bx[b] = w.cx[b]; w.bz[b] = w.cz[b]; }
}

export function step(w) {
  if (w.phase === 'flag') return flagStep(w);
  if (w.phase !== 'battle') return w;
  const dt = TICK, rng = w.rng;
  w.px.set(w.x); w.pz.set(w.z);
  w.zone = w.t < ZONE.wait ? w.radius : Math.max(0, w.radius * (1 - (w.t - ZONE.wait) / ZONE.shrink));
  if (w.tick % Math.round(RETARGET / TICK) === 0) retarget(w);
  if (w.tick % 5 === 0) updateVision(w);

  // Bölükler: hedef bölüğe yürür ve yaklaşınca çatışır (okçu menzilinde durur); yoksa yürüyüş noktasına gider.
  for (let b = 0; b < w.B; b++) {
    if (!w.balive[b]) { w.bengaged[b] = 0; continue; }
    const cls = CLASSES[w.bcls[b]], walk = SOLDIER.walk * cls.speed * dt, o = w.btarget[b];
    if (cls.skirmish && skirmish(w, b, cls, walk)) continue;
    if (o >= 0) {
      const dx = w.cx[o] - w.bx[b], dz = w.cz[o] - w.bz[b], d = Math.hypot(dx, dz);
      const stopAt = cls.ranged ? Math.max(ENGAGE, cls.reach * 0.85) : ENGAGE;
      if (d > stopAt) {
        w.bengaged[b] = 0; w.bface[b] = Math.atan2(dx, dz);
        const v = Math.min(walk, d - stopAt);
        w.bx[b] += (dx / d) * v; w.bz[b] += (dz / d) * v;
      } else { w.bengaged[b] = 1; if (cls.ranged) w.bface[b] = Math.atan2(dx, dz); }
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

  // Atlı hücumu: yakın dövüş atlısı çatışmaya girdiği an (askerler koşuya geçer) hücum başlar.
  for (let b = 0; b < w.B; b++) {
    const cls = CLASSES[w.bcls[b]];
    if (!cls.mounted || cls.ranged || !w.balive[b]) continue;
    if (w.bengaged[b]) { if (w.bfree[b] >= CHARGE.rearm) w.bcharge[b] = CHARGE.time; w.bfree[b] = 0; }
    else w.bfree[b] += dt;
    if (w.bcharge[b] > 0) w.bcharge[b] = Math.max(0, w.bcharge[b] - dt);
  }

  buildGrid(w);
  const { head, next, span, off } = w.grid;
  const R2 = (SOLDIER.radius * 2) ** 2, zone2 = w.zone * w.zone;
  // Yakın dövüş isabetleri adım sonunda birlikte işlenir: aynı adımda vuruşan iki askerin ikisi de vurur,
  // önce işlenen öbürünü öldürüp karşılığını kesmez (işleme sırası ve konum üstünlük vermesin).
  const hits = [];
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i], ci = w.bcls[b], cls = CLASSES[ci], run = SOLDIER.run * cls.speed * dt;
    w.cd[i] -= dt; if (w.swing[i] > 0) w.swing[i] -= dt;

    // Daralan alanın dışında kalan asker aralıklarla can kaybeder.
    if (w.x[i] * w.x[i] + w.z[i] * w.z[i] > zone2) {
      w.zoneT[i] += dt;
      if (w.zoneT[i] >= ZONE.damageEvery) { w.zoneT[i] = 0; if (--w.hp[i] <= 0) { kill(w, i); continue; } }
    } else w.zoneT[i] = 0;

    // Yakın dövüş hedefi. Okçu yalnız dibine geleni kılıçlar gibi karşılar; yürüyüşteki bölük yalnız dibindekiyle dövüşür.
    // Geri çekilen atlı okçu kimseyle boğuşmaz.
    const melee = cls.ranged ? 0.9 : cls.reach;
    let t = cls.skirmish && w.bkite[b] ? -1 : w.target[i];
    if (t >= 0 && (w.hp[t] <= 0 || (w.x[t] - w.x[i]) ** 2 + (w.z[t] - w.z[i]) ** 2 > (cls.ranged ? 3 : SOLDIER.melee * 1.3) ** 2)) t = -1;
    if (t < 0 && (i + w.tick) % 4 === 0 && !(cls.skirmish && w.bkite[b])) {
      const range = cls.ranged ? 2.2 : w.bengaged[b] ? SOLDIER.melee : w.border[b] === ORDER.move ? melee * 1.5 : SOLDIER.acquire;
      t = nearestEnemy(w, i, Math.max(range, melee + 0.5));
    }
    w.target[i] = t;

    let mx = 0, mz = 0;
    if (t >= 0) {
      const dx = w.x[t] - w.x[i], dz = w.z[t] - w.z[i], d = Math.hypot(dx, dz) || 1e-6;
      w.face[i] = Math.atan2(dx, dz);
      if (d > melee) { const v = Math.min(run, d - melee); mx = (dx / d) * v; mz = (dz / d) * v; }
      else if (w.cd[i] <= 0) {
        w.cd[i] = cls.cycle * (0.9 + rng() * 0.3);
        w.swing[i] = 0.35;
        // Arkadan vuruş: saldıran, savunanın baktığı yönün arkasındaysa (throneofcurse +20).
        const behind = Math.sin(w.face[t]) * -dx + Math.cos(w.face[t]) * -dz < -0.5 * d;
        const tc = w.bcls[w.boluk[t]];
        let h = hitChance(ci, tc, behind);
        if (w.bcharge[b] > 0 && CLASSES[tc].model !== 'spear') h = Math.min(COMBAT.max, h * CHARGE.mult); // hücum, mızrak duvarına işlemez
        if (rng() < h) hits.push(t);
      }
    } else if (cls.skirmish) {
      // Atlı okçu yuvasını izler (ilerlerken de, geri çekilirken de) ve menzildeki bölüğe at üstünden ok atar.
      const p = slotPos(w, b, w.slot[i]), dx = p.x - w.x[i], dz = p.z - w.z[i], d = Math.hypot(dx, dz);
      if (d > 0.05) { const v = Math.min(run, d); mx = (dx / d) * v; mz = (dz / d) * v; }
      const o = w.bshoot[b];
      if (o >= 0) { w.face[i] = Math.atan2(w.cx[o] - w.x[i], w.cz[o] - w.z[i]); shoot(w, i, o, cls, ci, rng); }
      else w.face[i] = d > 0.4 ? Math.atan2(dx, dz) : w.bface[b];
    } else if (cls.ranged && w.btarget[b] >= 0 && w.bengaged[b]) {
      // Okçu yuvasında durur, hedef bölükten bir askere ok atar.
      const p = slotPos(w, b, w.slot[i]), dx = p.x - w.x[i], dz = p.z - w.z[i], d = Math.hypot(dx, dz);
      if (d > 0.05) { const v = Math.min(run, d); mx = (dx / d) * v; mz = (dz / d) * v; }
      const o = w.btarget[b];
      w.face[i] = Math.atan2(w.cx[o] - w.x[i], w.cz[o] - w.z[i]);
      shoot(w, i, o, cls, ci, rng);
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
    separate(w, i, head, next, span, off, R2);
  }

  for (const t of hits) if (w.hp[t] > 0 && --w.hp[t] <= 0) kill(w, t);

  // Oklar: düştüğü yerde hedef hâlâ oradaysa isabet zarı atılır.
  if (w.arrows.length) {
    let k = 0;
    for (const a of w.arrows) {
      if (w.t < a.t1) { w.arrows[k++] = a; continue; }
      const t = a.target;
      if (w.hp[t] > 0 && (w.x[t] - a.tx) ** 2 + (w.z[t] - a.tz) ** 2 < ARROW.hitRadius ** 2
        && rng() < hitChance(a.cls, w.bcls[w.boluk[t]], false) && --w.hp[t] <= 0) kill(w, t);
    }
    w.arrows.length = k;
  }

  w.t += dt; w.tick++;
  if (w.winner < 0 && (w.alive[0] === 0 || w.alive[1] === 0)) {
    w.winner = w.alive[0] > 0 ? 0 : w.alive[1] > 0 ? 1 : 2;
    retarget(w);
  }
  return w;
}

// Okçu, dolmuşsa o bölükten bir askere ok atar (menzil dışındaysa beklemeye devam eder).
function shoot(w, i, o, cls, ci, rng) {
  if (w.cd[i] > 0) return;
  w.cd[i] = cls.cycle * (0.9 + rng() * 0.3);
  const tgt = pickMember(w, o, rng);
  if (tgt < 0) return;
  const ddx = w.x[tgt] - w.x[i], ddz = w.z[tgt] - w.z[i], dist = Math.hypot(ddx, ddz);
  if (dist > cls.reach * 1.1) return;
  w.swing[i] = 0.35;
  w.arrows.push({ sx: w.x[i], sz: w.z[i], tx: w.x[tgt] + (rng() - 0.5), tz: w.z[tgt] + (rng() - 0.5), t0: w.t, t1: w.t + dist / ARROW.speed + 0.15, target: tgt, cls: ci });
}

/**
 * Atlı okçu bölüğü (vur-kaç). Her adımda: menzildeki en uygun düşman bölüğü ateş hedefi olur (bshoot; yürürken de atılır).
 * Yürü emri yoksa ve görünen bir yakın dövüş bölüğü SKIRMISH.kite × menzilden yakına geldiyse ondan uzaklaşır (bkite),
 * alanın içinde kalarak. true: bölüğün yürüyüşü bu adımda burada yapıldı.
 */
function skirmish(w, b, cls, walk) {
  const team = w.bteam[b], x = w.bx[b], z = w.bz[b], o = w.btarget[b];
  const reach2 = (cls.reach * 1.05) ** 2;
  let shootB = -1, shootD = reach2, threat = -1, threatD = (cls.reach * SKIRMISH.kite) ** 2;
  for (let k = 0; k < w.B; k++) {
    if (!w.balive[k] || w.bteam[k] === team || !visibleTo(w, team, w.cx[k], w.cz[k])) continue;
    const d = (w.cx[k] - x) ** 2 + (w.cz[k] - z) ** 2;
    if (d < shootD) { shootD = d; shootB = k; }
    if (!CLASSES[w.bcls[k]].ranged && d < threatD) { threatD = d; threat = k; }
  }
  // Seçili hedef menzildeyse önce o vurulur.
  if (o >= 0 && w.balive[o] && (w.cx[o] - x) ** 2 + (w.cz[o] - z) ** 2 < reach2) shootB = o;
  w.bshoot[b] = shootB;
  w.bkite[b] = 0;
  if (threat < 0 || w.border[b] === ORDER.move) return false;

  let dx = x - w.cx[threat], dz = z - w.cz[threat];
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  let nx = x + dx * walk, nz = z + dz * walk;
  // Alanın kenarına dayanınca kenar boyunca kayar.
  const lim = Math.max(0, w.zone - SKIRMISH.edge), r = Math.hypot(nx, nz);
  if (r > lim) { nx *= lim / r; nz *= lim / r; }
  w.bx[b] = nx; w.bz[b] = nz;
  w.bface[b] = Math.atan2(-dx, -dz); // saflar tehdide dönük
  w.bkite[b] = 1; w.bengaged[b] = 0;
  return true;
}

// Bayrak evresi: savaş yok; bayrağa gönderilen askerler koşar, değince bir can götürüp kaybolur.
function flagStep(w) {
  const dt = TICK;
  w.px.set(w.x); w.pz.set(w.z);
  buildGrid(w);
  const { head, next, span, off } = w.grid, R2 = (SOLDIER.radius * 2) ** 2;
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i], fi = w.bflag[b];
    if (fi < 0) continue;
    const f = w.flags[fi], dx = f.x - w.x[i], dz = f.z - w.z[i], d = Math.hypot(dx, dz);
    if (d < 1.2) {
      if (f.hp > 0) { f.hp--; f.hits++; }
      w.hp[i] = 0; w.spent[i] = 1; w.alive[w.team[i]]--;
      continue;
    }
    const v = Math.min(SOLDIER.run * 1.6 * CLASSES[w.bcls[b]].speed * dt, d);
    w.x[i] += (dx / d) * v; w.z[i] += (dz / d) * v; w.face[i] = Math.atan2(dx, dz);
    separate(w, i, head, next, span, off, R2 * 0.5);
  }
  w.t += dt; w.tick++; w.flagT += dt;
  if (w.tick % 20 === 0) retarget(w);
  const winners = w.winner === 0 || w.winner === 1 ? w.alive[w.winner] : 0;
  if (w.flagT >= FLAG_TIME || winners === 0) {
    // Gönderilmeyenler dağılır.
    for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { w.hp[i] = 0; w.spent[i] = 1; w.alive[w.team[i]]--; }
    w.phase = 'done';
  }
  return w;
}

// İtmeler askerin ilk konumundan toplanıp birlikte uygulanır. Sırayla uygulanınca komşular hep batıdan doğuya
// tarandığı için itme yöne bağlı kayıyordu ve aynalı savaşlarda batıdaki taraf çoğunlukla kazanıyordu.
function separate(w, i, head, next, span, off, R2) {
  const x = w.x[i], z = w.z[i];
  const gx = Math.floor((x + off) / CELL), gz = Math.floor((z + off) / CELL), r = Math.sqrt(R2);
  let mx = 0, mz = 0;
  for (let cz = Math.max(0, gz - 1); cz <= Math.min(span - 1, gz + 1); cz++)
    for (let cx = Math.max(0, gx - 1); cx <= Math.min(span - 1, gx + 1); cx++)
      for (let j = head[cz * span + cx]; j !== -1; j = next[j]) {
        if (j === i || w.hp[j] <= 0) continue;
        const dx = x - w.x[j], dz = z - w.z[j], d2 = dx * dx + dz * dz;
        if (d2 >= R2 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), push = (r - d) * 0.5;
        mx += (dx / d) * push; mz += (dz / d) * push;
      }
  w.x[i] = x + mx; w.z[i] = z + mz;
}

function pickMember(w, b, rng) {
  const base = b * PER_BOLUK;
  for (let k = 0; k < 6; k++) { const i = base + ((rng() * PER_BOLUK) | 0); if (w.hp[i] > 0) return i; }
  for (let s = 0; s < PER_BOLUK; s++) if (w.hp[base + s] > 0) return base + s;
  return -1;
}

function kill(w, i) {
  w.hp[i] = 0; w.diedAt[i] = w.t; w.alive[w.team[i]]--;
}

// ---------- çevrim içi anlık ----------
// Sunucu birkaç saniyede bir savaşın tam durumunu yollar; istemcinin kayan sayıları farklı motorda azıcık ayrışsa bile
// bir sonraki anlıkta düzelir. Biçim: [başlık uzunluğu u32][başlık JSON][4'e hizalı diziler].
const SOLDIER_FIELDS = ['x', 'z', 'face', 'cd', 'swing', 'zoneT', 'diedAt', 'hp', 'spent', 'target', 'slot'];
const BOLUK_FIELDS = ['bx', 'bz', 'bface', 'cx', 'cz', 'oface', 'gx', 'gz', 'btarget', 'otarget', 'bflag', 'bengaged', 'border', 'goal', 'bhuman', 'balive', 'bcharge', 'bfree'];

export function snapshot(w) {
  const arrays = [...SOLDIER_FIELDS, ...BOLUK_FIELDS].map((k) => w[k]).concat(w.vis);
  const head = new TextEncoder().encode(JSON.stringify({
    t: w.t, tick: w.tick, zone: w.zone, winner: w.winner, phase: w.phase, flagT: w.flagT, alive: w.alive, rng: w.rng.s,
    arrows: w.arrows, flags: w.flags, N: w.N, B: w.B,
  }));
  const pad = (n) => (n + 3) & ~3;
  let size = 4 + pad(head.length);
  for (const a of arrays) size += pad(a.byteLength);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  let o = 4 + pad(head.length);
  for (const a of arrays) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += pad(a.byteLength); }
  return out;
}

export function applySnapshot(w, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + len)));
  if (h.N !== w.N || h.B !== w.B) return false;
  const pad = (n) => (n + 3) & ~3;
  let o = 4 + pad(len);
  for (const a of [...SOLDIER_FIELDS, ...BOLUK_FIELDS].map((k) => w[k]).concat(w.vis)) {
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength).set(u8.subarray(o, o + a.byteLength)); o += pad(a.byteLength);
  }
  w.px.set(w.x); w.pz.set(w.z);
  Object.assign(w, { t: h.t, tick: h.tick, zone: h.zone, winner: h.winner, phase: h.phase, flagT: h.flagT, alive: h.alive, arrows: h.arrows, flags: h.flags });
  w.rng.s = h.rng;
  return true;
}

export { FAMILIES };
