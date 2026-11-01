import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Uygulama simgesi ve açılış ekranı (Çayır Muhafızı'ndaki betiğin uyarlaması): oyunun altın sancağı (SVG) Playwright'la
 * PNG'ye çizilir ve android/ kaynaklarına yazılır (eski simge, yuvarlak simge, uyarlanabilir simge ön yüzü; açılış
 * görselleri mevcut boyutlarında). store/ altına Play Store için 512 px simge ve 1024x500 tanıtım görseli.
 * Yalnızca simge değişince elle çalıştırılır:
 *   PLAYWRIGHT=<playwright index.mjs> node scripts/icons.mjs   (Playwright'ın kendi Chromium'u; kurulu Chrome kullanılmaz)
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const { chromium } = await import(process.env.PLAYWRIGHT || 'file:///c:/ju/sonplaka/node_modules/playwright/index.mjs');
const BG = '#1d2a1f', GOLD = '#e0bf6c';

/** Sancak: sitenin marka işareti (index.html .brand), altın; altında çayır yayı. */
const art = `
  <path d="M14 86 Q50 70 86 86 Z" fill="#4f6b3a"/>
  <g transform="translate(50 47) scale(2.25) translate(-20.5 -20.5)"><path d="M11 36V5l19 6-15 6v19z" fill="${GOLD}"/></g>`;
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

/** Açılış görseli: koyu yeşil zemin, ortada sancak ve AKIN VAR yazısı; mevcut splash.png boyutları korunur. */
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
await png(box(`<div style="display:flex;align-items:center;gap:40px;font:600 84px Georgia,serif;color:#f1ead4;letter-spacing:8px">
  <div style="width:300px;height:300px">${svg('none')}</div><div>AKIN <span style="color:${GOLD}">VAR</span>
  <div style="font:700 24px system-ui,Segoe UI,sans-serif;letter-spacing:5px;color:#c4cdb6;margin-top:10px">KUR. BUL. YÜKLEN.</div></div></div>`, 1024, 500, BG), 1024, 500, path.join(root, 'store', 'feature-1024x500.png'));
await browser.close();
console.log('simgeler hazır');
