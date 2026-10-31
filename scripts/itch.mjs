import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * itch.io HTML5 paketi: dist/ (npm run build:web) → artifacts/akinvar-itch.zip, index.html zip'in kökünde.
 * Oyun itch.io'da *.itch.zone iframe'inde açılır; çevrim içi odalar wss://akinvar-sunucu.josephuz.com'a bağlanır
 * (sunucu itch kökenini kabul eder, server.mjs). Yükleme: itch.io sayfası → Uploads → zip, "This file will be played in the browser".
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
const out = path.join(root, 'artifacts'), zip = path.join(out, 'akinvar-itch.zip');
await mkdir(out, { recursive: true }); await rm(zip, { force: true });
// bsdtar zip yazar (-a uzantıdan biçimi seçer). Windows'ta System32'deki; Git'in GNU tar'ı zip yazamaz.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', path.join(root, 'dist'), 'index.html', 'style.css', 'src', 'vendor', 'img'], { stdio: 'inherit' }); // index.html kökte, './' öneksiz
console.log(`itch.io paketi: ${path.relative(root, zip)} (${((await stat(zip)).size / 1024 / 1024).toFixed(1)} MB)`);
