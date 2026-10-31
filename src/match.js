// Akın Var — maç: oyuncular, para, ekonomi, talim, bayrak canı ve tur döngüsü.
// Tur: hazırlık (kartlarla bölük al) → savaş (sim.js) → bayrak evresi (kazanan sağ kalanlarını bayraklara yollar).
// Askerler tura geçmez; turdan tura yalnız ekonomi seviyesi, talim ve biriken para taşınır.
import { ECONOMY, TALIM, PERSONALITIES, TEAMS } from './config.js';
import { CLASSES, CLASS_COUNT, HIT, FAMILIES } from './units.js';
import { createBattle, startFlagPhase, mulberry32, command, PER_BOLUK } from './sim.js';

export const ecoCost = (level) => ECONOMY.levelCost * (level + 1);
export const talimCost = (level) => TALIM.cost * (level + 1);
export const income = (p) => ECONOMY.roundIncome + p.eco * ECONOMY.levelIncome;

/** teamSize oyuncu takım başına; oyuncu 0 insan (Mavi), kalanı botlar. */
export function createMatch({ teamSize = 1, flagHp = 100, seed = (Math.random() * 1e9) | 0, humans = [0] } = {}) {
  const rng = mulberry32(seed);
  const players = [];
  for (const team of [0, 1]) for (let k = 0; k < teamSize; k++) {
    const id = players.length, human = humans.includes(id);
    const pers = human ? null : PERSONALITIES[(rng() * PERSONALITIES.length) | 0];
    players.push({
      id, team, human, personality: pers?.key ?? null,
      name: human ? 'Sen' : `${pers.name}`, color: TEAMS[team].shades[k % 5],
      gold: 0, eco: 0, talim: [0, 0, 0, 0], hp: flagHp, maxHp: flagHp, out: false,
      units: [], ready: false, bought: { eco: 0, talim: [0, 0, 0, 0] }, lastUnits: [],
    });
  }
  const m = { seed, rng, round: 0, flagHp, teamSize, players, phase: 'prep', battle: null, winner: -1, log: [] };
  startRound(m);
  return m;
}

export function alivePlayers(m, team) { return m.players.filter((p) => !p.out && (team === undefined || p.team === team)); }

function startRound(m) {
  m.round++; m.phase = 'prep'; m.battle = null;
  for (const p of m.players) {
    p.units = []; p.ready = p.out; p.bought = { eco: 0, talim: [0, 0, 0, 0] };
    if (!p.out) p.gold += income(p);
  }
  for (const p of m.players) if (!p.human && !p.out) botPrep(m, p);
}

// ---------- hazırlık ----------

export function buyUnit(m, p, cls) {
  const c = CLASSES[cls];
  if (m.phase !== 'prep' || p.out || p.ready || p.gold < c.cost) return false;
  p.gold -= c.cost; p.units.push(cls); return true;
}
export function refundUnit(m, p, cls) {
  if (m.phase !== 'prep' || p.ready) return false;
  const k = p.units.lastIndexOf(cls);
  if (k < 0) return false;
  p.units.splice(k, 1); p.gold += CLASSES[cls].cost; return true;
}
export function buyEco(m, p) {
  const cost = ecoCost(p.eco);
  if (m.phase !== 'prep' || p.out || p.ready || p.gold < cost) return false;
  p.gold -= cost; p.eco++; p.bought.eco++; return true;
}
export function refundEco(m, p) {
  if (m.phase !== 'prep' || p.ready || !p.bought.eco) return false;
  p.eco--; p.bought.eco--; p.gold += ecoCost(p.eco); return true;
}
export function buyTalim(m, p, family) {
  const lv = p.talim[family], cost = talimCost(lv);
  if (m.phase !== 'prep' || p.out || p.ready || lv >= TALIM.max || p.gold < cost) return false;
  p.gold -= cost; p.talim[family]++; p.bought.talim[family]++; return true;
}
export function refundTalim(m, p, family) {
  if (m.phase !== 'prep' || p.ready || !p.bought.talim[family]) return false;
  p.talim[family]--; p.bought.talim[family]--; p.gold += talimCost(p.talim[family]); return true;
}
export function setReady(m, p) { p.ready = true; }
export const allReady = (m) => m.players.every((p) => p.ready);

// ---------- savaş ----------

export function startBattle(m) {
  m.phase = 'battle';
  const active = m.players.filter((p) => !p.out);
  m.order = active.map((p) => p.id); // savaştaki oyuncu sırası → maç oyuncusu
  m.battle = createBattle({
    seed: (m.rng() * 1e9) | 0,
    players: active.map((p) => ({ team: p.team, human: p.human, units: p.units, talim: p.talim })),
  });
  for (const p of active) p.lastUnits = [...p.units];
  return m.battle;
}

/** Savaş bitti: kaybeden takımın ayaktaki oyuncularının bayrakları sahaya dikilir, bayrak evresi başlar. */
export function startFlags(m) {
  const w = m.battle;
  if (w.winner !== 0 && w.winner !== 1) { m.phase = 'flag'; w.phase = 'done'; return; }
  const losers = alivePlayers(m, 1 - w.winner);
  // Bayraklar sağ kalanların ortasının önünde bir yay üstünde.
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { x += w.x[i]; z += w.z[i]; n++; }
  if (n) { x /= n; z /= n; }
  const away = Math.atan2(-x, -z) || 0; // merkeze doğru
  const flags = losers.map((p, k) => {
    const a = away + (k - (losers.length - 1) / 2) * 0.45, r = 16;
    return { player: p.id, x: x + Math.sin(a) * r, z: z + Math.cos(a) * r, hp: p.hp, start: p.hp };
  });
  startFlagPhase(w, flags);
  m.phase = 'flag';
  // Bot oyuncular askerlerini kişiliklerine göre bayraklara dağıtır.
  for (const p of alivePlayers(m, w.winner)) if (!p.human) botFlags(m, p);
}

/** Bayrak evresi bitti: canlar işlenir, elenenler çıkar, maç biter ya da yeni tur başlar. */
export function endRound(m) {
  const w = m.battle;
  for (const f of w.flags) {
    const p = m.players[f.player];
    p.hp = f.hp;
    if (p.hp <= 0) { p.hp = 0; p.out = true; }
  }
  m.log.push({ round: m.round, winner: w.winner, flags: w.flags.map((f) => ({ player: f.player, hits: f.hits })) });
  const left = [0, 1].map((t) => alivePlayers(m, t).length);
  if (!left[0] || !left[1]) { m.phase = 'over'; m.winner = left[0] ? 0 : 1; return; }
  startRound(m);
}

// Savaştaki bölüklerin sahibi maç oyuncusu.
export const ownerOf = (m, b) => m.players[m.order[m.battle.bowner[b]]];
export function bolukOf(m, p) {
  const w = m.battle, list = [];
  for (let b = 0; b < w.B; b++) if (m.order[w.bowner[b]] === p.id) list.push(b);
  return list;
}

// ---------- botlar ----------

const affordable = (p) => CLASSES.filter((c) => c.cost <= p.gold);

function botPrep(m, p) {
  const rng = m.rng, r = m.round, enemies = m.players.filter((q) => q.team !== p.team && !q.out);
  // 1) Ekonomi
  const ecoTarget = { acgozlu: Math.min(8, r + 1), akinci: Math.floor(r / 4), dengeli: Math.ceil(r / 2), karsi: Math.floor(r / 2) }[p.personality];
  while (p.eco < ecoTarget && p.gold - ecoCost(p.eco) >= (p.personality === 'acgozlu' ? 150 : 500)) buyEco(m, p);
  // 2) Talim: dengeli ve karşı kurucu, en çok bastığı ailede
  if ((p.personality === 'dengeli' || p.personality === 'karsi') && r >= 3) {
    const fam = favoriteFamily(p);
    if (fam >= 0 && p.gold - talimCost(p.talim[fam]) >= 400) buyTalim(m, p, fam);
  }
  // 3) Askerler: kalan parayla. Açgözlü ve Dengeli sıradaki ekonomi seviyesi için bir kısmını biriktirir.
  const saving = p.eco < ecoTarget ? ({ acgozlu: 0.6, dengeli: 0.3 }[p.personality] ?? 0) : 0;
  const keep = Math.min(p.gold, ecoCost(p.eco)) * saving;
  const tier = Math.min(1, 0.25 + r * 0.12); // turlar ilerledikçe pahalı sınıflar
  let guard = 200;
  while (guard-- > 0) {
    const opts = affordable(p).filter((c) => p.gold - c.cost >= keep);
    if (!opts.length) break;
    let pick;
    if (p.personality === 'karsi' && enemies.some((e) => e.lastUnits.length)) pick = counterPick(opts, enemies, rng);
    else if (p.personality === 'akinci') { const cheap = [...opts].sort((a, b) => a.cost - b.cost); pick = cheap[(rng() * Math.min(cheap.length, 12)) | 0]; }
    else {
      const sorted = [...opts].sort((a, b) => a.cost - b.cost);
      const hi = Math.max(1, Math.round(sorted.length * tier));
      pick = sorted[Math.max(0, hi - 1 - ((rng() * Math.min(hi, 8)) | 0))];
    }
    buyUnit(m, p, pick.index);
  }
  p.ready = true;
}

function favoriteFamily(p) {
  const n = [0, 0, 0, 0];
  for (const u of p.lastUnits.length ? p.lastUnits : p.units) n[CLASSES[u].family]++;
  const max = Math.max(...n);
  return max ? n.indexOf(max) : -1;
}

// Rakiplerin geçen turdaki ordusuna karşı ortalama isabet puanı en yüksek olan (fiyatına göre).
function counterPick(opts, enemies, rng) {
  const seen = enemies.flatMap((e) => e.lastUnits);
  let best = opts[0], bestS = -Infinity;
  for (const c of opts) {
    let s = 0;
    for (const d of seen) s += HIT[c.index * CLASS_COUNT + d] - HIT[d * CLASS_COUNT + c.index] * 0.5;
    s = s / seen.length - c.cost * 0.05 + rng() * 4;
    if (s > bestS) { bestS = s; best = c; }
  }
  return best;
}

function botFlags(m, p) {
  const w = m.battle, flags = w.flags.map((f, i) => ({ ...f, i })).filter((f) => f.hp > 0);
  const mine = bolukOf(m, p).filter((b) => w.balive[b]);
  if (!flags.length || !mine.length) return;
  if (p.personality === 'akinci' || p.personality === 'acgozlu') {
    // En zayıf bayrağı bitirmeye: önce ona yetecek kadar, artanı sıradakine.
    flags.sort((a, b) => a.hp - b.hp);
    let k = 0, sent = 0;
    for (const b of mine) {
      command(w, p.team, [b], { type: 'flag', flag: flags[k].i });
      sent += w.balive[b];
      if (sent >= flags[k].hp && k < flags.length - 1) { k++; sent = 0; }
    }
  } else if (p.personality === 'karsi') {
    // En güçlü ekonomiyi hedefler.
    const t = flags.reduce((a, f) => (m.players[f.player].eco > m.players[a.player].eco ? f : a), flags[0]);
    command(w, p.team, mine, { type: 'flag', flag: t.i });
  } else {
    mine.forEach((b, k) => command(w, p.team, [b], { type: 'flag', flag: flags[k % flags.length].i }));
  }
}

export { FAMILIES, PER_BOLUK };
