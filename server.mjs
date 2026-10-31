import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRooms } from './server/odalar.mjs';

/**
 * Tek süreç, tek port: statik dosyalar (oyun) + WebSocket (çevrim içi odalar; server/odalar.mjs).
 * Cloudflare Tunnel bu portu akinvar-sunucu.josephuz.com'a bağlar; oyun dosyaları ileride Cloudflare'deki statik siteden
 * (akinvar.josephuz.com) gelir ve tarayıcı bu adrese bağlanır. Yerelde sayfa da buradan açılır.
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const noStore = 'no-store, no-cache, must-revalidate, max-age=0';
const rooms = createRooms({
  prepTime: Number(process.env.HAZIRLIK_SURE) || undefined,
  log: (...a) => console.log(new Date().toLocaleTimeString('tr-TR'), ...a),
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': noStore, 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ oyun: 'akin-var', ...rooms.stats() })); return;
    }
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!/^\/(index\.html|style\.css|src\/[\w/-]+\.js|img\/(asker|ikon)\/\w+\.png|vendor\/three\.(module|core)\.js)$/.test(name)) { res.writeHead(404); res.end('Bulunamadı'); return; }
    const data = await readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': noStore }); res.end(data);
  } catch { res.writeHead(404); res.end('Bulunamadı'); }
});

/** WebSocket yalnız bilinen sayfalardan: aynı adres, *.josephuz.com, localhost. Origin'siz istemciler (testler) kabul. */
function allowedOrigin(req) {
  const origin = req.headers.origin; if (!origin) return true;
  try { const u = new URL(origin); return u.host === req.headers.host || u.hostname === 'josephuz.com' || u.hostname.endsWith('.josephuz.com') || u.hostname === 'localhost' || u.hostname === '127.0.0.1'; } catch { return false; }
}
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024, verifyClient: ({ req }) => allowedOrigin(req) });
wss.on('connection', (ws) => rooms.attach(ws));
wss.on('error', () => {});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { wss.close(); server.close(); process.exit(0); });

server.listen(Number(process.env.PORT) || 5240, process.env.HOST || '127.0.0.1', () => console.log(`Akın Var hazır: http://localhost:${server.address().port}`));
