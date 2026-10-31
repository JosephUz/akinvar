// Akın Var — savaş simülasyonu. Tarayıcıdan bağımsız, tohumlu ve belirlenimci: aynı tohum aynı savaşı verir.
// İki katman: bölük (yürüyüş, hedef, çatışma) ve asker (yuvasını izler, yakın dövüşte hedef seçer, vurur).
// Asker verisi düz dizilerde tutulur; 10 binlerce asker için nesne oluşturulmaz.
import { TICK, BOLUK, SPACING, BOLUK_GAP, SOLDIER, ENGAGE, RETARGET, MAX_SOLDIERS } from './config.js';

export const PER_BOLUK = BOLUK.cols * BOLUK.rows;
const CELL = 2;

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

/** İki takım, her biri `soldiers / 2` asker, bölükler karşılıklı saflarda. */
export function createBattle({ soldiers = 2000, seed = 1 } = {}) {
  const perTeam = Math.max(1, Math.ceil(Math.min(soldiers, MAX_SOLDIERS) / 2 / PER_BOLUK));
  const B = perTeam * 2, N = B * PER_BOLUK;
  const rng = mulberry32(seed);

  const w = {
    t: 0, tick: 0, seed, rng, N, B, winner: -1,
    // asker
    x: new Float32Array(N), z: new Float32Array(N), px: new Float32Array(N), pz: new Float32Array(N),
    face: new Float32Array(N), hp: new Int8Array(N), team: new Uint8Array(N), boluk: new Int32Array(N),
    slot: new Int16Array(N), target: new Int32Array(N).fill(-1), cd: new Float32Array(N),
    swing: new Float32Array(N), diedAt: new Float32Array(N).fill(-1),
    // bölük
    bx: new Float32Array(B), bz: new Float32Array(B), bface: new Float32Array(B), bteam: new Uint8Array(B),
    bkind: new Uint8Array(B), btarget: new Int32Array(B).fill(-1), bengaged: new Uint8Array(B), balive: new Int16Array(B),
    alive: [0, 0], radius: 0,
  };

  // Dizilim: her takım önde geniş bir cephe, arkada saflar. Mavi batıda doğuya, Kırmızı doğuda batıya bakar.
  const bw = BOLUK.cols * SPACING + BOLUK_GAP, bd = BOLUK.rows * SPACING + BOLUK_GAP * 1.5;
  const perLine = Math.min(perTeam, Math.max(4, Math.ceil(Math.sqrt(perTeam) * 2.2)));
  const lines = Math.ceil(perTeam / perLine), gap0 = 22;
  w.radius = Math.max(70, gap0 + lines * bd + 30, (perLine * bw) / 2 + 30);
  for (let b = 0; b < B; b++) {
    const team = b < perTeam ? 0 : 1, k = b % perTeam, line = Math.floor(k / perLine), col = k % perLine;
    const sign = team === 0 ? -1 : 1, inLine = Math.min(perLine, perTeam - line * perLine);
    w.bteam[b] = team;
    w.bkind[b] = line % 2;           // Faz 0: ön saflar mızraklı, arkadakiler kılıçlı
    w.bface[b] = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    w.bx[b] = sign * (gap0 + line * bd + bd / 2);
    w.bz[b] = (col - (inLine - 1) / 2) * bw * -sign;
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
    const c = cellOf(w, w.x[i], w.z[i]);
    next[i] = head[c]; head[c] = i;
  }
  function cellOf(w, x, z) {
    const gx = Math.min(span - 1, Math.max(0, Math.floor((x + off) / CELL)));
    const gz = Math.min(span - 1, Math.max(0, Math.floor((z + off) / CELL)));
    return gz * span + gx;
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

function retarget(w) {
  // Ölenlerin yuvaları sıkışır, bölük merkezi çatışmada askerlerin ortasına kayar.
  const cx = new Float32Array(w.B), cz = new Float32Array(w.B);
  w.balive.fill(0);
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i];
    w.slot[i] = w.balive[b]++;
    cx[b] += w.x[i]; cz[b] += w.z[i];
  }
  for (let b = 0; b < w.B; b++) {
    if (!w.balive[b]) { w.btarget[b] = -1; continue; }
    cx[b] /= w.balive[b]; cz[b] /= w.balive[b];
  }
  w.cx = cx; w.cz = cz;
  for (let b = 0; b < w.B; b++) {
    if (!w.balive[b]) continue;
    if (w.bengaged[b]) { w.bx[b] = cx[b]; w.bz[b] = cz[b]; }
    let best = -1, bestD = Infinity;
    for (let o = 0; o < w.B; o++) {
      if (!w.balive[o] || w.bteam[o] === w.bteam[b]) continue;
      const dx = cx[o] - cx[b], dz = cz[o] - cz[b], d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    w.btarget[b] = best;
  }
}

export function step(w) {
  const dt = TICK, rng = w.rng;
  w.px.set(w.x); w.pz.set(w.z);
  if (w.tick % Math.round(RETARGET / TICK) === 0) retarget(w);

  // Bölükler hedefe yürür; yeterince yaklaşınca çatışmaya girer ve yerinde kalır.
  for (let b = 0; b < w.B; b++) {
    const o = w.btarget[b];
    if (!w.balive[b] || o < 0) { w.bengaged[b] = 0; continue; }
    const dx = w.cx[o] - w.bx[b], dz = w.cz[o] - w.bz[b], d = Math.hypot(dx, dz);
    if (d > ENGAGE) {
      w.bengaged[b] = 0;
      w.bface[b] = Math.atan2(dx, dz);
      const v = Math.min(SOLDIER.walk * dt, d - ENGAGE);
      w.bx[b] += (dx / d) * v; w.bz[b] += (dz / d) * v;
    } else w.bengaged[b] = 1;
  }

  buildGrid(w);
  const { head, next, span, off } = w.grid;
  const run = SOLDIER.run * dt, R2 = (SOLDIER.radius * 2) ** 2;
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0) continue;
    const b = w.boluk[i];
    w.cd[i] -= dt; if (w.swing[i] > 0) w.swing[i] -= dt;
    let t = w.target[i];
    if (t >= 0 && (w.hp[t] <= 0 || (w.x[t] - w.x[i]) ** 2 + (w.z[t] - w.z[i]) ** 2 > (SOLDIER.melee * 1.3) ** 2)) t = -1;
    // Hedef araması pahalı: her asker dört adımda bir arar.
    if (t < 0 && (i + w.tick) % 4 === 0) t = nearestEnemy(w, i, w.bengaged[b] ? SOLDIER.melee : SOLDIER.acquire);
    w.target[i] = t;

    let mx = 0, mz = 0;
    if (t >= 0) {
      const dx = w.x[t] - w.x[i], dz = w.z[t] - w.z[i], d = Math.hypot(dx, dz) || 1e-6;
      w.face[i] = Math.atan2(dx, dz);
      if (d > SOLDIER.reach) { const v = Math.min(run, d - SOLDIER.reach); mx = (dx / d) * v; mz = (dz / d) * v; }
      else if (w.cd[i] <= 0) {
        w.cd[i] = SOLDIER.cooldown[0] + rng() * (SOLDIER.cooldown[1] - SOLDIER.cooldown[0]);
        w.swing[i] = 0.35;
        if (rng() < SOLDIER.hitChance && --w.hp[t] === 0) {
          w.diedAt[t] = w.t; w.alive[w.team[t]]--;
        }
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
