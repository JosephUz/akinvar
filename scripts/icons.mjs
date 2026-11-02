import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Uygulama simgesi ve açılış ekranı (Çayır Muhafızı'ndaki betiğin uyarlaması): çapraz pala ve mızrak (SVG) Playwright'la
 * PNG'ye çizilir ve android/ kaynaklarına yazılır (eski simge, yuvarlak simge, uyarlanabilir simge ön yüzü; açılış
 * görselleri mevcut boyutlarında). store/ altına Play Store için 512 px simge ve 1024x500 tanıtım görseli (Türkçe ve İngilizce).
 * Yalnızca simge değişince elle çalıştırılır:
 *   PLAYWRIGHT=<playwright index.mjs> node scripts/icons.mjs   (Playwright'ın kendi Chromium'u; kurulu Chrome kullanılmaz)
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const { chromium } = await import(process.env.PLAYWRIGHT || 'file:///c:/ju/sonplaka/node_modules/playwright/index.mjs');
const BG = '#1d2a1f', GOLD = '#e0bf6c';

/** Çapraz pala ve mızrak: oyunun iki temel bölüğü; 48 px'te de okunur. */
const CREAM = '#f1ead4', WOOD = '#9b7b4a';
const art = `<g transform="translate(50 50)">
  <g transform="rotate(45)"><path d="M0 -42 L 3 -34 V 34 H -3 V -34 Z" fill="${CREAM}"/><path d="M0 -46 L 5 -36 L 0 -32 L -5 -36 Z" fill="${GOLD}"/><rect x="-1.5" y="-30" width="3" height="72" fill="${WOOD}"/></g>
  <g transform="rotate(-45)"><path d="M-2 -40 C 6 -30 6 -4 3 14 H -3 C -1 -6 -2 -26 -2 -40 Z" fill="${CREAM}"/><rect x="-10" y="14" width="20" height="4" rx="2" fill="${GOLD}"/><rect x="-2.5" y="18" width="5" height="16" rx="2" fill="${WOOD}"/><circle cx="0" cy="37" r="3.5" fill="${GOLD}"/></g>
</g>`;
/** frame: 'square' | 'round' | 'none' (uyarlanabilir ön yüz: saydam, içerik ortadaki güvenli alanda). */
const svg = (frame, scale = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  ${frame === 'square' ? `<rect width="100" height="100" rx="22" fill="${BG}"/>` : frame === 'round' ? `<circle cx="50" cy="50" r="50" fill="${BG}"/>` : ''}
  ${frame !== 'none' ? '<circle cx="50" cy="50" r="46" fill="#ffffff08"/>' : ''}
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${art}</g></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(html, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  writeFileSync(file, await page.screenshot({ omitBackground: true }));
}
const box = (inner, w, h, bg = 'transparent') => `<div style="width:${w}px;height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center">${inner}</div>`;

const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITY)) {
  const dir = path.join(res, 'mipmap-' + d), icon = Math.round(48 * k), fg = Math.round(108 * k);
  await png(box(svg('square', 0.92), icon, icon), icon, icon, path.join(dir, 'ic_launcher.png'));
  await png(box(svg('round', 0.9), icon, icon), icon, icon, path.join(dir, 'ic_launcher_round.png'));
  await png(box(svg('none', 0.62), fg, fg), fg, fg, path.join(dir, 'ic_launcher_foreground.png'));
}
writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);

/** Açılış görseli: koyu yeşil zemin, ortada simge ve AKIN VAR yazısı; mevcut splash.png boyutları korunur. */
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.34;
  return box(`<div style="text-align:center;font:600 ${s * 0.24}px Georgia,serif;color:#f1ead4;letter-spacing:${s * 0.04}px">
    <div style="width:${s}px;height:${s}px;margin:0 auto ${s * 0.06}px">${svg('none')}</div>AKIN <span style="color:${GOLD}">VAR</span></div>`, w, h, BG);
};
for (const dir of readdirSync(res).filter(d => d.startsWith('drawable'))) {
  const file = path.join(res, dir, 'splash.png');
  let head; try { head = readFileSync(file); } catch { continue; }
  const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
  await png(splash(w, h), w, h, file);
}

mkdirSync(path.join(root, 'store'), { recursive: true });
await png(box(svg('square', 0.92).replace('rx="22"', 'rx="0"'), 512, 512), 512, 512, path.join(root, 'store', 'icon-512.png'));
// Tanıtım görseli Türkçe ve İngilizce (ad çevrilmez, yalnız alt yazı): feature-1024x500.png, feature-1024x500-en.png
for (const [ek, alt] of [['', 'KUR. BUL. YÜKLEN.'], ['-en', 'BUILD. FIND. CHARGE.']]) {
  await png(box(`<div style="display:flex;align-items:center;gap:40px;font:600 84px Georgia,serif;color:#f1ead4;letter-spacing:8px">
  <div style="width:300px;height:300px">${svg('none')}</div><div>AKIN <span style="color:${GOLD}">VAR</span>
  <div style="font:700 24px system-ui,Segoe UI,sans-serif;letter-spacing:5px;color:#c4cdb6;margin-top:10px">${alt}</div></div></div>`, 1024, 500, BG), 1024, 500, path.join(root, 'store', `feature-1024x500${ek}.png`));
}
await browser.close();
console.log('simgeler hazır');
