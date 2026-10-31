// throneofcurse üstünlük tablosunu Akın Var'a alır: node scripts/ustunluk-al.mjs [throneofcurse yolu]
import { readFileSync, writeFileSync } from 'node:fs';
const kaynak = process.argv[2] || 'c:/ju/throneofcurse';
const m = JSON.parse(readFileSync(`${kaynak}/shared/constants/combat/counterMatrix.json`, 'utf8'));
writeFileSync(new URL('../src/veri/ustunluk.js', import.meta.url),
  `// throneofcurse shared/constants/combat/counterMatrix.json — saldıran → savunan isabet puanı (0–100).\n// Üretildi: scripts/ustunluk-al.mjs. Elle değiştirme; throneofcurse'te değişirse betiği yeniden koş.\nexport const USTUNLUK = ${JSON.stringify(m)};\n`);
console.log(Object.keys(m).length, 'sınıf alındı');
