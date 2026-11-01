// Akın Var — asker sınıfları. throneofcurse'teki 39 sınıfın aynısı: sınıf, donanımdan oluşan bir anahtardır.
// Biçim: <silah>[:malzeme]-<kalkan>[:malzeme]-<binek>-<zırh>, ör. "sp:ir-sh:ir-ho-ch" (demir mızrak, demir kalkan, atlı, zincir zırh).
// Menzil, vuruş aralığı ve hız throneofcurse'ün weapons/mounts/armors tablolarından; 1 birim ≈ throneofcurse'te 19 piksel.
// Fiyat throneofcurse üretim tariflerinden (odun, demir, çelik, deri, yem); görseller throneofcurse warriors/ ve icons/.
import { USTUNLUK } from './veri/ustunluk.js';
import { MALZEME } from './veri/malzeme.js';

const PX = 19; // throneofcurse pikseli → Akın Var birimi

// throneofcurse weapons.json: attackRange (px), cycleMs, visionRange (px). item: eşya (ikon, tarif), img: görsel kodu.
// Görünen adlar dil sözlüğünde (src/diller): silah.<anahtar>, kalkan.<anahtar>, zirh.<anahtar>; ':' yerine '-' (silah.sw-ir).
const WEAPONS = {
  ua: { range: 14, cycle: 800, vision: 200, model: 'fist' },
  'sw:ir': { range: 18, cycle: 800, vision: 200, model: 'sword', item: 'IRON_ONE_HAND_SWORD', img: 'ir_1s' },
  'sw:st': { range: 24, cycle: 800, vision: 200, model: 'sword', item: 'STEEL_ONE_HAND_SWORD', img: 'st_1s' },
  '2s:ir': { range: 18, cycle: 1000, vision: 200, model: 'great', item: 'IRON_TWO_HAND_SWORD', img: 'ir_2s' },
  '2s:st': { range: 24, cycle: 1000, vision: 200, model: 'great', item: 'STEEL_TWO_HAND_SWORD', img: 'st_2s' },
  'sp:wo': { range: 30, cycle: 1000, vision: 200, model: 'spear', item: 'WOODEN_SPEAR', img: 'wo_sp' },
  'sp:ir': { range: 30, cycle: 1000, vision: 200, model: 'spear', item: 'IRON_SPEAR', img: 'ir_sp' },
  'sp:st': { range: 30, cycle: 1000, vision: 200, model: 'spear', item: 'STEEL_SPEAR', img: 'st_sp' },
  bo: { range: 150, cycle: 2500, vision: 200, model: 'bow', ranged: true, item: 'BOW', img: 'bo' },
  lb: { range: 450, cycle: 2500, vision: 500, model: 'bow', ranged: true, item: 'LONG_BOW', img: 'lb' },
  cb: { range: 150, cycle: 3000, vision: 200, model: 'crossbow', ranged: true, item: 'CROSSBOW', img: 'cb' },
  tb: { range: 250, cycle: 2000, vision: 300, model: 'bow', ranged: true, item: 'TURK_BOW', img: 'tb' },
};
const SHIELDS = {
  no: null,
  'sh:wo': { item: 'WOODEN_SHIELD', img: 'wo_sh' },
  'sh:ir': { item: 'IRON_SHIELD', img: 'ir_sh' },
  'sh:st': { item: 'STEEL_SHIELD', img: 'st_sh' },
};
// armors.json speedMult; mounts.json atın hızı; atın zırhı gövde zırhıyla aynı katmandan (throneofcurse unitPresets: ARMOR_TO_HORSE)
const ARMORS = {
  no: { speed: 1, horse: 2, horseItem: 'RACE_HORSE' },
  le: { speed: 1, horse: 1.9, item: 'LEATHER_ARMOR_SET', img: 'le_as', horseItem: 'LEATHER_ARMORED_HORSE' },
  ch: { speed: 0.9, horse: 1.8, item: 'CHAIN_ARMOR_SET', img: 'ch_as', horseItem: 'CHAIN_ARMORED_HORSE' },
  st: { speed: 0.8, horse: 1.7, item: 'STEEL_ARMOR_SET', img: 'st_as', horseItem: 'STEEL_ARMORED_HORSE' },
};

// Fiyat (bir bölük, 20 asker) önce silahın seviyesinden: silahsız < tahta < demir < çelik. Bir seviyenin en pahalısı bile
// bir üst seviyenin en ucuzundan ucuzdur. Yay tahta, uzun yay ve arbalet demir, Türk yayı çelik seviyesindedir.
// Seviye içinde fiyatı kalkan, zırh (deri < zincir < çelik) ve at şekillendirir; aynı seviyedeki silahlar
// throneofcurse ham maddesine göre 10'ar artar (ör. demirde mızrak < uzun yay < arbalet < kılıç < iki el kılıcı).
const RAW_VALUE = { wood: 1, iron: 2, cattle: 1.5, wheat: 0.5 };
const WEAPON_TIER = { ua: 0, 'sp:wo': 1, bo: 1, 'sp:ir': 2, 'sw:ir': 2, '2s:ir': 2, lb: 2, cb: 2, 'sp:st': 3, 'sw:st': 3, '2s:st': 3, tb: 3 };
const PRICE = {
  first: [40, 80], gap: 10, weaponStep: 10,
  shield: { no: 0, 'sh:wo': 20, 'sh:ir': 30, 'sh:st': 50 },
  armor: { no: 0, le: 30, ch: 50, st: 100 },
  horse: { no: 40, le: 50, ch: 60, st: 80 },                      // at, binicinin zırhıyla aynı katmandan zırhlı
};
const valueOf = (item) => { const m = MALZEME[item] ?? {}; return Object.keys(RAW_VALUE).reduce((s, k) => s + (m[k] ?? 0) * RAW_VALUE[k], 0); };
/** Bütün sınıfların fiyatı birlikte: her seviyenin tabanı bir alttakinin en pahalısının hemen üstü. */
function priceAll(list) {
  const extra = (c) => {
    const p = parse(c.key), same = Object.keys(WEAPON_TIER).filter((k) => WEAPON_TIER[k] === WEAPON_TIER[p.w]);
    const rank = same.map((k) => valueOf(WEAPONS[k].item)).sort((a, b) => a - b).indexOf(valueOf(WEAPONS[p.w].item));
    return rank * PRICE.weaponStep + PRICE.shield[p.sh] + PRICE.armor[p.armor] + (p.mounted ? PRICE.horse[p.armor] : 0);
  };
  let base = 0;
  for (let tier = 0; tier <= 3; tier++) {
    const group = list.filter((c) => WEAPON_TIER[parse(c.key).w] === tier);
    base = Math.max(PRICE.first[tier] ?? 0, base);
    for (const c of group) { c.tier = tier; c.cost = base + extra(c); }
    base = Math.max(...group.map((c) => c.cost)) + PRICE.gap;
  }
  return list;
}

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

// Aile adı dil sözlüğünde: aile.<key>
export const FAMILIES = [
  { key: 'kilic', color: '#d9b25f' },
  { key: 'mizrak', color: '#8fc07a' },
  { key: 'okcu', color: '#7eb0e0' },
  { key: 'atli', color: '#e0906e' },
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
  const materials = {
    wood: Math.max(0, Math.round(mat.wood - mat.steel * 12)), iron: Math.max(0, Math.round(mat.iron - mat.steel * 6)),
    steel: Math.round(mat.steel), leather: Math.round(mat.cattle / 3), wheat: Math.round(mat.wheat),
  };
  return {
    key, family, mounted: p.mounted, ranged: !!wpn.ranged, model: wpn.model,
    skirmish: p.mounted && !!wpn.ranged, // atlı okçu (Türk yayı): vur-kaç, yürürken ok atar (sim.js)
    shield: p.sh === 'no' ? 0 : p.sh === 'sh:wo' ? 1 : p.sh === 'sh:ir' ? 2 : 3,
    armor: ['no', 'le', 'ch', 'st'].indexOf(p.armor),
    // Görünen ad ve donanım yazısı arayüzde dile göre kurulur (main.js → sinifAdi, sinifDetay).
    wkey: p.w.replace(':', '-'), skey: p.sh === 'no' ? null : p.sh.replace(':', '-'), akey: p.armor === 'no' ? null : p.armor,
    reach: Math.max(0.85, wpn.range / PX), cycle: wpn.cycle / 1000,
    vision: Math.max(22, wpn.vision / PX), speed, cost: 0, items, materials, img: visualOf(p, wpn, shield, arm),
  };
}

// Kart sırası: ucuzdan pahalıya (en ucuz sol üstte; böylece tahta, demir, çelik sırayla), eşit fiyatta aileye göre.
export const CLASSES = priceAll(Object.keys(USTUNLUK).map(build))
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
