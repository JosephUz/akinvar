// Dokunmatik duman testi: yatay telefon (844×390, dokunmatik). Sunucu açık olmalı (npm start ya da PORT=… node server.mjs).
//   PLAYWRIGHT=<playwright index.mjs yolu> ADRES=http://localhost:5240 node tests/dokunmatik.mjs
// Akın Var'da Playwright bağımlılık değil; varsayılan olarak Son Plaka'nınki kullanılır. Çoklu parmak CDP ile verilir.
// Denetlenen: touch sınıfı, hazırlıkta dokun = al / basılı tut = geri ver, savaşta dokun = seç, seçiliyken zemine dokun = yürü,
// sürükle = kaydır, iki parmak kıstır = yakınlaştır, Bırak (✕), seçili bölüğe yeniden dokun = bırak, basılı tut + sürükle = kutu
// seçimi, dik ekranda çevir uyarısı.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT || 'file:///c:/ju/sonplaka/node_modules/playwright/index.mjs');
const ADRES = process.env.ADRES || 'http://localhost:5240';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(p);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
const wait = (ms) => p.waitForTimeout(ms);
const A = (f, arg) => p.evaluate(f, arg);

try {
  await p.goto(ADRES + '/?test=1'); await wait(1200);
  await A(() => localStorage.clear());
  assert.ok(await A(() => document.documentElement.classList.contains('touch')), 'touch sınıfı yok');

  // Hazırlık: dokun = al, basılı tut = geri ver
  await p.tap('#play'); await wait(600);
  const card = p.locator('#cards .unit:not(.poor)').first();
  await card.tap(); await wait(150);
  assert.equal(await A(() => __akinCmd.me.units.length), 1, 'dokununca kart alınmadı');
  const box = await card.boundingBox();
  await touch('touchStart', [[box.x + 30, box.y + 40]]); await wait(700); await touch('touchEnd', []); await wait(200);
  assert.equal(await A(() => __akinCmd.me.units.length), 0, 'basılı tutunca geri verilmedi');
  for (let k = 0; k < 3; k++) await p.locator('#cards .unit:not(.poor)').nth(k).tap();
  assert.equal(await A(() => __akinCmd.me.units.length), 3);

  // Savaş
  await A(() => __akinCmd.beginBattle()); await wait(800);
  await A(() => { __akinCmd.view.zoom = 20; __akinCmd.view.resize(); });
  await wait(300);
  const tagOf = () => A(() => {
    const { w, view } = __akinCmd; const me = __akinCmd.me;
    for (let b = 0; b < w.B; b++) if (w.bteam[b] === me.team) {
      let x = 0, z = 0, n = 0;
      for (let i = b * 20; i < b * 20 + 20; i++) if (w.hp[i] > 0) { x += w.x[i]; z += w.z[i]; n++; }
      const s = view.toScreen(x / n, z / n); return { b, x: s.x, y: s.y };
    }
  });
  const t0 = await tagOf();
  await touch('touchStart', [[t0.x, t0.y]]); await wait(60); await touch('touchEnd', []); await wait(100);
  assert.deepEqual(await A(() => [...__akinCmd.sel]), [t0.b], 'dokununca bölük seçilmedi');

  // Seçiliyken zemine dokun = yürü
  const gx = t0.x + 120, gy = t0.y - 40;
  await touch('touchStart', [[gx, gy]]); await wait(60); await touch('touchEnd', []); await wait(100);
  assert.equal(await A((b) => __akinCmd.w.border[b], t0.b), 1, 'zemine dokununca yürü emri verilmedi');

  // Sürükle = kaydır
  const before = await A(() => [__akinCmd.view.target.x, __akinCmd.view.target.z]);
  await touch('touchStart', [[400, 200]]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [[400 - k * 20, 200]]); await wait(20); }
  await touch('touchEnd', []); await wait(100);
  const after = await A(() => [__akinCmd.view.target.x, __akinCmd.view.target.z]);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 3, 'sürükleyince kamera kaymadı');
  assert.equal(await A(() => __akinCmd.sel.length), 1, 'kaydırma seçimi bozdu');

  // İki parmak kıstır = uzaklaş/yaklaş
  const z0 = await A(() => __akinCmd.view.zoom);
  await touch('touchStart', [[380, 200], [460, 200]]);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', [[380 - k * 15, 200], [460 + k * 15, 200]]); await wait(20); }
  await touch('touchEnd', []); await wait(100);
  assert.ok(await A(() => __akinCmd.view.zoom) < z0 * 0.8, 'iki parmakla açınca yaklaşmadı');

  // Bırak, sonra basılı tut + sürükle = kutu seçimi (bütün ordu)
  await p.tap('#t-birak'); await wait(100);
  assert.equal(await A(() => __akinCmd.sel.length), 0, 'Bırak seçimi temizlemedi');
  assert.ok(await A(() => document.getElementById('orders').classList.contains('secimsiz')), 'seçim yokken seçim şeridi gizlenmedi');

  // Seçili tek bölüğe yeniden dokun = bırak (çift dokunuş sayılmasın diye arada bekle)
  await A(() => { const { w, view, me } = __akinCmd; const b = [...Array(w.B).keys()].find((k) => w.bteam[k] === me.team && w.balive[k]); view.target.set(w.cx[b], 0, w.cz[b]); view.zoom = 20; view.resize(); });
  await wait(200);
  const t1 = await tagOf();
  await touch('touchStart', [[t1.x, t1.y]]); await wait(60); await touch('touchEnd', []); await wait(500);
  assert.equal(await A(() => __akinCmd.sel.length), 1, 'dokununca bölük seçilmedi (2)');
  await touch('touchStart', [[t1.x, t1.y]]); await wait(60); await touch('touchEnd', []); await wait(100);
  assert.equal(await A(() => __akinCmd.sel.length), 0, 'seçili bölüğe yeniden dokununca seçim kalkmadı');
  await A(() => { __akinCmd.view.zoom = 45; __akinCmd.view.resize(); }); await wait(200);
  await touch('touchStart', [[6, 6]]); await wait(600);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', [[6 + k * 138, 6 + k * 62]]); await wait(20); }
  await touch('touchEnd', []); await wait(150);
  assert.equal(await A(() => __akinCmd.sel.length), 3, 'kutu seçimi bütün bölükleri almadı');

  // Dik ekran: çevir uyarısı
  await A(() => document.fullscreenElement && document.exitFullscreen()); await wait(300);
  await p.setViewportSize({ width: 390, height: 844 }); await wait(200);
  assert.ok(await p.isVisible('#cevir'), 'dik ekranda çevir uyarısı yok');

  assert.deepEqual(errors, []);
  console.log('dokunmatik: tamam');
} finally {
  await browser.close();
}
