import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!/^\/(index\.html|style\.css|src\/[\w/-]+\.js|vendor\/three\.(module|core)\.js)$/.test(name)) { res.writeHead(404); res.end('Bulunamadı'); return; }
    const data = await readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Bulunamadı'); }
});
server.listen(Number(process.env.PORT) || 5240, process.env.HOST || '127.0.0.1', () => console.log(`Akın Var hazır: http://localhost:${server.address().port}`));
