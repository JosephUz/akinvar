// throneofcurse'ten asker görsellerini, eşya ikonlarını ve üretim tariflerini (ham madde dökümü) Akın Var'a alır.
// node scripts/gorsel-al.mjs [throneofcurse yolu]
// Çıktı: img/asker/*.png (sınıf görselleri), img/ikon/*.png (eşya ve ham madde), src/veri/malzeme.js
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';

const toc = process.argv[2] || 'c:/ju/throneofcurse';
const root = new URL('..', import.meta.url);
const pub = `${toc}/client/public`;

mkdirSync(new URL('img/asker', root), { recursive: true });
mkdirSync(new URL('img/ikon', root), { recursive: true });
for (const f of readdirSync(`${pub}/warriors`)) if (f.endsWith('.png')) copyFileSync(`${pub}/warriors/${f}`, new URL(`img/asker/${f}`, root));

const ITEMS = ['WOODEN_SPEAR', 'IRON_SPEAR', 'STEEL_SPEAR', 'IRON_ONE_HAND_SWORD', 'STEEL_ONE_HAND_SWORD', 'IRON_TWO_HAND_SWORD', 'STEEL_TWO_HAND_SWORD',
  'BOW', 'LONG_BOW', 'CROSSBOW', 'TURK_BOW', 'WOODEN_SHIELD', 'IRON_SHIELD', 'STEEL_SHIELD', 'LEATHER_ARMOR_SET', 'CHAIN_ARMOR_SET', 'STEEL_ARMOR_SET',
  'RACE_HORSE', 'LEATHER_ARMORED_HORSE', 'CHAIN_ARMORED_HORSE', 'STEEL_ARMORED_HORSE'];
const RAW = ['WOOD', 'IRON', 'STEEL', 'CATTLE', 'WHEAT', 'LEATHER', 'GOLD', 'SOLDIER_TRAINING'];
for (const k of [...ITEMS, ...RAW]) copyFileSync(`${pub}/icons/${k}_256.png`, new URL(`img/ikon/${k}.png`, root));

// Tarifleri ham maddeye indir: WOOD, IRON, CATTLE (deri), WHEAT (yem).
const src = ['recipes.ts', 'armorerRecipes.ts'].map((f) => readFileSync(`${toc}/shared/constants/${f}`, 'utf8')).join('\n');
const R = {};
const re = /(\w+):\s*\{\s*id:\s*'(\w+)'[\s\S]*?inputs:\s*\[([\s\S]*?)\],\s*outputItemType:\s*'(\w+)',\s*outputCount:\s*(\d+)/g;
for (let m; (m = re.exec(src));) {
  if (R[m[4]]) continue; // ilk tarif (yükseltme tarifleri değil)
  R[m[4]] = { inputs: [...m[3].matchAll(/itemType:\s*'(\w+)',\s*count:\s*(\d+)/g)].map((x) => [x[1], +x[2]]), out: +m[5] };
}
const raw = (item, n = 1, acc = {}) => {
  const r = R[item];
  if (!r) { acc[item] = (acc[item] || 0) + n; return acc; }
  for (const [it, c] of r.inputs) raw(it, (c * n) / r.out, acc);
  return acc;
};
// Çelik ayrıca sayılır (görünür maliyet: odun, demir, çelik); ham maddeye inmiş hali fiyatı belirler.
const steelOf = (item) => { const r = R[item]; if (!r) return 0; let s = 0; for (const [it, c] of r.inputs) s += it === 'STEEL' ? c : 0; return s / r.out; };
const out = {};
for (const k of ITEMS) {
  const r = raw(k), round = (x) => Math.round(x * 10) / 10;
  out[k] = { wood: round(r.WOOD ?? 0), iron: round(r.IRON ?? 0), cattle: round(r.CATTLE ?? 0), wheat: round(r.WHEAT ?? 0), steel: round(steelOf(k)) };
}
writeFileSync(new URL('src/veri/malzeme.js', root),
  `// throneofcurse üretim tarifleri (shared/constants/recipes.ts, armorerRecipes.ts) ham maddeye indirilmiş: bir askerlik eşya.\n` +
  `// wood odun, iron demir, cattle sığır (deri), wheat buğday (yem); steel: tarifteki çelik külçesi (görünür bilgi).\n` +
  `// Üretildi: scripts/gorsel-al.mjs. Elle değiştirme.\nexport const MALZEME = ${JSON.stringify(out, null, 1)};\n`);
console.log('görseller ve malzeme alındı:', Object.keys(out).length, 'eşya');
