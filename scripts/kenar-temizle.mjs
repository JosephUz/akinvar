// Asker görsellerinin kenarındaki camgöbeği haleyi ve sağ alttaki ✦ filigranını temizler.
// throneofcurse görselleri arka planı silinmiş üretim görselleri; silinen zeminin rengi kenarlarda kalmış (ör. Demir kılıç, Uzun yay).
// Kenara 3 pikselden yakın, camgöbeği tonlu piksel içerideki en yakın sağlam pikselin rengini alır (saydamlık aynı kalır).
// sharp Akın Var'ın bağımlılığı değil: node scripts/kenar-temizle.mjs [sharp'ın bulunduğu proje, varsayılan c:/ju/josephuz]
// gorsel-al.mjs görselleri yeniden kopyalarsa bu betik yeniden çalıştırılmalı.
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';

const sharp = createRequire(`${process.argv[2] || 'c:/ju/josephuz'}/package.json`)('sharp');
const dir = new URL('../img/asker/', import.meta.url);
const EDGE = 3, SEARCH = 8, SOLID = 20;
const teal = (r, g, b) => g - r > 10 && b - r > 10 && Math.abs(g - b) < 30;

for (const f of readdirSync(dir).filter((f) => f.endsWith('.png'))) {
  const file = new URL(f, dir);
  const { data, info } = await sharp(file.pathname.slice(1)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, a = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3]);
  const nearEdge = (x, y) => { for (let d = 1; d <= EDGE; d++) if (a(x - d, y) < SOLID || a(x + d, y) < SOLID || a(x, y - d) < SOLID || a(x, y + d) < SOLID) return true; return false; };

  // 1) Hale: kenardaki camgöbeği pikseller
  const bad = new Uint8Array(W * H);
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] > 0 && teal(data[i], data[i + 1], data[i + 2]) && nearEdge(x, y)) { bad[y * W + x] = 1; n++; }
  }
  const src = Buffer.from(data);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!bad[y * W + x]) continue;
    let best = -1, bestD = Infinity;
    for (let dy = -SEARCH; dy <= SEARCH; dy++) for (let dx = -SEARCH; dx <= SEARCH; dx++) {
      const X = x + dx, Y = y + dy, d = dx * dx + dy * dy;
      if (d >= bestD || X < 0 || Y < 0 || X >= W || Y >= H || bad[Y * W + X]) continue;
      const j = (Y * W + X) * 4;
      if (src[j + 3] > 200 && !teal(src[j], src[j + 1], src[j + 2])) { best = j; bestD = d; }
    }
    const i = (y * W + x) * 4;
    if (best >= 0) { data[i] = src[best]; data[i + 1] = src[best + 1]; data[i + 2] = src[best + 2]; }
    else { const l = Math.round(0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2]); data[i] = data[i + 1] = data[i + 2] = l; }
  }

  // 2) Filigran: sağ alt köşedeki küçük ayrık parça
  const seen = new Uint8Array(W * H);
  let wm = 0;
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || data[s * 4 + 3] < SOLID) continue;
    const comp = [s]; seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k], x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy, q = Y * W + X;
        if (X >= 0 && Y >= 0 && X < W && Y < H && !seen[q] && data[q * 4 + 3] >= SOLID) { seen[q] = 1; comp.push(q); }
      }
    }
    if (comp.length < 400 && comp.every((p) => p % W > W * 0.85 && p / W > H * 0.85)) { for (const p of comp) data[p * 4 + 3] = 0; wm += comp.length; }
  }

  if (n || wm) {
    await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file.pathname.slice(1));
    console.log(`${f}: ${n} hale pikseli${wm ? `, filigran ${wm} piksel` : ''}`);
  }
}
