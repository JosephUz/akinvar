// Akın Var — asker sınıfları. throneofcurse'teki 39 sınıfın aynısı: sınıf, donanımdan oluşan bir anahtardır.
// Biçim: <silah>[:malzeme]-<kalkan>[:malzeme]-<binek>-<zırh>, ör. "sp:ir-sh:ir-ho-ch" (demir mızrak, demir kalkan, atlı, zincir zırh).
// Menzil, vuruş aralığı ve hız throneofcurse'ün weapons/mounts/armors tablolarından; 1 birim ≈ throneofcurse'te 19 piksel.
import { USTUNLUK } from './veri/ustunluk.js';

const PX = 19; // throneofcurse pikseli → Akın Var birimi

// throneofcurse weapons.json: attackRange (px), cycleMs, visionRange (px)
const WEAPONS = {
  ua: { name: 'Silahsız', range: 14, cycle: 800, vision: 200, cost: 30, model: 'fist' },
  'sw:ir': { name: 'Demir kılıç', range: 18, cycle: 800, vision: 200, cost: 100, model: 'sword' },
  'sw:st': { name: 'Çelik kılıç', range: 24, cycle: 800, vision: 200, cost: 160, model: 'sword' },
  '2s:ir': { name: 'Demir iki el kılıcı', range: 18, cycle: 1000, vision: 200, cost: 130, model: 'great' },
  '2s:st': { name: 'Çelik iki el kılıcı', range: 24, cycle: 1000, vision: 200, cost: 190, model: 'great' },
  'sp:wo': { name: 'Tahta mızrak', range: 30, cycle: 1000, vision: 200, cost: 60, model: 'spear' },
  'sp:ir': { name: 'Demir mızrak', range: 30, cycle: 1000, vision: 200, cost: 100, model: 'spear' },
  'sp:st': { name: 'Çelik mızrak', range: 30, cycle: 1000, vision: 200, cost: 150, model: 'spear' },
  bo: { name: 'Yay', range: 150, cycle: 2500, vision: 200, cost: 110, model: 'bow', ranged: true },
  lb: { name: 'Uzun yay', range: 450, cycle: 2500, vision: 500, cost: 180, model: 'bow', ranged: true },
  cb: { name: 'Arbalet', range: 150, cycle: 3000, vision: 200, cost: 150, model: 'crossbow', ranged: true },
  tb: { name: 'Türk yayı', range: 250, cycle: 2000, vision: 300, cost: 170, model: 'bow', ranged: true },
};
const SHIELDS = { no: null, 'sh:wo': { name: 'Tahta kalkan', cost: 20 }, 'sh:ir': { name: 'Demir kalkan', cost: 40 }, 'sh:st': { name: 'Çelik kalkan', cost: 70 } };
// armors.json speedMult; atın zırhı gövde zırhıyla aynı katmandan (throneofcurse unitPresets: ARMOR_TO_HORSE)
const ARMORS = { no: { name: '', speed: 1, cost: 0, horse: 2 }, le: { name: 'Deri zırh', speed: 1, cost: 40, horse: 1.9 }, ch: { name: 'Zincir zırh', speed: 0.9, cost: 80, horse: 1.8 }, st: { name: 'Çelik zırh', speed: 0.8, cost: 140, horse: 1.7 } };
const HORSE_COST = 200;

export const FAMILIES = [
  { key: 'kilic', name: 'Kılıçlı', color: '#c9a35c' },
  { key: 'mizrak', name: 'Mızraklı', color: '#8fb07a' },
  { key: 'okcu', name: 'Okçu', color: '#7ea7c9' },
  { key: 'atli', name: 'Atlı', color: '#c98a6e' },
];

function parse(key) {
  const [w, sh, mount, armor] = key.split('-');
  return { w, sh: sh === 'no' ? 'no' : sh, mounted: mount === 'ho', armor };
}

function build(key, index) {
  const p = parse(key), wpn = WEAPONS[p.w], arm = ARMORS[p.armor];
  const family = p.mounted ? 3 : wpn.ranged ? 2 : p.w.startsWith('sp') ? 1 : 0;
  const speed = (p.mounted ? arm.horse : 1) * arm.speed;
  const shield = SHIELDS[p.sh];
  const cost = wpn.cost + (shield?.cost ?? 0) + arm.cost + (p.mounted ? HORSE_COST : 0);
  const extras = [shield?.name, arm.name].filter(Boolean);
  return {
    key, index, family, mounted: p.mounted, ranged: !!wpn.ranged, model: wpn.model,
    shield: p.sh === 'no' ? 0 : p.sh === 'sh:wo' ? 1 : p.sh === 'sh:ir' ? 2 : 3,
    armor: ['no', 'le', 'ch', 'st'].indexOf(p.armor),
    title: (p.mounted ? 'Atlı · ' : '') + wpn.name,
    detail: extras.join(' · ') || 'Zırhsız',
    reach: Math.max(0.85, wpn.range / PX), cycle: wpn.cycle / 1000,
    vision: Math.max(22, wpn.vision / PX), speed, cost,
  };
}

// Kart sırası: aileye göre, aile içinde ucuzdan pahalıya.
export const CLASSES = Object.keys(USTUNLUK).map(build)
  .sort((a, b) => a.family - b.family || a.cost - b.cost)
  .map((c, i) => ({ ...c, index: i }));
export const CLASS_BY_KEY = Object.fromEntries(CLASSES.map((c) => [c.key, c]));

// İsabet puanı tablosu sınıf numarasıyla: HIT[a * n + d]
const n = CLASSES.length;
export const HIT = new Uint8Array(n * n);
for (const a of CLASSES) for (const d of CLASSES) HIT[a.index * n + d.index] = USTUNLUK[a.key][d.key];
export const CLASS_COUNT = n;

// throneofcurse coefficients.json
export const COMBAT = { backBonus: 20, min: 0.1, minUnarmed: 0.05, max: 0.95 };
export function hitChance(a, d, behind) {
  const s = (HIT[a * n + d] + (behind ? COMBAT.backBonus : 0)) / 100;
  return Math.max(CLASSES[a].model === 'fist' ? COMBAT.minUnarmed : COMBAT.min, Math.min(COMBAT.max, s));
}
