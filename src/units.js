// Akın Var — asker sınıfları. throneofcurse'teki 39 sınıfın aynısı: sınıf, donanımdan oluşan bir anahtardır.
// Biçim: <silah>[:malzeme]-<kalkan>[:malzeme]-<binek>-<zırh>, ör. "sp:ir-sh:ir-ho-ch" (demir mızrak, demir kalkan, atlı, zincir zırh).
// Menzil, vuruş aralığı ve hız throneofcurse'ün weapons/mounts/armors tablolarından; 1 birim ≈ throneofcurse'te 19 piksel.
// Fiyat throneofcurse üretim tariflerinden (odun, demir, çelik, deri, yem); görseller throneofcurse warriors/ ve icons/.
import { USTUNLUK } from './veri/ustunluk.js';
import { MALZEME } from './veri/malzeme.js';

const PX = 19; // throneofcurse pikseli → Akın Var birimi

// throneofcurse weapons.json: attackRange (px), cycleMs, visionRange (px). item: eşya (ikon, tarif), img: görsel kodu.
const WEAPONS = {
  ua: { name: 'Silahsız', range: 14, cycle: 800, vision: 200, model: 'fist' },
  'sw:ir': { name: 'Demir kılıç', range: 18, cycle: 800, vision: 200, model: 'sword', item: 'IRON_ONE_HAND_SWORD', img: 'ir_1s' },
  'sw:st': { name: 'Çelik kılıç', range: 24, cycle: 800, vision: 200, model: 'sword', item: 'STEEL_ONE_HAND_SWORD', img: 'st_1s' },
  '2s:ir': { name: 'Demir iki el kılıcı', range: 18, cycle: 1000, vision: 200, model: 'great', item: 'IRON_TWO_HAND_SWORD', img: 'ir_2s' },
  '2s:st': { name: 'Çelik iki el kılıcı', range: 24, cycle: 1000, vision: 200, model: 'great', item: 'STEEL_TWO_HAND_SWORD', img: 'st_2s' },
  'sp:wo': { name: 'Tahta mızrak', range: 30, cycle: 1000, vision: 200, model: 'spear', item: 'WOODEN_SPEAR', img: 'wo_sp' },
  'sp:ir': { name: 'Demir mızrak', range: 30, cycle: 1000, vision: 200, model: 'spear', item: 'IRON_SPEAR', img: 'ir_sp' },
  'sp:st': { name: 'Çelik mızrak', range: 30, cycle: 1000, vision: 200, model: 'spear', item: 'STEEL_SPEAR', img: 'st_sp' },
  bo: { name: 'Yay', range: 150, cycle: 2500, vision: 200, model: 'bow', ranged: true, item: 'BOW', img: 'bo' },
  lb: { name: 'Uzun yay', range: 450, cycle: 2500, vision: 500, model: 'bow', ranged: true, item: 'LONG_BOW', img: 'lb' },
  cb: { name: 'Arbalet', range: 150, cycle: 3000, vision: 200, model: 'crossbow', ranged: true, item: 'CROSSBOW', img: 'cb' },
  tb: { name: 'Türk yayı', range: 250, cycle: 2000, vision: 300, model: 'bow', ranged: true, item: 'TURK_BOW', img: 'tb' },
};
const SHIELDS = {
  no: null,
  'sh:wo': { name: 'Tahta kalkan', item: 'WOODEN_SHIELD', img: 'wo_sh' },
  'sh:ir': { name: 'Demir kalkan', item: 'IRON_SHIELD', img: 'ir_sh' },
  'sh:st': { name: 'Çelik kalkan', item: 'STEEL_SHIELD', img: 'st_sh' },
};
// armors.json speedMult; mounts.json atın hızı; atın zırhı gövde zırhıyla aynı katmandan (throneofcurse unitPresets: ARMOR_TO_HORSE)
const ARMORS = {
  no: { name: '', speed: 1, horse: 2, horseItem: 'RACE_HORSE' },
  le: { name: 'Deri zırh', speed: 1, horse: 1.9, item: 'LEATHER_ARMOR_SET', img: 'le_as', horseItem: 'LEATHER_ARMORED_HORSE' },
  ch: { name: 'Zincir zırh', speed: 0.9, horse: 1.8, item: 'CHAIN_ARMOR_SET', img: 'ch_as', horseItem: 'CHAIN_ARMORED_HORSE' },
  st: { name: 'Çelik zırh', speed: 0.8, horse: 1.7, item: 'STEEL_ARMOR_SET', img: 'st_as', horseItem: 'STEEL_ARMORED_HORSE' },
};

// Fiyat (bir bölük, 20 asker): asker başı eşyaların ham maddesinden. Demir odundan, deri yemden değerli.
// Çelik ham maddede çok tuttuğu için üsle (0,35) sıkıştırılır: sıra korunur, ama çelik bölüğü parasına göre güçlü kalır
// (bir çelik bölüğü ~3 demir bölüğü fiyatına, savaşta 3 demir bölüğünü çoğunlukla yener).
const RAW_VALUE = { wood: 1, iron: 2, cattle: 1.5, wheat: 0.5 };
const PRICE = { base: 40, k: 36, exp: 0.35 };
export const priceOf = (value) => Math.round((PRICE.base + PRICE.k * value ** PRICE.exp) / 10) * 10;

// throneofcurse warriors/*.png görsel kodu: en ayrıntılıdan genele (SoldierVisual.tsx resolveSoldierVisualCode)
const VISUALS = new Set(['wo_sp', 'wo_sp_wo_sh', 'ir_sp', 'ir_sp_ir_sh', 'ir_sp_ir_sh_le_as', 'ir_sp_ir_sh_ch_as', 'ir_1s', 'ir_1s_ir_sh', 'ir_1s_ir_sh_le_as',
  'ir_1s_ir_sh_ch_as', 'ir_2s', 'ir_2s_le_as', 'ir_2s_ch_as', 'st_sp', 'st_sp_st_sh', 'st_sp_st_sh_st_as', 'st_1s', 'st_1s_st_sh', 'st_1s_st_sh_st_as', 'st_2s',
  'st_2s_st_as', 'bo', 'lb', 'lb_le_as', 'cb', 'cb_le_as', 'cb_ch_as', 'tb', 'tb_le_as', 'tb_no_ho_no', 'tb_no_ho_le', 'wo_sp_wo_sh_ho', 'ir_1s_ir_sh_le_as_ho',
  'ir_1s_ir_sh_ch_as_ho', 'ir_sp_ir_sh_le_as_ho', 'ir_sp_ir_sh_ch_as_ho', 'st_1s_st_sh_st_as_ho', 'st_sp_st_sh_st_as_ho']);
function visualOf(p, wpn, shield, arm) {
  if (!wpn.img) return 'soldier';
  if (p.w === 'tb' && p.mounted) { const c = `tb_no_ho_${p.armor}`; return VISUALS.has(c) ? c : 'tb_no_ho_no'; }
  const parts = [wpn.img, shield?.img, arm.img, p.mounted ? 'ho' : null].filter(Boolean);
  for (let i = parts.length; i > 0; i--) { const c = parts.slice(0, i).join('_'); if (VISUALS.has(c)) return c; }
  return 'soldier';
}

export const FAMILIES = [
  { key: 'kilic', name: 'Kılıçlı', color: '#d9b25f' },
  { key: 'mizrak', name: 'Mızraklı', color: '#8fc07a' },
  { key: 'okcu', name: 'Okçu', color: '#7eb0e0' },
  { key: 'atli', name: 'Atlı', color: '#e0906e' },
];

function parse(key) {
  const [w, sh, mount, armor] = key.split('-');
  return { w, sh, mounted: mount === 'ho', armor };
}

function build(key) {
  const p = parse(key), wpn = WEAPONS[p.w], arm = ARMORS[p.armor], shield = SHIELDS[p.sh];
  const family = p.mounted ? 3 : wpn.ranged ? 2 : p.w.startsWith('sp') ? 1 : 0;
  const speed = (p.mounted ? arm.horse : 1) * arm.speed;
  const items = [wpn.item, shield?.item, arm.item, p.mounted ? arm.horseItem : null].filter(Boolean);
  // Asker başı malzeme: ham madde (fiyat için) ve görünür döküm (odun, demir, çelik külçesi, deri, yem).
  // Çelik külçesi = 6 demir + 3 yakacak (12 odun); görünür dökümde çeliğin içindeki demir ve odun ayrıca sayılmaz.
  const mat = { wood: 0, iron: 0, cattle: 0, wheat: 0, steel: 0 };
  for (const it of items) for (const k in mat) mat[k] += MALZEME[it]?.[k] ?? 0;
  const value = mat.wood * RAW_VALUE.wood + mat.iron * RAW_VALUE.iron + mat.cattle * RAW_VALUE.cattle + mat.wheat * RAW_VALUE.wheat;
  const materials = {
    wood: Math.max(0, Math.round(mat.wood - mat.steel * 12)), iron: Math.max(0, Math.round(mat.iron - mat.steel * 6)),
    steel: Math.round(mat.steel), leather: Math.round(mat.cattle / 3), wheat: Math.round(mat.wheat),
  };
  return {
    key, family, mounted: p.mounted, ranged: !!wpn.ranged, model: wpn.model,
    shield: p.sh === 'no' ? 0 : p.sh === 'sh:wo' ? 1 : p.sh === 'sh:ir' ? 2 : 3,
    armor: ['no', 'le', 'ch', 'st'].indexOf(p.armor),
    title: (p.mounted ? 'Atlı · ' : '') + wpn.name,
    detail: [shield?.name, arm.name].filter(Boolean).join(' · ') || 'Zırhsız',
    reach: Math.max(0.85, wpn.range / PX), cycle: wpn.cycle / 1000,
    vision: Math.max(22, wpn.vision / PX), speed, cost: priceOf(value), items, materials, img: visualOf(p, wpn, shield, arm),
  };
}

// Kart sırası: ucuzdan pahalıya (en ucuz sol üstte), eşit fiyatta aileye göre.
export const CLASSES = Object.keys(USTUNLUK).map(build)
  .sort((a, b) => a.cost - b.cost || a.family - b.family || a.key.localeCompare(b.key))
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
