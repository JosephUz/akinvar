import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRooms } from '../server/odalar.mjs';
import { createBattle, step, command, snapshot } from '../src/sim.js';
import { CLASS_BY_KEY } from '../src/units.js';

// Sunucu ve iki istemci aynı süreçte. İstemci, tarayıcıdaki gibi savaşı 'tik' mesajlarıyla kendisi koşar.
function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`), inbox = [];
  const c = {
    ws, inbox, w: null,
    send: (m) => ws.send(JSON.stringify(m)),
    async wait(pred, ms = 8000) {
      const until = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex(pred);
        if (i >= 0) return inbox.splice(i, 1)[0];
        if (Date.now() > until) throw new Error('bekleme süresi doldu');
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    ticks: 0, pairs: [],
  };
  ws.on('message', (data, binary) => {
    if (binary) {
      // Anlık gelmeden önce istemcinin kendi durumu sunucununkiyle karşılaştırılır (sapma ölçümü).
      if (c.w) c.pairs.push([snapshot(c.w), new Uint8Array(data)]);
      return;
    }
    const m = JSON.parse(data);
    if (m.t === 'savas') { c.w = createBattle(m.kurulum); c.order = m.order; }
    if (m.t === 'tik' && c.w) {
      for (const q of m.c) command(c.w, q.team, q.l, q.c, q.owner);
      step(c.w); c.ticks++;
    }
    inbox.push(m);
  });
  return new Promise((r) => ws.on('open', () => r(c)));
}

test('çevrim içi: oda kur, kodla katıl, kart al, hazır, savaş istemcide aynı ilerler', async () => {
  const rooms = createRooms({ prepTime: 30 });
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => rooms.attach(ws));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const a = await client(port), b = await client(port);
    a.send({ t: 'kur', ad: 'Ayşe', takim: 1, can: 1000, zorluk: 'kolay' });
    const kat = await a.wait((m) => m.t === 'katildi');
    assert.match(kat.kod, /^[A-Z]{4}-[2-9]$/);
    b.send({ t: 'kod', kod: kat.kod.replace('-', '').toLowerCase(), ad: 'Bora' });
    await b.wait((m) => m.t === 'katildi');
    const oda = await a.wait((m) => m.t === 'oda' && m.koltuk.filter(Boolean).length === 2);
    assert.equal(oda.koltuk.length, 2); assert.equal(oda.zorluk, 'kolay');

    // 2v2 yap: bir Mavi bir Kırmızı koltuk boş kalır, botlar oynar
    a.send({ t: 'ayar', takim: 2 });
    const oda2 = await a.wait((m) => m.t === 'oda' && m.takim === 2);
    assert.equal(oda2.koltuk.length, 4);
    assert.ok(oda2.koltuk[0] && oda2.koltuk[2], 'Ayşe Mavi, Bora Kırmızı kalır');
    b.send({ t: 'basla' }); // kuran değil: yok sayılır
    a.send({ t: 'basla' });
    const macA = await a.wait((m) => m.t === 'mac');
    const macB = await b.wait((m) => m.t === 'mac');
    assert.equal(macA.mac.phase, 'prep');
    const rakipB = macB.mac.players.find((p) => p.team !== macB.mac.players[macB.ben].team && !p.human);
    assert.deepEqual(rakipB.units, [], 'rakibin bu tur aldıkları gizli');

    const spear = CLASS_BY_KEY['sp:ir-sh:ir-fo-no'].index, bow = CLASS_BY_KEY['bo-no-fo-no'].index;
    for (let k = 0; k < 4; k++) a.send({ t: 'al', c: spear });
    for (let k = 0; k < 4; k++) b.send({ t: 'al', c: bow });
    a.send({ t: 'geri', c: spear });
    a.send({ t: 'hazir' }); b.send({ t: 'hazir' });
    const sa = await a.wait((m) => m.t === 'savas');
    await b.wait((m) => m.t === 'savas');
    assert.equal(sa.kurulum.players.find((p) => p.human && p.team === 0).units.length, 3);

    // Ayşe'nin bölükleri merkeze yürüsün (yalnız kendi bölükleri emir alır)
    await a.wait((m) => m.t === 'tik');
    const mine = [...Array(a.w.B).keys()].filter((x) => a.w.bowner[x] === a.order.indexOf(0));
    a.send({ t: 'emir', l: [...Array(a.w.B).keys()], c: { type: 'move', x: 0, z: 0 } });

    // Birkaç saniye: istemcinin savaşı sunucunun anlığıyla aynı olmalı
    await a.wait((m) => m.t === 'tik' && m.n >= 119, 15000);
    await new Promise((r) => setTimeout(r, 150));
    // Anlık geldiği anda istemcinin kendi durumu: aynı motor, aynı adımlar, bayt bayt aynı olmalı
    const tickAnlik = a.pairs.filter(([, srv]) => srv.length > 0);
    assert.ok(tickAnlik.length >= 2, 'savaş başı ve 3. saniye anlıkları gelmeli');
    for (const [own, srv] of tickAnlik) assert.ok(Buffer.from(own).equals(Buffer.from(srv)), 'istemci ve sunucu savaşı aynı');
    assert.ok(mine.every((x) => a.w.bhuman[x] === 1), 'emir alan bölük oyuncunun');
    assert.ok([...Array(a.w.B).keys()].filter((x) => !mine.includes(x)).every((x) => a.w.bhuman[x] === 0), 'başkasının bölüğüne emir verilemez');

    // Bora koparsa yeri bota geçer, oda yaşar
    b.ws.close();
    const odaKop = await a.wait((m) => m.t === 'oda' && m.koltuk.some((k) => k?.koptu));
    assert.ok(odaKop);
    a.ws.close();
  } finally {
    rooms.kapat(); for (const c of wss.clients) c.terminate(); wss.close(); server.close();
  }
});
