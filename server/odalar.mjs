import { randomBytes } from 'node:crypto';
import { kodUret, kodDuzelt } from '../src/kod.js';
import { TICK, PREP_TIME, FLAG_HP, TEAM_SIZES, DIFFICULTY } from '../src/config.js';
import { CLASS_COUNT } from '../src/units.js';
import { step, command, snapshot } from '../src/sim.js';
import {
  createMatch, startBattle, startFlags, endRound, buyUnit, refundUnit, buyEco, refundEco, buyTalim, refundTalim,
  setReady, allReady, setHuman, matchView,
} from '../src/match.js';

/**
 * Çevrim içi odalar (josephuz oda standardı, josephuz/docs/oda-standardi.md): açık oda listesi, hızlı katıl, oda kur,
 * kodla katıl, bekleme odası ve maç.
 *
 * Oda 2 × takım koltukludur: ilk yarısı Mavi, ikinci yarısı Kırmızı; boş koltukları botlar oynar. Kuran takım boyunu,
 * bayrak canını ve herkese açık / özel ayarını değiştirir, oyuncuları taşır ve MAÇI BAŞLAT der.
 *
 * Maçı sunucu yürütür (match.js + sim.js, 20 Hz). İstemciler savaşı kendileri de koşar: sunucu her adımı o adımda
 * uygulanan emirlerle yollar ('tik'), istemci aynı emirleri uygulayıp aynı adımı atar. Birkaç saniyede bir ve her evre
 * geçişinde tam durum (ikili anlık) gider; farklı tarayıcı motorlarında kayan sayılar ayrışsa bile düzelir.
 *
 * Maç sürerken gelen oyuncu bir botun koltuğuna oturur (maçta o oyuncunun parası, ekonomisi ve bayrağı onundur).
 * Bağlantısı kopanın yerini kişiliğiyle bot oynar; jetonla dönerse koltuğunu geri alır.
 */
const SNAP_EVERY = 60; // adım (3 sn)

export function createRooms({ log = () => {}, kopmaSure = 60000, prepTime = PREP_TIME } = {}) {
  const odalar = new Map(), baglar = new Set();
  let uyeNo = 1;
  const yolla = (b, m) => b?.yolla(JSON.stringify(m));
  const uyeler = (r) => r.koltuk.filter(Boolean);
  const sonrakiKuran = (r) => uyeler(r).find((u) => u.b) ?? uyeler(r)[0] ?? null;
  const adDuzelt = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  const ozetYazi = (r) => ({ takim: r.takim, can: r.can, zorluk: r.zorluk });

  // ——— Açık oda listesi: odada olmayan bağlantılara değişince (250 ms toplayarak) gider ———
  function liste() {
    return [...odalar.values()].filter((r) => !r.ozel)
      .sort((a, c) => (a.durum === 'lobi' ? 0 : 1) - (c.durum === 'lobi' ? 0 : 1) || uyeler(c).length - uyeler(a).length)
      .slice(0, 20)
      .map((r) => ({ kod: r.kod, kuran: r.kuran?.ad ?? '', ...ozetYazi(r), n: uyeler(r).length, max: r.koltuk.length, durum: r.durum }));
  }
  const ozet = () => ({ t: 'lobi', cevrimici: baglar.size, odalar: liste() });
  let yayT = null;
  function lobiyeYay() {
    if (yayT) return;
    yayT = setTimeout(() => { yayT = null; const m = JSON.stringify(ozet()); for (const b of baglar) if (!b.uye) b.yolla(m); }, 250);
  }

  // ——— Oda ———
  const takimDuzelt = (n) => (TEAM_SIZES.includes(n | 0) ? n | 0 : 1);
  const canDuzelt = (n) => (FLAG_HP.includes(n | 0) ? n | 0 : FLAG_HP[0]);
  function odaKur(m) {
    const takim = takimDuzelt(m.takim);
    const r = { kod: kodUret((k) => odalar.has(k)), takim, can: canDuzelt(m.can), zorluk: DIFFICULTY[m.zorluk] ? m.zorluk : 'orta', ozel: false, durum: 'lobi', koltuk: Array(takim * 2).fill(null), kuran: null, mac: null };
    odalar.set(r.kod, r); log('oda açıldı', r.kod);
    return r;
  }
  const canli = (r) => odalar.get(r.kod) === r;
  function odaKapat(r) {
    for (const u of uyeler(r)) clearTimeout(u.kopT);
    r.mac = null; odalar.delete(r.kod); log('oda kapandı', r.kod);
  }
  function durumYolla(r) {
    const koltuk = r.koltuk.map((u) => u && { u: u.u, ad: u.ad, koptu: !u.b });
    for (const u of uyeler(r)) if (u.b) yolla(u.b, { t: 'oda', kod: r.kod, ozel: r.ozel, ...ozetYazi(r), durum: r.durum, kuran: r.kuran?.u ?? 0, ben: u.u, koltuk });
  }
  /** Takım boyu değişince insanlar kendi takımlarının ilk koltuklarına toplanır; sığmayan öbür takıma geçer. */
  function koltukDiz(r, takim) {
    const eski = r.koltuk, n = eski.length / 2, yeni = Array(takim * 2).fill(null);
    const mavi = eski.slice(0, n).filter(Boolean), kirmizi = eski.slice(n).filter(Boolean);
    if (mavi.length + kirmizi.length > takim * 2) return false;
    while (mavi.length > takim) kirmizi.push(mavi.pop());
    while (kirmizi.length > takim) mavi.push(kirmizi.pop());
    mavi.forEach((u, i) => { yeni[i] = u; }); kirmizi.forEach((u, i) => { yeni[takim + i] = u; });
    r.koltuk = yeni; r.takim = takim; return true;
  }

  function gir(b, r, m) {
    const i = r.koltuk.indexOf(null);
    if (i < 0) { yolla(b, { t: 'hata', kod: 'oda.dolu', m: 'Oda dolu' }); return; }
    ayril(b);
    const u = { u: uyeNo++, jeton: randomBytes(12).toString('hex'), ad: adDuzelt(m.ad) || 'Komutan', b, kopT: null };
    r.koltuk[i] = u; b.uye = u; b.r = r;
    if (!r.kuran?.b) r.kuran = u;
    log('katıldı', r.kod, u.ad);
    yolla(b, { t: 'katildi', kod: r.kod, jeton: u.jeton });
    durumYolla(r);
    if (r.mac) macaSok(r, u, i);
    lobiyeYay();
  }
  function don(b, m) {
    const r = odalar.get(kodDuzelt(m.kod));
    if (!r) { yolla(b, { t: 'hata', kod: 'oda.yok', m: 'Böyle bir oda yok' }); return; }
    const u = typeof m.jeton === 'string' && uyeler(r).find((x) => x.jeton === m.jeton);
    if (!u) { gir(b, r, m); return; }
    ayril(b);
    if (u.b && u.b !== b) { u.b.uye = null; u.b.r = null; }
    clearTimeout(u.kopT); u.kopT = null; u.b = b; b.uye = u; b.r = r;
    if (!r.kuran?.b) r.kuran = u;
    log('geri döndü', r.kod, u.ad);
    yolla(b, { t: 'katildi', kod: r.kod, jeton: u.jeton, don: true });
    durumYolla(r);
    if (r.mac) macaSok(r, u, r.koltuk.indexOf(u));
    lobiyeYay();
  }
  function uyeCikar(r, u) {
    clearTimeout(u.kopT); u.kopT = null;
    if (!canli(r)) return;
    const i = r.koltuk.indexOf(u);
    if (i >= 0) { r.koltuk[i] = null; if (r.mac) macBirak(r, i); }
    if (r.kuran === u) r.kuran = sonrakiKuran(r);
    if (!uyeler(r).length) odaKapat(r); else durumYolla(r);
    lobiyeYay();
  }
  function ayril(b) {
    const u = b.uye, r = b.r; if (!u) return;
    b.uye = null; b.r = null;
    if (u.b === b) { u.b = null; uyeCikar(r, u); }
  }
  function koptu(b) {
    const u = b.uye, r = b.r; if (!u) return;
    b.uye = null; b.r = null;
    if (u.b !== b || !canli(r)) return;
    u.b = null;
    if (r.mac) macBirak(r, r.koltuk.indexOf(u));
    if (r.kuran === u) r.kuran = sonrakiKuran(r);
    u.kopT = setTimeout(() => uyeCikar(r, u), kopmaSure);
    durumYolla(r); lobiyeYay();
  }

  // ——— Maç ———
  function baslat(r) {
    r.durum = 'mac';
    const m = createMatch({ teamSize: r.takim, flagHp: r.can, difficulty: r.zorluk, seats: r.koltuk.map((u) => (u ? { name: u.ad } : null)) });
    r.mac = { m, prepLeft: prepTime, queue: [], acc: 0, son: performance.now() };
    for (const [i, u] of r.koltuk.entries()) if (u && !u.b) setHuman(m, m.players[i], false); // kopuk koltuk: bot
    log('maç başladı', r.kod, uyeler(r).length + ' insan');
    durumYolla(r); lobiyeYay(); macYay(r);
  }
  /** Her üyeye kendi takımının gözünden maç. */
  function macYay(r, ek = {}) {
    const { m } = r.mac;
    for (const [i, u] of r.koltuk.entries()) if (u?.b) yolla(u.b, { t: 'mac', ben: i, prepLeft: r.mac.prepLeft, mac: matchView(m, m.players[i].team), ...ek });
  }
  function savasYolla(r, b) {
    const { m } = r.mac, w = m.battle;
    yolla(b, { t: 'savas', kurulum: m.battleSetup, order: m.order });
    b.ikili(snapshot(w));
  }
  function herkese(r, msg) { const s = JSON.stringify(msg); for (const u of uyeler(r)) u.b?.yolla(s); }
  function herkeseAnlik(r) { const a = snapshot(r.mac.m.battle); for (const u of uyeler(r)) u.b?.ikili(a); }

  /** Maç sürerken koltuğa insan geldi ya da döndü. */
  function macaSok(r, u, i) {
    const { m } = r.mac, p = m.players[i];
    setHuman(m, p, true, u.ad);
    yolla(u.b, { t: 'mac', ben: i, prepLeft: r.mac.prepLeft, mac: matchView(m, p.team) });
    if (m.phase === 'battle' || m.phase === 'flag') {
      const k = m.order.indexOf(i);
      if (k >= 0) r.mac.queue.push({ team: p.team, owner: k, l: allOf(m, k), c: { type: 'human' } });
      savasYolla(r, u.b);
    }
    macYay(r);
  }
  /** Koltuktaki insan çıktı ya da koptu: kişiliğiyle bot oynar. */
  function macBirak(r, i) {
    const { m } = r.mac, p = m.players[i];
    if (!p) return;
    setHuman(m, p, false);
    const k = m.order?.indexOf(i) ?? -1;
    if (k >= 0 && (m.phase === 'battle' || m.phase === 'flag')) r.mac.queue.push({ team: p.team, owner: k, l: allOf(m, k), c: { type: 'bot' } });
    if (m.phase === 'prep' && allReady(m)) savasBaslat(r);
    else macYay(r);
  }
  const allOf = (m, k) => { const w = m.battle, l = []; for (let b = 0; b < w.B; b++) if (w.bowner[b] === k) l.push(b); return l; };

  function savasBaslat(r) {
    const { m } = r.mac;
    for (const p of m.players) if (!p.ready) setReady(m, p);
    startBattle(m);
    r.mac.queue.length = 0; r.mac.acc = 0;
    macYay(r);
    for (const u of uyeler(r)) if (u.b) savasYolla(r, u.b);
    if (m.battle.winner >= 0) bayrak(r);
  }
  function bayrak(r) {
    const { m } = r.mac;
    startFlags(m);
    herkese(r, { t: 'bayrak' });
    herkeseAnlik(r);
    if (m.battle.phase !== 'flag') turBitti(r);
  }
  function turBitti(r) {
    const { m } = r.mac;
    endRound(m);
    r.mac.prepLeft = prepTime;
    macYay(r, { tur: m.log.at(-1) });
    if (m.phase === 'over') {
      log('maç bitti', r.kod);
      r.mac = null; r.durum = 'lobi';
      durumYolla(r); lobiyeYay();
    }
  }

  function macMesaji(r, u, msg) {
    const i = r.koltuk.indexOf(u), { m } = r.mac, p = m.players[i];
    if (!p || p.out) return;
    const c = msg.c | 0, f = msg.f | 0;
    switch (msg.t) {
      case 'al': if (c >= 0 && c < CLASS_COUNT) buyUnit(m, p, c); break;
      case 'geri': refundUnit(m, p, c); break;
      case 'eko': buyEco(m, p); break;
      case 'ekoGeri': refundEco(m, p); break;
      case 'talim': buyTalim(m, p, f); break;
      case 'talimGeri': refundTalim(m, p, f); break;
      case 'hazir': if (m.phase === 'prep') { setReady(m, p); if (allReady(m)) { savasBaslat(r); return; } } break;
      case 'emir': {
        const k = m.order?.indexOf(i) ?? -1;
        if (k < 0 || !Array.isArray(msg.l) || !msg.c || typeof msg.c !== 'object') return;
        const type = msg.c.type, cmd = { type };
        if (type === 'move') { cmd.x = +msg.c.x || 0; cmd.z = +msg.c.z || 0; }
        else if (type === 'attack') cmd.target = msg.c.target | 0;
        else if (type === 'flag') cmd.flag = msg.c.flag | 0;
        else if (type !== 'stop') return;
        r.mac.queue.push({ team: p.team, owner: k, l: msg.l.slice(0, 600).map((x) => x | 0), c: cmd });
        return;
      }
      default: return;
    }
    if (m.phase === 'prep') macYay(r);
  }

  // Maç saati: hazırlık geri sayımı ve 20 Hz savaş.
  function macAdim(r, dt) {
    const mc = r.mac, { m } = mc;
    if (m.phase === 'prep') {
      mc.prepLeft -= dt;
      if (mc.prepLeft <= 0) savasBaslat(r);
      return;
    }
    if (m.phase !== 'battle' && m.phase !== 'flag') return;
    const w = m.battle;
    mc.acc = Math.min(mc.acc + dt, TICK * 4);
    while (mc.acc >= TICK && r.mac === mc && (m.phase === 'battle' || m.phase === 'flag')) {
      mc.acc -= TICK;
      const cmds = mc.queue.splice(0);
      for (const q of cmds) command(w, q.team, q.l, q.c, q.owner);
      herkese(r, { t: 'tik', n: w.tick, c: cmds });
      step(w);
      if (w.tick % SNAP_EVERY === 0) herkeseAnlik(r);
      if (m.phase === 'battle' && w.winner >= 0) { bayrak(r); continue; }
      if (m.phase === 'flag' && w.phase === 'done') { turBitti(r); return; }
    }
  }

  let simdi = performance.now();
  const tik = setInterval(() => {
    const t = performance.now(), dt = Math.min(0.25, (t - simdi) / 1000); simdi = t;
    for (const r of odalar.values()) if (r.mac) macAdim(r, dt);
  }, 1000 * TICK);

  function odaMesaji(b, m) {
    const u = b.uye, r = b.r, kuran = r.kuran === u, lobide = r.durum === 'lobi';
    switch (m.t) {
      case 'cik': ayril(b); return;
      case 'otur': {
        const i = m.i | 0;
        if (lobide && i >= 0 && i < r.koltuk.length && !r.koltuk[i]) { r.koltuk[r.koltuk.indexOf(u)] = null; r.koltuk[i] = u; durumYolla(r); }
        return;
      }
      case 'tasi': {
        const v = uyeler(r).find((x) => x.u === m.u), i = m.i | 0;
        if (kuran && lobide && v && i >= 0 && i < r.koltuk.length) { const j = r.koltuk.indexOf(v); r.koltuk[j] = r.koltuk[i]; r.koltuk[i] = v; durumYolla(r); }
        return;
      }
      case 'ayar':
        if (!kuran || !lobide) return;
        if (m.takim !== undefined && TEAM_SIZES.includes(m.takim | 0)) koltukDiz(r, m.takim | 0);
        if (m.can !== undefined && FLAG_HP.includes(m.can | 0)) r.can = m.can | 0;
        if (DIFFICULTY[m.zorluk]) r.zorluk = m.zorluk;
        if (typeof m.ozel === 'boolean') r.ozel = m.ozel;
        durumYolla(r); lobiyeYay();
        return;
      case 'basla': if (kuran && lobide) baslat(r); return;
      default: if (r.mac) macMesaji(r, u, m);
    }
  }

  return {
    kapat() { clearInterval(tik); clearTimeout(yayT); for (const r of [...odalar.values()]) odaKapat(r); },
    stats: () => ({ cevrimici: baglar.size, odalar: odalar.size, oyunda: [...odalar.values()].reduce((a, r) => a + uyeler(r).filter((u) => u.b).length, 0) }),
    attach(ws) {
      const b = {
        uye: null, r: null,
        yolla(veri) { if (ws.readyState === 1 && ws.bufferedAmount < 2 * 1024 * 1024) ws.send(veri); },
        ikili(veri) { if (ws.readyState === 1) ws.send(veri, { binary: true }); },
      };
      baglar.add(b); lobiyeYay();
      let sayac = 0, pencere = Date.now();
      ws.on('message', (veri, ikili) => {
        if (ikili) return;
        // Taşkın koruması: saniyede 60 mesajdan fazlası düşer (kart tıklamaları ve emirler için bol).
        const t = Date.now(); if (t - pencere > 1000) { pencere = t; sayac = 0; } if (++sayac > 60) return;
        let m; try { m = JSON.parse(veri); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (b.uye) { odaMesaji(b, m); return; }
        if (m.t === 'lobi') yolla(b, ozet());
        else if (m.t === 'kur') gir(b, odaKur(m), m);
        else if (m.t === 'kod') { const r = odalar.get(kodDuzelt(m.kod)); if (r) gir(b, r, m); else yolla(b, { t: 'hata', kod: 'oda.yok', m: 'Böyle bir oda yok' }); }
        else if (m.t === 'don') don(b, m);
        else if (m.t === 'hizli') {
          const uygun = [...odalar.values()].filter((r) => !r.ozel && r.koltuk.includes(null))
            .sort((a, c) => (a.durum === 'lobi' ? 0 : 1) - (c.durum === 'lobi' ? 0 : 1) || uyeler(c).length - uyeler(a).length)[0];
          gir(b, uygun ?? odaKur(m), m);
        }
      });
      ws.on('close', () => { koptu(b); baglar.delete(b); lobiyeYay(); });
      ws.on('error', () => {});
    },
  };
}
