// Akın Var — maç: oyuncular, para, ekonomi, talim, bayrak canı ve tur döngüsü.
// Tur: hazırlık (kartlarla bölük al) → savaş (sim.js) → bayrak evresi (kazanan sağ kalanlarını bayraklara yollar).
// Askerler tura geçmez; turdan tura yalnız ekonomi seviyesi, talim ve biriken para taşınır.
import { ECONOMY, TALIM, PERSONALITIES, TEAMS, DIFFICULTY } from './config.js';
import { CLASSES, CLASS_COUNT, HIT, FAMILIES } from './units.js';

const zeros = () => new Array(CLASS_COUNT).fill(0); // sınıf başına geliştirme seviyesi
import { createBattle, startFlagPhase, mulberry32, command, PER_BOLUK, snapshot, applySnapshot } from './sim.js';

/** Bir üst ekonomi seviyesinin bedeli: o seviyedeyken alınan tur gelirinin yarısı (0 → ◉500, 1 → ◉575, 2 → ◉650). */
export const ecoCost = (level) => Math.round((ECONOMY.roundIncome + level * ECONOMY.levelIncome) * ECONOMY.costShare);
export const income = (p) => ECONOMY.roundIncome + p.eco * ECONOMY.levelIncome;
/** Geliştir bedeli her sınıfta ve her seviyede aynı: oyuncunun o anki tur gelirinin yarısı (ekonomi büyüdükçe artar). */
export const talimCost = (p) => Math.round(income(p) * TALIM.share);

/**
 * teamSize oyuncu takım başına. Tek başına: humans = [0] (oyuncu 0 insan, Mavi). Çevrim içi: seats[koltuk] = { name } ya da null (bot);
 * koltuk sırası oyuncu sırasıdır (ilk teamSize Mavi, sonrakiler Kırmızı). Her oyuncunun bir bot kişiliği vardır: insan koparsa o oynar.
 */
export function createMatch({ teamSize = 1, flagHp = 100, difficulty = 'orta', seed = (Math.random() * 1e9) | 0, humans = [0], seats = null } = {}) {
  const rng = mulberry32(seed);
  const players = [];
  for (const team of [0, 1]) for (let k = 0; k < teamSize; k++) {
    const id = players.length, seat = seats ? seats[id] : null, human = seats ? !!seat : humans.includes(id);
    const pers = PERSONALITIES[(rng() * PERSONALITIES.length) | 0];
    players.push({
      id, team, human, personality: pers.key, botName: pers.key,
      name: seat?.name ?? (human ? '' : pers.key), color: TEAMS[team].shades[k % 5], // bot adı arayüzde kisilik.<key>
      gold: 0, eco: 0, talim: zeros(), hp: flagHp, maxHp: flagHp, out: false,
      units: [], ready: false, bought: { eco: 0, talim: zeros() }, lastUnits: [],
    });
  }
  const m = { seed, rng, round: 0, flagHp, teamSize, difficulty: DIFFICULTY[difficulty] ? difficulty : 'orta', players, phase: 'prep', battle: null, winner: -1, log: [] };
  startRound(m);
  return m;
}

export function alivePlayers(m, team) { return m.players.filter((p) => !p.out && (team === undefined || p.team === team)); }

function startRound(m) {
  m.round++; m.phase = 'prep'; m.battle = null;
  for (const p of m.players) {
    p.units = []; p.ready = p.out; p.bought = { eco: 0, talim: zeros(), paid: {} };
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
/** Bu turda o sınıfa son ödenen geliştirme bedeli (take: listeden düşer). */
export function talimPaid(p, family, take = false) {
  const list = p.bought.paid?.[family];
  if (!list?.length) return talimCost(p);
  return take ? list.pop() : list.at(-1);
}
/** Geliştir: o sınıfın her askerine +1 can (kalıcı). */
export function buyTalim(m, p, family) {
  if (!(family >= 0 && family < CLASS_COUNT)) return false;
  const lv = p.talim[family], cost = talimCost(p);
  if (m.phase !== 'prep' || p.out || p.ready || lv >= TALIM.max || p.gold < cost) return false;
  p.gold -= cost; p.talim[family]++; p.bought.talim[family]++;
  ((p.bought.paid ??= {})[family] ??= []).push(cost); // geri verince ödenen aynen döner (arada ekonomi alınsa da)
  return true;
}
export function refundTalim(m, p, family) {
  if (!(family >= 0 && family < CLASS_COUNT)) return false;
  if (m.phase !== 'prep' || p.ready || !p.bought.talim[family]) return false;
  p.talim[family]--; p.bought.talim[family]--; p.gold += talimPaid(p, family, true); return true;
}
export function setReady(m, p) { p.ready = true; }

/** Çevrim içi: koltuktaki insan koptu (bot oynar) ya da döndü. Hazırlıktaysa ve hazır demediyse bot onun yerine alışveriş yapar. */
export function setHuman(m, p, human, name) {
  p.human = human;
  if (human) { if (name) p.name = name; return; }
  p.name = p.botName;
  if (m.phase === 'prep' && !p.ready && !p.out) botPrep(m, p);
}

/** Bir takımın gözünden maç: rakiplerin bu turda aldıkları gizli. */
export function matchView(m, team) {
  return {
    round: m.round, phase: m.phase, flagHp: m.flagHp, teamSize: m.teamSize, difficulty: m.difficulty, winner: m.winner, order: m.order, log: m.log.slice(-3),
    players: m.players.map((p) => ({
      id: p.id, team: p.team, human: p.human, name: p.name, color: p.color, personality: p.personality, botName: p.botName,
      gold: p.team === team ? p.gold : 0, eco: p.eco, talim: p.talim, hp: p.hp, maxHp: p.maxHp, out: p.out, ready: p.ready,
      units: p.team === team ? p.units : [], bought: p.bought, lastUnits: p.lastUnits,
    })),
  };
}
export const allReady = (m) => m.players.every((p) => p.ready);

// ---------- savaş ----------

export function startBattle(m) {
  m.phase = 'battle';
  m.hpBefore = Object.fromEntries(m.players.map((p) => [p.id, p.hp])); // tur sonu özeti: ölenler + bayrak evresi
  const active = m.players.filter((p) => !p.out);
  m.order = active.map((p) => p.id); // savaştaki oyuncu sırası → maç oyuncusu
  // Kurulum çevrim içi istemcilere aynen gider: aynı tohum ve aynı ordular aynı savaşı kurar.
  m.battleSetup = {
    seed: (m.rng() * 1e9) | 0,
    players: active.map((p) => ({ team: p.team, human: p.human, units: [...p.units], talim: [...p.talim] })),
  };
  m.battle = createBattle(m.battleSetup);
  for (const p of active) p.lastUnits = [...p.units];
  return m.battle;
}

/** Savaşta ölen askerler (kazanan ya da kaybeden, alan dışında ölen de): oyuncu başına sayı. Bayrağa gidenler sayılmaz. */
export function battleLosses(m, w = m.battle) {
  const lost = new Map();
  for (let i = 0; i < w.N; i++) if (w.hp[i] <= 0 && !w.spent[i]) { const id = m.order[w.bowner[w.boluk[i]]]; lost.set(id, (lost.get(id) ?? 0) + 1); }
  return lost;
}

/**
 * Savaş bitti. Önce her oyuncunun ölen askeri kadar kendi bayrağından can gider; canı biten elenir.
 * Sonra kaybeden takımın ayaktaki oyuncularının bayrakları dikilir: kazananların sağ kalanları onlara yüklenir.
 */
export function startFlags(m) {
  const w = m.battle;
  m.losses = {};
  for (const [id, n] of battleLosses(m)) {
    const p = m.players[id]; m.losses[id] = n;
    p.hp = Math.max(0, p.hp - n); if (!p.hp) p.out = true;
  }
  if (w.winner !== 0 && w.winner !== 1) { m.phase = 'flag'; w.phase = 'done'; return; }
  const losers = alivePlayers(m, 1 - w.winner);
  if (!losers.length || !alivePlayers(m, w.winner).length) { m.phase = 'flag'; w.phase = 'done'; return; }
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
  m.log.push({ round: m.round, winner: w.winner, losses: m.losses ?? {}, flags: w.flags.map((f) => ({ player: f.player, hits: f.hits })) });
  const left = [0, 1].map((t) => alivePlayers(m, t).length);
  // İki takım birden düştüyse turu kazanan maçı da kazanır.
  if (!left[0] || !left[1]) { m.phase = 'over'; m.winner = left[0] ? 0 : left[1] ? 1 : w.winner === 1 ? 1 : 0; return; }
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

export function botPrep(m, p) {
  const rng = m.rng, r = m.round, enemies = m.players.filter((q) => q.team !== p.team && !q.out);
  // 1) Ekonomi
  const ecoTarget = { acgozlu: Math.min(8, r + 1), akinci: Math.floor(r / 4), dengeli: Math.ceil(r / 2), karsi: Math.floor(r / 2) }[p.personality];
  while (p.eco < ecoTarget && p.gold - ecoCost(p.eco) >= (p.personality === 'acgozlu' ? 150 : 500)) buyEco(m, p);
  // 2) Geliştir: dengeli ve karşı kurucu, en çok bastığı sınıfı
  if ((p.personality === 'dengeli' || p.personality === 'karsi') && r >= 3) {
    const fam = favoriteClass(p);
    if (fam >= 0 && p.gold - talimCost(p) >= 400) buyTalim(m, p, fam);
  }
  // 3) Askerler: kalan parayla. Açgözlü ve Dengeli sıradaki ekonomi seviyesi için bir kısmını biriktirir.
  const saving = p.eco < ecoTarget ? ({ acgozlu: 0.6, dengeli: 0.3 }[p.personality] ?? 0) : 0;
  const level = DIFFICULTY[m.difficulty];
  const keep = Math.max(Math.min(p.gold, ecoCost(p.eco)) * saving, p.gold * (1 - level.spend));
  const tier = Math.min(1, 0.25 + r * 0.12); // turlar ilerledikçe pahalı sınıflar
  let guard = 200;
  while (guard-- > 0) {
    const opts = affordable(p).filter((c) => p.gold - c.cost >= keep);
    if (!opts.length) break;
    let pick;
    if (p.personality === 'karsi' && level.counter && enemies.some((e) => e.lastUnits.length)) pick = counterPick(opts, enemies, rng);
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

function favoriteClass(p) {
  const n = zeros();
  for (const u of p.lastUnits.length ? p.lastUnits : p.units) n[u]++;
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

// ---------- tek başına kayıt ----------
// Maç düz JSON'a çevrilir; üretecin yalnız durumu (rng.s) yazılır. Savaş sürüyorsa çevrim içi anlıkla (sim.js snapshot)
// tam durumu base64 olarak eklenir: savaş kurulumundan (battleSetup) yeniden kurulup anlık üstüne yazılır.
// Sürüm 2: savaş anlığına atlı hücumu alanları eklendi; sürüm 1 kaydın yalnız hazırlıktakisi açılır.
export const SAVE_VERSION = 2;

const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export function saveMatch(m) {
  const { rng, battle, ...rest } = m;
  return { v: SAVE_VERSION, rng: rng.s, m: rest, battle: battle ? toB64(snapshot(battle)) : null };
}

/** Kayıttan maç; kayıt bozuksa ya da eski sürümdense null. */
export function loadMatch(save) {
  if (!save || !(save.v === SAVE_VERSION || (save.v === 1 && !save.battle)) || !save.m?.players?.length) return null;
  const m = { ...save.m, rng: mulberry32(0), battle: null };
  m.rng.s = save.rng >>> 0;
  if (save.battle) {
    if (!m.battleSetup) return null;
    m.battle = createBattle(m.battleSetup);
    if (!applySnapshot(m.battle, fromB64(save.battle))) return null;
  }
  return m;
}
