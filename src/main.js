// Akın Var — tur tabanlı takım savaşı. Hazırlıkta kartlarla bölük al, savaşta yönet, bayrak evresinde rakip bayraklara yüklen.
// Tek başına: maç (match.js) ve savaş (sim.js) tarayıcıda. Çevrim içi: maçı sunucu yürütür; istemci savaşı sunucunun
// adımları ve emirleriyle aynen koşar, anlıklarla düzeltir (server/odalar.mjs).
import { TICK, ZONE, TEAMS, PREP_TIME, FLAG_TIME, FLAG_HP, TEAM_SIZES, TALIM, ECONOMY, DIFFICULTY, CHARGE } from './config.js';
import { step, command, visibleTo, createBattle, applySnapshot, PER_BOLUK } from './sim.js';
import { CLASSES, FAMILIES, HIT, CLASS_COUNT } from './units.js';
import {
  createMatch, startBattle, startFlags, endRound, buyUnit, refundUnit, buyEco, refundEco, buyTalim, refundTalim,
  setReady, ecoCost, talimCost, talimPaid, income, incomeAt, battleLosses, saveMatch, loadMatch,
} from './match.js';
import { View } from './view.js';
import { sunucuBaglanti } from './ag.js';
import { kodDuzelt, kodYeterli } from './kod.js';
import { t, DIL, sayi, dilUygula, dilDugmesi } from './dil.js';
import { touchDevice, enterFullscreen, onBackButton, isApp } from './platform.js';
import { gorunurAlanaKilitle } from './gorunur-alan.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const fmt = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const num = (n) => sayi(Math.round(n));
const dec = (n) => sayi(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IMG = (c) => `img/asker/${c.img}.png`, ICON = (k) => `img/ikon/${k}.png`;
// Görünen adlar dile göre: sınıf (silah, kalkan, zırh), aile, takım, bot kişiliği. Ortak dosyalarda (sunucu da kullanır) yalnız anahtar durur.
const sinifAdi = (c) => (c.mounted ? t('sinif.atli') + ' · ' : '') + t('silah.' + c.wkey);
const sinifDetay = (c) => [c.skey && t('kalkan.' + c.skey), c.akey && t('zirh.' + c.akey)].filter(Boolean).join(' · ') || t('sinif.zirhsiz');
const aileAdi = (f) => t('aile.' + FAMILIES[f].key);
const takimAdi = (k) => t('takim.' + k);
const oyuncuAdi = (p) => (p.human ? p.name || t('oyuncu.sen') : t('kisilik.' + p.personality));

// throneofcurse asker görsellerinin çevresi saydam boşluk: her görselin dolu alanı bir kez ölçülür, kart yalnız o kutuyu
// gösterir (object-view-box). Sabit büyütme bazılarını (uzun mızrak, baş) kesiyordu. Desteklemeyen tarayıcı tüm görseli gösterir.
const viewBox = new Map();
function measure(src) {
  const img = new Image();
  img.onload = () => {
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    // Dolu piksellerin satır ve sütun dağılımı; uçlardaki %0,3'lük tek tük lekeler kutuya girmez.
    const cols = new Float32Array(S), rows = new Float32Array(S); let total = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 60) { cols[x]++; rows[y]++; total++; }
    if (!total) return;
    const edge = (h, from) => { let acc = 0; for (let k = 0; k < S; k++) { const i = from ? k : S - 1 - k; acc += h[i]; if (acc > total * 0.003) return i; } return from ? 0 : S - 1; };
    const x0 = edge(cols, true), x1 = edge(cols, false), y0 = edge(rows, true), y1 = edge(rows, false);
    const pad = 2, pc = (v) => `${Math.max(0, (v / S) * 100).toFixed(1)}%`;
    viewBox.set(src, `inset(${pc(y0 - pad)} ${pc(S - 1 - x1 - pad)} ${pc(S - 1 - y1 - pad)} ${pc(x0 - pad)})`);
    for (const el of document.querySelectorAll(`img.soldier[src="${src}"]`)) el.style.objectViewBox = viewBox.get(src);
  };
  img.src = src;
}
for (const src of new Set(CLASSES.map(IMG))) measure(src);

// Dokunmatikte (telefon) hafif görüntü: kenar yumuşatma ve gölge kapalı başlar (gölge F3 panelinden açılır).
const touch = touchDevice();
document.documentElement.classList.toggle('touch', touch);
// Android uygulamasında siteye giden bağlantılar gizli: WebView oyundan çıkıp siteye giderdi.
document.documentElement.classList.toggle('app', isApp());
gorunurAlanaKilitle();
const view = new View($('scene'), { light: touch });
view.setShadows(params.has('golge') ? params.get('golge') !== '0' : !touch);
let m = null, w = null, me = null, myIdx = -1, acc = 0, last = performance.now(), speed = 1, paused = false;
let state = 'menu', selected = new Set(), prepLeft = 0, online = false;
const secim = {
  takim: load('akinvar.takim', 1), can: load('akinvar.bayrak', 100), zorluk: loadS('akinvar.zorluk', 'orta'),
  ad: loadS('akinvar.ad', ''),
};
const stats = { fps: 0, simMs: 0, drawMs: 0, frames: 0, simSum: 0, drawSum: 0, since: performance.now() };
window.__akin = stats;

function load(k, d) { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } }
function loadS(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* gizli pencere */ } }
const adim = () => secim.ad.trim() || `${t('ana.varsayilanAd')}-${String(1000 + ((Math.random() * 9000) | 0))}`;

// ---------- akış ----------

// Ana ekranın arkasında iki bot ordusu kendi kendine dövüşür.
function menuBattle() {
  const units = (team) => Array.from({ length: 22 }, (_, k) => CLASSES[(k * 7 + team * 11) % CLASSES.length].index);
  w = createBattle({ seed: 3, players: [0, 1].map((team) => ({ team, human: false, units: units(team) })) });
  view.build(w, { team: 0, colors: [TEAMS[0].color, TEAMS[1].color] });
  view.fogOn = false; view.zoom = w.radius * 0.9; view.resize();
}

function enterGame() {
  if (touch) enterFullscreen();
  paused = false; speed = 1; syncButtons();
  document.body.classList.add('playing');
  $('home').hidden = true; $('bekleme').hidden = true; $('hud').hidden = false;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

function startSolo() {
  online = false;
  m = createMatch({ teamSize: secim.takim, flagHp: secim.can, difficulty: secim.zorluk });
  me = m.players[0]; me.name = secim.ad.trim();
  enterGame(); enterPrep(PREP_TIME);
}

// ---------- tek başına kayıt ----------
// Tek başına maç bu tarayıcıda kendiliğinden kaydedilir: hazırlığa girince, bayrak evresinde, birkaç saniyede bir,
// sekme kapanırken ve ana menüye dönerken. Ana ekrandaki Devam et kaldığı yerden açar; maç bitince kayıt silinir.
const KAYIT = 'akinvar.kayit', KAYIT_ARALIK = 3;
let kayitT = 0;
function kaydet() {
  if (online || !m || m.phase === 'over' || state === 'over' || state === 'menu') return;
  try { localStorage.setItem(KAYIT, JSON.stringify({ ...saveMatch(m), prepLeft: Math.max(0, prepLeft), at: Date.now() })); } catch { /* gizli pencere ya da yer yok */ }
}
function kayitOku() { try { return JSON.parse(localStorage.getItem(KAYIT)); } catch { return null; } }
function kayitSil() { try { localStorage.removeItem(KAYIT); } catch { /* yok */ } devamYaz(); }
function devamYaz() {
  const s = kayitOku(), b = $('devam');
  b.hidden = !(s?.m?.round > 0);
  if (!b.hidden) b.querySelector('[data-k]').textContent = t('ana.devam', { n: s.m.round });
}

function devamEt() {
  const s = kayitOku();
  const loaded = s && loadMatch(s);
  if (!loaded) { kayitSil(); toast(t('ana.kayitBozuk'), 2600); return; }
  online = false; m = loaded;
  me = m.players.find((p) => p.human) ?? m.players[0];
  enterGame();
  if (m.phase === 'prep') { enterPrep(Math.min(PREP_TIME, Math.max(10, s.prepLeft ?? PREP_TIME))); return; }
  w = m.battle; setupBattle();
  if (w.phase === 'flag') showFlags();
  else if (w.phase === 'done') roundOver();
}

function toHome() {
  kaydet();
  state = 'menu'; m = null; online = false; netQueue.length = 0; document.body.classList.remove('playing');
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('home').hidden = false; $('hud').hidden = true; $('orders').hidden = true; $('prep').hidden = true; $('flag-banner').hidden = true;
  $('flag-labels').innerHTML = ''; $('bekleme').hidden = true;
  menuBattle(); lobiYaz(); lobiYenile(); devamYaz();
}

function enterPrep(left) {
  state = 'prep'; prepLeft = left; $('flag-labels').innerHTML = ''; $('flag-banner').hidden = true; $('orders').hidden = true;
  if (me.out) { $('prep').hidden = true; if (!online) beginBattle(); return; } // elenen izler: hazırlık yok
  $('prep').hidden = false; renderPrep(); hud(); kaydet();
}

/** Tek başına: savaşı tarayıcı kurar. Çevrim içi: sunucunun 'savas' mesajıyla aynı kurulum (setupBattle). */
function beginBattle() {
  if (online) { if (!me.ready) { me.ready = true; net({ t: 'hazir' }); renderPrep(); } return; }
  setReady(m, me);
  w = startBattle(m);
  setupBattle();
}

function setupBattle() {
  myIdx = m.order.indexOf(me.id);
  view.build(w, { team: me.team, colors: m.order.map((id) => m.players[id].color), selected: TEAMS[me.team].selected });
  view.fogOn = !me.out;
  $('prep').hidden = true; $('orders').hidden = me.out; state = 'battle'; acc = 0;
  buildTags(); selected = new Set(); syncSelection(); focusArmy();
  if (!online && w.winner >= 0 && w.phase === 'battle') toFlags(); // bir taraf hiç asker almadıysa savaş olmaz
  hud();
}

function toFlags() {
  if (!online) startFlags(m);
  if (w.phase !== 'flag') { if (!online) roundOver(); return; }
  showFlags();
  kaydet();
}

/** Bayrak evresinin ekranı (kayıttan açılınca da). */
function showFlags() {
  // Kazanan oyuncunun sağ kalan bütün bölükleri seçili gelir: tek tıkla hepsi bayrağa sürülür.
  const winnerMe = w.winner === me.team && !me.out;
  state = 'flag'; selected = new Set(winnerMe ? [...Array(w.B).keys()].filter((b) => mine(b) && w.balive[b]) : []); syncSelection();
  view.buildFlags(w.flags, w.flags.map((f) => m.players[f.player].color));
  // Kamera tepeye çıkar: bayraklar ve sağ kalanlar tek bakışta.
  const xs = w.flags.map((f) => f.x), zs = w.flags.map((f) => f.z);
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { xs.push(w.x[i]); zs.push(w.z[i]); }
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  view.target.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
  view.zoom = Math.max(18, Math.min(60, span * 0.6 + 8)); view.resize();
  $('flag-labels').innerHTML = w.flags.map((f, k) => `<div class="flag-label" data-flag="${k}"><b>${esc(oyuncuAdi(m.players[f.player]))}</b><span></span></div>`).join('');
  $('flag-banner').hidden = false;
  $('flag-title').textContent = t(w.winner === me.team ? 'bayrak.kazandin' : 'bayrak.kaybettin');
  $('flag-hint').textContent = t(winnerMe ? (touch ? 'bayrak.ipucuDokun' : 'bayrak.ipucu') : 'bayrak.izle');
  $('orders').hidden = !winnerMe;
}

/** Tur bitti. Tek başına: maçı burada ilerletir. Çevrim içi: sunucunun yeni maç görünümü gelmiştir (before = eski canlar). */
function roundOver(before = new Map(m.players.map((p) => [p.id, m.hpBefore?.[p.id] ?? p.hp])), result = null) {
  state = 'roundEnd'; $('flag-banner').hidden = true; $('orders').hidden = true;
  if (!online) { endRound(m); prepLeft = PREP_TIME; if (m.phase === 'over') kayitSil(); else kaydet(); }
  const lost = m.players.filter((p) => before.get(p.id) !== p.hp).map((p) => `${oyuncuAdi(p)} −${num(before.get(p.id) - p.hp)}${p.out ? ' ' + t('tur.elendi') : ''}`);
  const wn = (result ?? m.log.at(-1))?.winner;
  toast(wn === 2 || wn === undefined ? t('tur.berabere') : t('tur.kazandi', { takim: takimAdi(wn) }) + (lost.length ? ' ' + lost.join(' · ') : ''), 3200);
  if (m.phase === 'over') { setTimeout(finish, 1600); return; }
  if (me.out && !me.toldOut) { me.toldOut = true; setTimeout(showOut, 1600); return; }
  if (!online) setTimeout(() => { if (state === 'roundEnd') enterPrep(PREP_TIME); }, 2600);
}

function finish() {
  state = 'over'; if (!online) kayitSil();
  const won = m.winner === me.team;
  $('end-eyebrow').textContent = t(won ? 'son.zaferGoz' : 'son.yenilgiGoz', { n: m.round });
  $('end-title').textContent = t(won ? 'son.zafer' : 'son.yenilgi');
  $('end-copy').textContent = m.players.map((p) => `${oyuncuAdi(p)} (${takimAdi(p.team)}): ${t('son.ozet', { can: num(p.hp), eko: p.eco })}`).join(' · ');
  $('end-watch').hidden = true;
  $('again').textContent = t(online ? 'son.lobiyeDon' : 'son.yeniMac') + ' →';
  $('end-home').textContent = t(online ? 'menu.odadanCik' : 'menu.anaMenu');
  $('end-dialog').showModal();
}

function showOut() {
  $('end-eyebrow').textContent = t('son.elendiGoz');
  $('end-title').textContent = t('son.elendin');
  $('end-copy').textContent = t('son.elendiMetin');
  $('end-watch').hidden = false;
  $('again').textContent = t(online ? 'son.lobiyeDon' : 'son.yeniMac') + ' →';
  $('end-home').textContent = t(online ? 'menu.odadanCik' : 'menu.anaMenu');
  $('end-dialog').showModal();
}

function focusArmy() {
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0 && (me.out ? w.team[i] === me.team : w.bowner[w.boluk[i]] === myIdx)) { x += w.x[i]; z += w.z[i]; n++; }
  if (n) view.target.set(x / n, 0, z / n);
  view.zoom = Math.min(40, w.radius * 0.45); view.resize();
}

// ---------- hazırlık ekranı ----------

// Kartta her sınıfın kime üstün, kime zayıf olduğu (isabet farkı)
const EDGE = CLASSES.map((a) => CLASSES.map((d) => ({ d, s: HIT[a.index * CLASS_COUNT + d.index] - HIT[d.index * CLASS_COUNT + a.index] })).sort((x, y) => y.s - x.s));
const MAT = [['wood', 'WOOD'], ['iron', 'IRON'], ['steel', 'STEEL'], ['leather', 'LEATHER'], ['wheat', 'WHEAT']]; // ad: mal.<anahtar>

// Hazırlık filtresi (çok seçmeli): seçilen her özelliği taşıyan kartlar görünür, ör. mızrak + kalkan + atlı.
const FILTRE = [
  ['kilic', (c) => c.model === 'sword' || c.model === 'great'],
  ['mizrak', (c) => c.model === 'spear'],
  ['yay', (c) => c.ranged],
  ['kalkan', (c) => c.shield > 0],
  ['atli', (c) => c.mounted],
];
const filtre = new Set(loadS('akinvar.filtre', '').split(',').filter((k) => FILTRE.some(([f]) => f === k)));
const filtredeMi = (c) => FILTRE.every(([k, f]) => !filtre.has(k) || f(c));
function renderFiltre() {
  $('filtre').innerHTML = `<span class="eyebrow">${t('filtre.baslik')}</span>` + FILTRE.map(([k]) => `<button data-filtre="${k}" class="${filtre.has(k) ? 'secili' : ''}" aria-pressed="${filtre.has(k)}">${t('filtre.' + k)}</button>`).join('')
    + (filtre.size ? `<button class="temizle" data-filtre="">${t('filtre.temizle')}</button>` : '');
}
$('filtre').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filtre]'); if (!b) return;
  const k = b.dataset.filtre;
  if (!k) filtre.clear(); else if (filtre.has(k)) filtre.delete(k); else filtre.add(k);
  save('akinvar.filtre', [...filtre].join(','));
  renderPrep();
});

function renderPrep() {
  renderFiltre();
  $('prep-round').textContent = t('hazirlik.tur', { n: m.round });
  $('prep-gold').textContent = num(me.gold);
  $('prep-income').textContent = t('hazirlik.gelir', { n: num(income(me)) });
  const eco = ecoCost(me.eco);
  $('eco').innerHTML = `<img src="${ICON('GOLD')}" alt=""><div><span class="fam">${t('eko.seviye', { n: me.eco })}</span><b>${t('eko.gelir', { a: num(income(me)), b: num(incomeAt(me.eco + 1)) })}</b></div><span class="price">◉ ${num(eco)}</span>${me.bought.eco ? `<span class="badge">+${me.bought.eco}</span>` : ''}`;
  $('eco').classList.toggle('poor', me.gold < eco);
  const counts = new Map();
  for (const u of me.units) counts.set(u, (counts.get(u) ?? 0) + 1);
  const gorunen = CLASSES.filter(filtredeMi);
  $('cards').innerHTML = (gorunen.length ? '' : `<p class="bos">${t('filtre.bos')}</p>`) + gorunen.map((c) => {
    const n = counts.get(c.index) ?? 0, fam = FAMILIES[c.family], lv = me.talim[c.index], up = talimCost(me), max = lv >= TALIM.max;
    return `<div class="card unit ${me.gold < c.cost ? 'poor' : ''} ${n ? 'has' : ''}" data-cls="${c.index}" style="--fam:${fam.color}" role="button" tabindex="0" title="${sinifAdi(c)} · ${sinifDetay(c)}">
      <div class="main">
        <div class="pic"><img class="soldier" src="${IMG(c)}" alt="" draggable="false" style="object-view-box:${viewBox.get(IMG(c)) ?? 'none'}">
          <span class="fam">${aileAdi(c.family)}</span>${n ? `<span class="badge">×${n}</span>` : ''}</div>
        <div class="side">
          <button class="up ${max || me.gold < up ? 'off' : ''} ${lv ? 'on' : ''}" data-up="${c.index}" title="${t('kart.gelistir', { lv, max: TALIM.max })}">⬆ ${max ? t('kart.enUst') : num(up)}</button>
          <div class="items">${c.items.map((k) => `<img src="${ICON(k)}" alt="">`).join('')}</div>
          <div class="stats"><span class="hp" title="${t('kart.can')}">♥ ${3 + lv}${lv ? `<sup>+${lv}</sup>` : ''}</span><span title="${t('kart.menzil')}">⇢ ${dec(c.reach)}</span><span title="${t('kart.hiz')}">» ${dec(c.speed)}</span></div>
        </div>
      </div>
      <div class="row-name"><b class="name">${t('silah.' + c.wkey)}</b><span class="price">◉ ${num(c.cost)}</span></div>
    </div>`;
  }).join('') + `<button class="card ready" id="ready" ${me.ready ? 'disabled' : ''}>${me.ready ? t('hazir.bekleniyor') : t('hazir.hazir') + ' <span>→</span>'}<small>${t('sayi.boluk', { n: me.units.length })} · ${t('sayi.asker', { n: me.units.length * PER_BOLUK })}</small></button>`;
  $('prep').classList.toggle('waiting', !!me.ready);
  $('prep-team').innerHTML = m.players.map((p) => {
    const info = p.out ? t('takim.elendi') : p === me ? t('sayi.boluk', { n: me.units.length }) : p.team === me.team ? `${t('sayi.boluk', { n: p.units.length })} · ${t('takim.eko', { n: p.eco })}` : t(p.ready ? 'takim.hazir' : 'takim.kuruyor');
    return `<div class="pl ${p.team ? 'red' : 'blue'} ${p === me ? 'me' : ''} ${p.out ? 'out' : ''}"><i style="background:${p.color}"></i><b>${esc(oyuncuAdi(p))}</b><span>${info}</span><em>⚑ ${num(p.hp)}</em></div>`;
  }).join('');
}

function showInfo(c) {
  if (!c) { $('info').innerHTML = `<span class="muted">${t(touch ? 'bilgi.bosDokun' : 'bilgi.bos')}</span>`; return; }
  const strong = EDGE[c.index].filter((x) => x.s > 0).slice(0, 3), weak = EDGE[c.index].filter((x) => x.s < 0).slice(-3).reverse();
  const chip = (x) => `<span class="mini"><img src="${IMG(x.d)}" alt="">${sinifAdi(x.d)}${x.d.skey || x.d.akey ? ' · ' + sinifDetay(x.d) : ''}</span>`;
  const mats = MAT.filter(([k]) => c.materials[k]).map(([k, icon]) => `<span class="mat"><img src="${ICON(icon)}" alt="">${c.materials[k]} ${t('mal.' + k)}</span>`).join('') || `<span class="muted">${t('bilgi.esyasiz')}</span>`;
  $('info').innerHTML = `<b>${sinifAdi(c)}</b><span class="muted">${sinifDetay(c)}</span>${c.skirmish ? `<span class="sep"></span><span class="muted">${t('bilgi.vurKac')}</span>` : c.mounted ? `<span class="sep"></span><span class="muted">${t('bilgi.hucum', { s: CHARGE.time, k: CHARGE.mult })}</span>` : ''}<span class="sep"></span><span class="lbl">${t('bilgi.askerBasi')}</span>${mats}
    <span class="sep"></span><span class="lbl good">${t('bilgi.ustun')}</span>${strong.map(chip).join('') || '—'}<span class="sep"></span><span class="lbl bad">${t('bilgi.zayif')}</span>${weak.map(chip).join('') || '—'}`;
}

function floatAt(el, text, good) {
  if (!el) return;
  const r = el.getBoundingClientRect(), f = document.createElement('div');
  f.className = 'float' + (good ? ' good' : ''); f.textContent = text;
  f.style.left = r.left + r.width / 2 + 'px'; f.style.top = r.top + r.height * 0.35 + 'px';
  $('floats').append(f); setTimeout(() => f.remove(), 1100);
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

// Hazırlık işlemi: tek başına maça doğrudan, çevrim içi sunucuya (ve anında geri bildirim için görünüme de) uygulanır.
const ACT = {
  al: { run: (c) => buyUnit(m, me, c), back: (c) => refundUnit(m, me, c), cost: (c) => CLASSES[c].cost },
  talim: { run: (c) => buyTalim(m, me, c), back: (c) => refundTalim(m, me, c), cost: () => talimCost(me), backCost: (c) => talimPaid(me, c) },
  eko: { run: () => buyEco(m, me), back: () => refundEco(m, me), cost: () => ecoCost(me.eco), backCost: () => ecoCost(me.eco - 1) },
};
const NET = { al: ['al', 'geri'], talim: ['talim', 'talimGeri'], eko: ['eko', 'ekoGeri'] };
function act(kind, arg, el, refund) {
  if (state !== 'prep' || me.ready) return;
  // Kayan tutar işlemden önce: geri verilecek tutar, geri verince değişir.
  const a = ACT[kind], amount = refund ? (a.backCost ? a.backCost(arg) : a.cost(arg)) : a.cost(arg);
  const ok = refund ? a.back(arg) : a.run(arg);
  if (!ok) { if (!refund) shake(el); return; }
  if (online) net({ t: NET[kind][refund ? 1 : 0], c: arg, f: arg });
  const sel = el.dataset.up ? `[data-up="${arg}"]` : el.dataset.cls ? `[data-cls="${arg}"]` : '#eco';
  renderPrep();
  floatAt(document.querySelector(sel), `${refund ? '+' : '−'}${num(amount)}`, refund);
}
function prepClick(e, refund) {
  const up = e.target.closest('[data-up]'), card = e.target.closest('[data-cls]');
  if (e.target.closest('#ready')) { if (!refund) beginBattle(); return; }
  if (e.target.closest('#eco')) { act('eko', 0, $('eco'), refund); return; }
  if (up) { act('talim', +up.dataset.up, up, refund); return; }
  if (card) act('al', +card.dataset.cls, card, refund);
}
// Dokunmatikte sağ tık yok: karta (ya da ⬆ / ekonomiye) basılı tutmak geri verir; dokunuş bilgi şeridini de gösterir.
let prepHold = null, prepPointer = 'mouse';
$('prep').addEventListener('pointerdown', (e) => {
  prepPointer = e.pointerType;
  if (e.pointerType !== 'touch') return;
  const card = e.target.closest('[data-cls]');
  if (card) showInfo(CLASSES[+card.dataset.cls]);
  if (!e.target.closest('[data-cls], [data-up], #eco') || e.target.closest('#ready')) return;
  const hold = { x: e.clientX, y: e.clientY, target: e.target, done: false };
  hold.timer = setTimeout(() => { hold.done = true; navigator.vibrate?.(15); prepClick({ target: hold.target }, true); }, 500);
  prepHold = hold;
});
$('prep').addEventListener('pointermove', (e) => {
  if (prepHold && !prepHold.done && Math.hypot(e.clientX - prepHold.x, e.clientY - prepHold.y) > 10) { clearTimeout(prepHold.timer); prepHold = null; }
});
for (const ev of ['pointerup', 'pointercancel']) $('prep').addEventListener(ev, () => { if (prepHold) clearTimeout(prepHold.timer); });
$('prep').addEventListener('click', (e) => {
  const held = prepHold?.done; prepHold = null;
  if (!held) prepClick(e, false); // basılı tutup geri verdikten sonra gelen tıklama alım sayılmaz
});
$('prep').addEventListener('contextmenu', (e) => { e.preventDefault(); if (prepPointer !== 'touch') prepClick(e, true); });
$('prep').addEventListener('mouseover', (e) => { const card = e.target.closest('[data-cls]'); showInfo(card ? CLASSES[+card.dataset.cls] : null); });

// ---------- seçim ve emir ----------

const mine = (b) => w && w.bowner[b] === myIdx;

function syncSelection() {
  if (!w) return;
  for (const b of [...selected]) if (!w.balive[b]) selected.delete(b);
  view.setSelection(selected);
  let n = 0; const fams = new Set();
  for (const b of selected) { n += w.balive[b]; fams.add(CLASSES[w.bcls[b]].family); }
  for (let b = 0; b < tagEls.length; b++) tagEls[b].classList.toggle('sel', selected.has(b));
  renderDeck();
  $('sel-info').textContent = selected.size
    ? `${t('sayi.boluk', { n: selected.size })} · ${t('sayi.asker', { n })}` + (fams.size === 1 ? ` · ${aileAdi([...fams][0])}` : '')
    : t('secim.yok');
}

// ---------- bölük sancakları ve seçim destesi ----------

// Her bölüğün üstünde siyah zeminde throneofcurse asker görseli: sınıfı (silah, kalkan, zırh, at) bir bakışta.
// Gizli başlar (tagShown false ile aynı); yoksa ilk karede görünmeyen sancak sol üst köşede kalıyordu.
let tagEls = [], tagShown = [], deckSig = '', drawAlpha = 1, tagX = new Float32Array(0), tagZ = new Float32Array(0), tagN = new Int32Array(0);
function buildTags() {
  $('unit-tags').innerHTML = [...Array(w.B).keys()].map((b) => {
    const c = CLASSES[w.bcls[b]], color = m.players[m.order[w.bowner[b]]].color;
    return `<div class="tag ${w.bteam[b] === me.team ? 'own' : 'foe'} ${mine(b) ? 'mine' : ''}" style="display:none;--team:${color};--fam:${FAMILIES[c.family].color}"><img src="${IMG(c)}" alt="" style="object-view-box:${viewBox.get(IMG(c)) ?? 'none'}"></div>`;
  }).join('');
  tagEls = [...$('unit-tags').children]; tagShown = tagEls.map(() => false); deckSig = '';
  tagX = new Float32Array(w.B); tagZ = new Float32Array(w.B); tagN = new Int32Array(w.B);
}
function placeTags() {
  const show = state === 'battle' || state === 'flag', proj = show && view.projector();
  // Sancak, askerlerin çizildiği (ara değerli) konumların ortasında: simülasyonun bölük ortası yalnız yarım saniyede bir yenilenir, takılır.
  if (show && tagX.length === w.B) {
    tagX.fill(0); tagZ.fill(0); tagN.fill(0);
    const { x, z, px, pz, hp, boluk } = w, a = drawAlpha;
    for (let i = 0; i < w.N; i++) if (hp[i] > 0) { const b = boluk[i]; tagX[b] += px[i] + (x[i] - px[i]) * a; tagZ[b] += pz[i] + (z[i] - pz[i]) * a; tagN[b]++; }
  }
  if (show) $('unit-tags').style.setProperty('--s', Math.max(0.55, Math.min(1.1, 26 / view.zoom)).toFixed(2));
  for (let b = 0; b < tagEls.length; b++) {
    const n = show && b < tagN.length ? tagN[b] : 0, cx = tagX[b] / n, cz = tagZ[b] / n;
    let vis = n > 0 && (w.bteam[b] === me.team || !view.fogOn || visibleTo(w, me.team, cx, cz));
    const s = vis && proj(cx, cz, 2.6);
    if (vis && !(s.x > 20 && s.x < innerWidth - 20 && s.y > 100 && s.y < innerHeight)) vis = false; // ekran dışındaki ya da üst bandın altındaki yarım görünmesin
    if (vis !== tagShown[b]) { tagShown[b] = vis; tagEls[b].style.display = vis ? '' : 'none'; }
    if (!vis) continue;
    tagEls[b].style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px) translate(-50%,-100%)`;
  }
}

// Sol altta deste: seçili bölükler sınıf sınıf kart olarak. Aynı sınıftan birden çok bölük üst üste dizilir.
function renderDeck() {
  const groups = new Map();
  for (const b of selected) {
    const g = groups.get(w.bcls[b]) ?? { n: 0, alive: 0 }; g.n++; g.alive += w.balive[b]; groups.set(w.bcls[b], g);
  }
  const list = [...groups].sort((a, b) => CLASSES[a[0]].family - CLASSES[b[0]].family || a[0] - b[0]);
  const sig = list.map(([c, g]) => `${c}:${g.n}:${g.alive}`).join(',');
  if (sig === deckSig) return; deckSig = sig;
  $('deck').innerHTML = list.map(([ci, g]) => {
    const c = CLASSES[ci];
    return `<button class="dk" data-cls="${ci}" data-stack="${Math.min(g.n, 4) - 1}" style="--fam:${FAMILIES[c.family].color}" title="${sinifAdi(c)} · ${sinifDetay(c)}
${t('deste.ipucu')}">
      <span class="fam">${aileAdi(c.family)}</span>${g.n > 1 ? `<span class="badge">×${g.n}</span>` : ''}
      <img class="soldier" src="${IMG(c)}" alt="" draggable="false" style="object-view-box:${viewBox.get(IMG(c)) ?? 'none'}">
      <b>${sinifAdi(c)}</b><span class="bar"><i style="width:${(100 * g.alive / (g.n * PER_BOLUK)).toFixed(0)}%"></i></span><small>${t('sayi.asker', { n: g.alive })}</small></button>`;
  }).join('');
}
$('deck').addEventListener('click', (e) => {
  const el = e.target.closest('.dk'); if (!el || !w) return;
  const ci = +el.dataset.cls, base = [...selected];
  selected = new Set(e.shiftKey ? base.filter((b) => w.bcls[b] !== ci) : base.filter((b) => w.bcls[b] === ci));
  syncSelection();
});

function centers() {
  const cx = new Float32Array(w.B), cz = new Float32Array(w.B), n = new Int32Array(w.B);
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { const b = w.boluk[i]; cx[b] += w.x[i]; cz[b] += w.z[i]; n[b]++; }
  for (let b = 0; b < w.B; b++) if (n[b]) { cx[b] /= n[b]; cz[b] /= n[b]; }
  return { cx, cz, n };
}

function soldierAt(p, pred, range = 1.6) {
  let best = -1, bestD = range * range;
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0 || !pred(i)) continue;
    if (w.team[i] !== me.team && !visibleTo(w, me.team, w.x[i], w.z[i])) continue;
    const d = (w.x[i] - p.x) ** 2 + (w.z[i] - p.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function selectWhere(pred, add) {
  if (!add) selected = new Set();
  const c = centers();
  for (let b = 0; b < w.B; b++) if (mine(b) && c.n[b] && pred(b, c)) selected.add(b);
  syncSelection();
}

function sendCommand(list, cmd) {
  if (online) net({ t: 'emir', l: list, c: cmd });
  else command(w, me.team, list, cmd, myIdx);
}
function order(cmd) {
  if (state !== 'battle' || !selected.size) return;
  sendCommand([...selected], cmd);
}

function flagOrder(p) {
  let best = -1, bestD = 36;
  w.flags.forEach((f, k) => { const d = (f.x - p.x) ** 2 + (f.z - p.z) ** 2; if (f.hp > 0 && d < bestD) { bestD = d; best = k; } });
  if (best < 0) return;
  const list = selected.size ? [...selected] : [...Array(w.B).keys()].filter(mine);
  sendCommand(list, { type: 'flag', flag: best });
  view.showMarker(w.flags[best].x, w.flags[best].z, true);
}

const scene = $('scene'), box = $('selbox');
let press = null, panDrag = null, lastClick = { t: 0, b: -1 };
const canCommand = () => (state === 'battle' || state === 'flag') && !me.out && !(state === 'flag' && w.winner !== me.team);
scene.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' || state === 'menu' || state === 'prep') return; // dokunuş: aşağıda
  scene.setPointerCapture(e.pointerId);
  if (e.button === 1) { panDrag = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
  if (e.button === 0) press = { x: e.clientX, y: e.clientY, box: false };
  if (e.button === 2 && canCommand()) {
    const p = view.groundAt(e.clientX, e.clientY); if (!p) return;
    if (state === 'flag') { flagOrder(p); return; }
    const enemy = soldierAt(p, (i) => w.team[i] !== me.team, 1.8);
    if (enemy >= 0) { order({ type: 'attack', target: w.boluk[enemy] }); if (selected.size) view.showMarker(w.x[enemy], w.z[enemy], true); }
    else { order({ type: 'move', x: p.x, z: p.z }); if (selected.size) view.showMarker(p.x, p.z, false); }
  }
});
scene.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  if (panDrag) {
    const a = view.groundAt(panDrag.x, panDrag.y), b = view.groundAt(e.clientX, e.clientY);
    if (a && b) view.target.sub(b.sub(a));
    panDrag = { x: e.clientX, y: e.clientY }; return;
  }
  if (!press) return;
  if (!press.box && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.box = true;
  if (press.box) {
    const l = Math.min(press.x, e.clientX), t = Math.min(press.y, e.clientY);
    Object.assign(box.style, { left: l + 'px', top: t + 'px', width: Math.abs(e.clientX - press.x) + 'px', height: Math.abs(e.clientY - press.y) + 'px' });
    box.hidden = false;
  }
});
scene.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
  if (panDrag && e.button === 1) { panDrag = null; return; }
  if (!press || e.button !== 0) return;
  const add = e.shiftKey || e.ctrlKey;
  if (!canCommand()) { press = null; box.hidden = true; return; }
  if (press.box) {
    const l = Math.min(press.x, e.clientX), r = Math.max(press.x, e.clientX), t = Math.min(press.y, e.clientY), btm = Math.max(press.y, e.clientY);
    selectWhere((b, c) => { const s = view.toScreen(c.cx[b], c.cz[b]); return s.x >= l && s.x <= r && s.y >= t && s.y <= btm; }, add);
  } else {
    const p = view.groundAt(e.clientX, e.clientY), i = p ? soldierAt(p, (j) => mine(w.boluk[j])) : -1;
    const now = performance.now();
    if (i < 0) { if (!add) { selected = new Set(); syncSelection(); } }
    else {
      const b = w.boluk[i];
      if (now - lastClick.t < 350 && lastClick.b === b) {
        // Çift tık: ekrandaki aynı sınıftan bölüklerin hepsi.
        const cls = w.bcls[b];
        selectWhere((o, c) => w.bcls[o] === cls && view.toScreen(c.cx[o], c.cz[o]).on, add);
      } else {
        if (!add) selected = new Set();
        if (add && selected.has(b)) selected.delete(b); else selected.add(b);
        syncSelection();
      }
      lastClick = { t: now, b };
    }
  }
  press = null; box.hidden = true;
});
scene.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- dokunmatik ----------
// Tek parmak: sürükle = kamerayı kaydır · dokun = seç / emir (seçiliyken zemine yürü, düşmana saldır; bayrak evresinde
// bayrağa gönder) · basılı tut, sonra sürükle = kutu seçimi. İki parmak: kıstır = yakınlaştır, çevir = döndür, birlikte
// kaydır = kamerayı kaydır. Bölük, sancağının ekrandaki yerine parmak payıyla (TOUCH.reach) seçilir.
const TOUCH = { tapTime: 300, tapMove: 12, holdTime: 0.42, reach: 46, dbl: 380 };
const fingers = new Map();
let gesture = null, multiSelect = false, lastTap = { t: 0, b: -1 };

/** Ekrandaki noktaya en yakın bölük (sancağına göre), parmak payı içinde. */
function bolukAtScreen(x, y, pred) {
  const c = centers();
  let best = -1, bestD = TOUCH.reach * TOUCH.reach;
  for (let b = 0; b < w.B; b++) {
    if (!c.n[b] || !pred(b)) continue;
    if (w.bteam[b] !== me.team && !visibleTo(w, me.team, c.cx[b], c.cz[b])) continue;
    const s = view.toScreen(c.cx[b], c.cz[b]), d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function touchTap(x, y) {
  if (!canCommand()) return;
  const p = view.groundAt(x, y);
  if (state === 'flag') { if (p) flagOrder(p); return; }
  const own = bolukAtScreen(x, y, mine);
  if (own >= 0) {
    const now = performance.now();
    if (now - lastTap.t < TOUCH.dbl && lastTap.b === own) {
      // Çift dokunuş: ekrandaki aynı sınıftan bölüklerin hepsi.
      const cls = w.bcls[own];
      selectWhere((o, c) => w.bcls[o] === cls && view.toScreen(c.cx[o], c.cz[o]).on, multiSelect);
    } else if (multiSelect) { if (selected.has(own)) selected.delete(own); else selected.add(own); syncSelection(); }
    else { selected = new Set([own]); syncSelection(); }
    lastTap = { t: now, b: own };
    return;
  }
  if (!selected.size || !p) return;
  const foe = bolukAtScreen(x, y, (b) => w.bteam[b] !== me.team);
  if (foe >= 0) { order({ type: 'attack', target: foe }); view.showMarker(w.cx[foe], w.cz[foe], true); }
  else { order({ type: 'move', x: p.x, z: p.z }); view.showMarker(p.x, p.z, false); }
}

function twoFingers() {
  const [a, b] = [...fingers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

scene.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || state === 'menu' || state === 'prep') return;
  try { scene.setPointerCapture(e.pointerId); } catch { /* parmak çoktan kalktı */ }
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, at: performance.now() });
  if (fingers.size === 1) {
    const id = e.pointerId;
    gesture = { kind: 'wait', id, last: { x: e.clientX, y: e.clientY } };
    gesture.hold = setTimeout(() => {
      if (gesture?.kind !== 'wait' || gesture.id !== id || !canCommand() || state !== 'battle') return;
      gesture.kind = 'box'; navigator.vibrate?.(15);
      const f = fingers.get(id);
      Object.assign(box.style, { left: f.x0 + 'px', top: f.y0 + 'px', width: '0px', height: '0px' }); box.hidden = false;
    }, TOUCH.holdTime * 1000);
  } else if (fingers.size === 2) {
    clearTimeout(gesture?.hold); box.hidden = true;
    const g = twoFingers();
    gesture = { kind: 'two', d0: g.d, a0: g.ang, zoom0: view.zoom, angle0: view.angle, mid: { x: g.mx, y: g.my } };
  }
});
scene.addEventListener('pointermove', (e) => {
  const f = fingers.get(e.pointerId);
  if (e.pointerType !== 'touch' || !f || !gesture) return;
  f.x = e.clientX; f.y = e.clientY;
  if (gesture.kind === 'wait' && Math.hypot(f.x - f.x0, f.y - f.y0) > TOUCH.tapMove) { clearTimeout(gesture.hold); gesture.kind = 'pan'; }
  if (gesture.kind === 'pan') {
    const a = view.groundAt(gesture.last.x, gesture.last.y), b = view.groundAt(f.x, f.y);
    if (a && b) view.target.sub(b.sub(a));
    gesture.last = { x: f.x, y: f.y };
  } else if (gesture.kind === 'box') {
    Object.assign(box.style, { left: Math.min(f.x0, f.x) + 'px', top: Math.min(f.y0, f.y) + 'px', width: Math.abs(f.x - f.x0) + 'px', height: Math.abs(f.y - f.y0) + 'px' });
  } else if (gesture.kind === 'two' && fingers.size === 2) {
    const g = twoFingers();
    view.zoom = Math.min(w.radius * 1.3, Math.max(6, gesture.zoom0 * (gesture.d0 / g.d)));
    view.angle = gesture.angle0 + (g.ang - gesture.a0);
    view.resize();
    const a = view.groundAt(gesture.mid.x, gesture.mid.y), b = view.groundAt(g.mx, g.my);
    if (a && b) view.target.sub(b.sub(a));
    gesture.mid = { x: g.mx, y: g.my };
  }
});
function touchEnd(e) {
  const f = fingers.get(e.pointerId);
  if (e.pointerType !== 'touch' || !f) return;
  fingers.delete(e.pointerId);
  if (!gesture) return;
  clearTimeout(gesture.hold);
  if (gesture.kind === 'wait' && e.type === 'pointerup' && performance.now() - f.at < TOUCH.tapTime) touchTap(f.x, f.y);
  else if (gesture.kind === 'box' && e.type === 'pointerup') {
    const l = Math.min(f.x0, f.x), r = Math.max(f.x0, f.x), tp = Math.min(f.y0, f.y), btm = Math.max(f.y0, f.y);
    if (r - l > 8 || btm - tp > 8) selectWhere((b, c) => { const s = view.toScreen(c.cx[b], c.cz[b]); return s.x >= l && s.x <= r && s.y >= tp && s.y <= btm; }, multiSelect);
  }
  box.hidden = true;
  // İki parmaktan biri kalkınca kalan parmak yeni bir jest başlatmaz (yanlışlıkla emir ya da kaydırma olmasın).
  gesture = fingers.size ? { kind: 'done' } : null;
}
scene.addEventListener('pointerup', touchEnd);
scene.addEventListener('pointercancel', touchEnd);
scene.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.min(w.radius * 1.3, Math.max(6, view.zoom * Math.exp(e.deltaY * 0.0012)));
  view.resize();
}, { passive: false });

// ---------- klavye ----------

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); toggleDialog($('help-dialog')); return; }
  if (e.key === 'F3') { e.preventDefault(); $('perf').hidden = !$('perf').hidden; return; }
  if (e.target.closest?.('dialog, input')) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (state === 'menu') return; // bekleme odasını Esc kapatmaz
    if (selected.size) { selected = new Set(); syncSelection(); } else openMenu();
    return;
  }
  if (state === 'menu') return;
  if (state === 'prep') { if (e.key === 'Enter') beginBattle(); return; }
  keys.add(k);
  if (k === 'q') view.angle += Math.PI / 8;
  if (k === 'e') view.angle -= Math.PI / 8;
  if (k === 'f') focusArmy();
  if (k === 'p' && !online) { paused = !paused; syncButtons(); }
  if (!canCommand()) return;
  if (e.key === ' ') { e.preventDefault(); order({ type: 'stop' }); }
  if (['1', '2', '3', '4', '5'].includes(k)) selectWhere((b) => CLASSES[w.bcls[b]].family === Number(k) - 1, e.shiftKey);
  if (k === '`' || k === '"' || (k === 'a' && e.ctrlKey)) { e.preventDefault(); selectWhere(() => true); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function pan(dt) {
  let fx = 0, fz = 0;
  if (keys.has('w') || keys.has('arrowup')) fz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) fz += 1;
  if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
  if (keys.has('d') || keys.has('arrowright')) fx += 1;
  if (!fx && !fz) return;
  const v = view.zoom * 1.4 * dt, s = Math.sin(view.angle), c = Math.cos(view.angle);
  view.target.x += (fx * c + fz * s) * v; view.target.z += (-fx * s + fz * c) * v;
}

// ---------- çevrim içi ----------
// Tek WebSocket (lobiBag) listeyi, bekleme odasını ve maçı taşır. Odadayken adres ?oda=KOD gösterir; jeton
// sessionStorage'da durur, sayfa yenilenince aynı koltuğa dönülür (josephuz oda standardı).
let lobiBag = null, lobiAcik = false, lobiDeneme = 0, lobiListe = { odalar: [], cevrimici: 0 };
let odaDurum = null, tasiSecili = null, suruklenen = null;
const netQueue = []; // maç mesajları sırayla: savaş adımları saatle, gerisi hemen
const oturum = {
  al() { try { return JSON.parse(sessionStorage.getItem('akinvar.oda')); } catch { return null; } },
  yaz(v) { try { if (v) sessionStorage.setItem('akinvar.oda', JSON.stringify(v)); else sessionStorage.removeItem('akinvar.oda'); } catch { /* yok */ } },
};
const durumYaz = (t) => { $('cevrim-durum').textContent = t; };
const adresKodu = () => params.get('oda') ?? new URLSearchParams(location.search).get('oda');
const adresTemizle = () => { if (new URLSearchParams(location.search).get('oda') != null) history.replaceState(null, '', location.pathname); };
const davetLinki = (kod) => location.origin + location.pathname + '?oda=' + kod;
const net = (msg) => lobiBag?.gonder(msg);
const ozetYazi = (o) => `${o.takim}v${o.takim} · ⚑ ${num(o.can)} · ${t('zorluk.' + (o.zorluk in DIFFICULTY ? o.zorluk : 'orta'))}`;

function lobiBaglan() {
  if (lobiBag || params.has('cevrimdisi')) return;
  const b = lobiBag = sunucuBaglanti((d) => {
    if (d === 'acik') {
      lobiAcik = true; lobiDeneme = 0; b.gonder({ t: 'lobi' }); lobiYaz();
      const kayit = oturum.al(), kod = adresKodu() ? kodDuzelt(adresKodu()) : null;
      if (kayit?.kod && (!kod || kod === kayit.kod)) { durumYaz(t('ag.geriBaglaniyor')); istek({ t: 'don', kod: kayit.kod, jeton: kayit.jeton }); }
      else if (kod) { durumYaz(t('ag.baglaniyor')); istek({ t: 'kod', kod }); }
      return;
    }
    const oyunda = online && state !== 'menu', odada = oyunda || !!odaDurum;
    lobiAcik = false; lobiBag = null;
    if (odada) { odaDurum = null; toHome(); toast(t('ag.koptu')); }
    lobiYaz();
    setTimeout(lobiBaglan, Math.min(30000, 5000 * ++lobiDeneme));
  });
}
function istek(msg) { if (lobiAcik) lobiBag.gonder({ ...msg, ad: adim(), takim: secim.takim, can: secim.can, zorluk: secim.zorluk }); }
function lobiYenile() { if (lobiAcik) lobiBag.gonder({ t: 'lobi' }); }

/** Sunucudan gelen mesaj. Liste ve oda hemen; maç mesajları sıraya (savaş adımları saatle işlenir). */
function agMesaj(msg) {
  switch (msg.t) {
    case 'lobi': lobiListe = msg; lobiYaz(); return;
    case 'katildi': oturum.yaz({ kod: msg.kod, jeton: msg.jeton }); durumYaz(''); history.replaceState(null, '', '?oda=' + msg.kod); return;
    case 'oda': odaDurum = msg; if (!online || state === 'menu') bekleGoster(); return; // maç bitince sonuç ekranı kalır, LOBİYE DÖN açar
    case 'hata':
      durumYaz(msg.kod === 'oda.yok' || msg.kod === 'oda.dolu' ? t('sunucu.' + msg.kod) : msg.m);
      if (!odaDurum) { oturum.yaz(null); adresTemizle(); }
      return;
    default: netQueue.push(msg);
  }
}

// Sıradaki maç mesajlarını işler. Savaş adımı ('tik') zamanı gelince işlenir; sıra birikmişse yetişmek için hızlanır.
function netAdim(dt) {
  acc += dt;
  const backlog = netQueue.filter((x) => x.t === 'tik').length;
  let budget = backlog > 6 ? backlog - 2 : 1;
  while (netQueue.length) {
    const msg = netQueue[0];
    if (msg.t === 'tik') {
      if (!w || (acc < TICK && backlog <= 6)) break;
      if (budget-- <= 0) break;
      netQueue.shift(); acc = Math.max(0, acc - TICK);
      for (const q of msg.c) command(w, q.team, q.l, q.c, q.owner);
      const a = performance.now(); step(w); stats.simSum += performance.now() - a;
      continue;
    }
    netQueue.shift();
    macMesaj(msg);
  }
  if (acc > TICK * 3) acc = TICK;
}

function macMesaj(msg) {
  if (msg.t === 'mac') {
    const ilk = !m || !online, before = m && new Map(m.players.map((p) => [p.id, p.hp])), eskiFaz = m?.phase;
    online = true; m = msg.mac; me = m.players[msg.ben];
    if (ilk || state === 'menu' || state === 'over') enterGame();
    if (msg.tur) { roundOver(before, msg.tur); if (m.phase === 'prep') setTimeout(() => { if (m?.phase === 'prep' && state === 'roundEnd') enterPrep(prepLeftAt(msg)); }, 2600); return; }
    if (m.phase === 'prep') { if (state !== 'prep' && state !== 'roundEnd') enterPrep(prepLeftAt(msg)); else if (state === 'prep') { prepLeft = msg.prepLeft; renderPrep(); } }
    else if (eskiFaz === 'prep' && state === 'prep') $('prep').hidden = true;
    return;
  }
  if (msg.t === 'savas') {
    m.order = msg.order;
    w = createBattle(msg.kurulum);
    setupBattle();
    return;
  }
  if (msg.t === 'anlik' && w) {
    const fazOnce = w.phase;
    applySnapshot(w, msg.veri);
    if (fazOnce !== 'flag' && w.phase === 'flag' && state === 'battle') toFlags();
    if (state === 'battle' && w.phase === 'flag') toFlags();
  }
}
const prepLeftAt = (msg) => msg.prepLeft ?? PREP_TIME;

function lobiYaz() {
  $('cevrim').classList.toggle('kapali', !lobiAcik);
  for (const id of ['hizli', 'oda-kur', 'odaya-katil']) { $(id).disabled = !lobiAcik; }
  if (!lobiAcik) $('kod-satir').hidden = true;
  $('cevrimici-sayi').textContent = lobiAcik ? '● ' + t('lobi.cevrimici', { n: num(lobiListe.cevrimici ?? 0) }) : t('lobi.yakinda');
  $('acik-odalar').hidden = !lobiAcik;
  const l = lobiListe.odalar ?? [], k = $('odalar');
  $('oda-sayi').textContent = l.length ? String(l.length) : '';
  k.innerHTML = '';
  if (!l.length) { k.innerHTML = `<div class="bos">${t('lobi.bos')}</div>`; return; }
  for (const o of l) {
    const dolu = o.n >= o.max, e = document.createElement('button');
    e.className = 'oda'; e.disabled = dolu;
    e.innerHTML = `<span class="oda-ad"><b></b><small>${ozetYazi(o)} · ${t('lobi.oyuncu', { n: o.n, max: o.max })}</small></span><em class="oda-durum${o.durum === 'mac' ? ' macta' : ''}">${t(o.durum === 'mac' ? 'lobi.macta' : 'lobi.lobide')}</em><em class="oda-katil">${dolu ? t('lobi.dolu') : t('lobi.katil') + ' →'}</em>`;
    e.querySelector('b').textContent = o.kuran;
    e.onclick = () => { durumYaz(t('ag.baglaniyor')); istek({ t: 'kod', kod: o.kod }); };
    k.append(e);
  }
}
$('hizli').onclick = () => { if (!lobiAcik) return; durumYaz(t('ag.araniyor')); istek({ t: 'hizli' }); };
$('oda-kur').onclick = () => { if (!lobiAcik) return; durumYaz(t('ag.kuruluyor')); istek({ t: 'kur' }); };
$('odaya-katil').onclick = () => { const s = $('kod-satir'); s.hidden = !s.hidden; if (!s.hidden) $('kod').focus(); };
function kodlaKatil() {
  const kod = kodDuzelt($('kod').value);
  if (!kodYeterli(kod)) { durumYaz(t('ag.kodYaz')); $('kod').focus(); return; }
  $('kod').value = kod; durumYaz(t('ag.baglaniyor')); istek({ t: 'kod', kod });
}
$('kod-katil').onclick = kodlaKatil;
$('kod').onkeydown = (e) => { if (e.key === 'Enter') kodlaKatil(); };
$('kod').oninput = () => { const e = $('kod'), p = e.selectionStart; e.value = e.value.toUpperCase(); e.setSelectionRange(p, p); };

// Bekleme odası: üstte kod ve link, takım sütunları, kuranın ayarları, MAÇI BAŞLAT ↗ / Odadan çık
function bekleGoster() {
  const d = odaDurum; if (!d) return;
  state = 'menu'; online = false; netQueue.length = 0;
  for (const dl of document.querySelectorAll('dialog[open]')) dl.close();
  document.body.classList.remove('playing');
  $('home').hidden = true; $('bekleme').hidden = false; $('hud').hidden = true; $('prep').hidden = true; $('orders').hidden = true; $('flag-banner').hidden = true; $('flag-labels').innerHTML = '';
  const kuran = d.kuran === d.ben;
  $('b-goz').textContent = t('bekleme.goz', { ozet: ozetYazi(d) });
  $('b-kod').textContent = d.kod;
  $('b-gorunur').textContent = t(d.ozel ? 'bekleme.ozel' : 'bekleme.acik');
  if (!kuran || !d.koltuk.some((k) => k && k.u === tasiSecili)) tasiSecili = null;
  const n = d.koltuk.length / 2;
  $('koltuklar').innerHTML = [0, 1].map((k) => `<div class="takim ${k ? 'red' : 'blue'}"><span class="eyebrow">${takimAdi(k).toLocaleUpperCase(DIL)}</span><div class="sutun" data-t="${k}"></div></div>`).join('');
  d.koltuk.forEach((k, i) => {
    const e = document.createElement('button'); e.type = 'button';
    e.className = 'koltuk ' + (k ? 'dolu' : 'bos') + (k?.u === d.ben ? ' sen' : '') + (k?.koptu ? ' koptu' : '') + (k && k.u === tasiSecili ? ' secili' : '');
    e.innerHTML = k
      ? `<b></b>${k.u === d.kuran ? `<small>${t('bekleme.kuran')}</small>` : ''}${k.u === d.ben ? `<small class="sen">${t('bekleme.sen')}</small>` : ''}${k.koptu ? `<small class="kop">${t('bekleme.koptu')}</small>` : ''}`
      : `<span class="bot-yazi">${t('bekleme.botKoltuk')}</span><span class="otur-yazi">${t('bekleme.otur')}</span>`;
    if (k) e.querySelector('b').textContent = k.ad;
    e.onclick = () => koltukTik(i);
    if (kuran) {
      if (k) {
        e.draggable = true;
        e.ondragstart = (ev) => { suruklenen = k.u; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(k.u)); };
        e.ondragend = () => { suruklenen = null; };
      }
      e.ondragover = (ev) => { if (suruklenen != null && k?.u !== suruklenen) { ev.preventDefault(); e.classList.add('birak'); } };
      e.ondragleave = () => e.classList.remove('birak');
      e.ondrop = (ev) => { ev.preventDefault(); if (suruklenen != null && k?.u !== suruklenen) net({ t: 'tasi', u: suruklenen, i }); suruklenen = null; };
    }
    document.querySelector(`.sutun[data-t="${i < n ? 0 : 1}"]`).append(e);
  });
  $('b-takim').innerHTML = TEAM_SIZES.map((s) => `<button data-v="${s}" class="${s === d.takim ? 'secili' : ''}" ${kuran ? '' : 'disabled'}>${s}v${s}</button>`).join('');
  $('b-can').innerHTML = FLAG_HP.map((s) => `<button data-v="${s}" class="${s === d.can ? 'secili' : ''}" ${kuran ? '' : 'disabled'}>${num(s)}</button>`).join('');
  $('b-zorluk').innerHTML = Object.entries(DIFFICULTY).map(([key, v]) => `<button data-v="${key}" class="${key === d.zorluk ? 'secili' : ''}" ${kuran ? '' : 'disabled'}>${t('zorluk.' + key)}</button>`).join('');
  for (const b of $('b-ozel').children) { b.classList.toggle('secili', (b.dataset.v === '1') === d.ozel); b.disabled = !kuran; }
  const insan = d.koltuk.filter(Boolean).length;
  $('b-bilgi').textContent = t('bekleme.sayim', { i: insan, b: d.koltuk.length - insan });
  $('b-ipucu').textContent = t(tasiSecili != null ? 'bekleme.tasi' : kuran ? 'bekleme.ipucuKuran' : 'bekleme.ipucu');
  $('b-basla').hidden = !kuran; $('b-bekle').hidden = kuran;
}
function koltukTik(i) {
  const d = odaDurum; if (!d || d.durum !== 'lobi') return;
  const k = d.koltuk[i], kuran = d.kuran === d.ben;
  if (kuran && tasiSecili != null) { if (k?.u !== tasiSecili) net({ t: 'tasi', u: tasiSecili, i }); tasiSecili = null; bekleGoster(); return; }
  if (!k) { net({ t: 'otur', i }); return; }
  if (kuran) { tasiSecili = k.u; bekleGoster(); }
}
$('b-takim').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) net({ t: 'ayar', takim: +b.dataset.v }); };
$('b-can').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) net({ t: 'ayar', can: +b.dataset.v }); };
$('b-zorluk').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) net({ t: 'ayar', zorluk: b.dataset.v }); };
for (const b of $('b-ozel').children) b.onclick = () => net({ t: 'ayar', ozel: b.dataset.v === '1' });
$('b-basla').onclick = () => net({ t: 'basla' });
$('b-cik').onclick = () => odadanCik();
$('b-link').onclick = () => {
  const b = $('b-link'), u = davetLinki(odaDurum?.kod ?? ''), yaz = () => { $('b-ipucu').textContent = u; };
  try { navigator.clipboard.writeText(u).then(() => { b.textContent = t('bekleme.kopyalandi'); setTimeout(() => { b.textContent = t('bekleme.linkKopyala'); }, 1600); }, yaz); } catch { yaz(); }
};
/** Odadan çık: koltuk boşalır, ?oda ve jeton silinir, ana ekrana dönülür. */
function odadanCik() {
  if (lobiAcik) lobiBag.gonder({ t: 'cik' });
  odaDurum = null; oturum.yaz(null); adresTemizle();
  toHome();
}

// ---------- döngü ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (lobiBag) for (const msg of lobiBag.al()) agMesaj(msg);
  if (state !== 'prep') pan(dt);
  let running = false;
  if ((online && state !== 'menu') || netQueue.length) {
    netAdim(dt); running = state === 'battle' || state === 'flag'; // bekleme odasında gelen ilk maç mesajı da burada işlenir
  } else {
    running = (state === 'menu' && w.winner < 0) || ((state === 'battle' || state === 'flag') && !paused);
    if (state === 'prep' && !paused) { prepLeft -= dt; if (prepLeft <= 0) beginBattle(); }
    if (running) {
      acc += dt * (state === 'menu' ? 1 : speed);
      const a = performance.now();
      let n = 0;
      while (acc >= TICK && n++ < 8) { step(w); acc -= TICK; }
      if (n >= 8) acc = 0;
      stats.simSum += performance.now() - a;
    }
  }
  if (online && state === 'prep') prepLeft -= dt;
  if (!online && m && (state === 'prep' || state === 'battle' || state === 'flag') && (kayitT += dt) >= KAYIT_ARALIK) { kayitT = 0; kaydet(); }
  if (running && state !== 'menu') {
    if (state === 'battle' && !online && w.winner >= 0) toFlags();
    else if (state === 'flag' && w.phase === 'done' && !online) roundOver();
    if (w.tick % 20 === 0) syncSelection();
  }
  if (state === 'menu') { view.angle += dt * 0.03; if (w.winner >= 0) menuBattle(); }
  if (state !== 'prep') {
    const b = performance.now();
    drawAlpha = running ? Math.min(1, acc / TICK) : 1;
    view.render(w, drawAlpha, now / 1000, dt);
    stats.drawSum += performance.now() - b;
  }
  if (state === 'flag' || state === 'roundEnd') placeFlagLabels();
  if (tagEls.length) placeTags();
  stats.frames++;
  if (now - stats.since > 250) hud(now);
  requestAnimationFrame(frame);
}

function placeFlagLabels() {
  if (!w?.flags) return;
  for (const el of $('flag-labels').children) {
    const f = w.flags[+el.dataset.flag]; if (!f) continue;
    const s = view.toScreen(f.x, f.z, 6.2);
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    el.querySelector('span').textContent = num(Math.max(0, f.hp));
    el.classList.toggle('down', f.hp <= 0);
  }
}

function hud(now = performance.now()) {
  if (now - stats.since > 1000) {
    const s = (now - stats.since) / 1000;
    stats.fps = Math.round(stats.frames / s);
    stats.simMs = stats.simSum / Math.max(1, stats.frames); stats.drawMs = stats.drawSum / Math.max(1, stats.frames);
    stats.frames = stats.simSum = stats.drawSum = 0; stats.since = now;
    $('fps').textContent = stats.fps; $('sim-ms').textContent = stats.simMs.toFixed(1); $('draw-ms').textContent = stats.drawMs.toFixed(1);
  }
  stats.state = state; stats.round = m?.round; stats.t = w?.t; stats.alive = w && [...w.alive];
  if (!m || state === 'menu') return;
  if (state === 'prep') { $('prep-time').textContent = fmt(prepLeft); $('prep-time').classList.toggle('warn', prepLeft < 10); }
  $('round').textContent = t('hud.tur', { n: m.round });
  // Savaş sürerken ölen her asker sahibinin bayrağından düşer (tek başına: savaş sonunda işlenir; çevrim içi: tur sonu mesajıyla).
  const live = w && m.order && (state === 'battle' || (state === 'flag' && online)) ? battleLosses(m, w) : null;
  $('flags').innerHTML = [0, 1].map((t) => `<div class="side ${t ? 'red' : 'blue'}">${m.players.filter((p) => p.team === t).map((p) => {
    const hp = Math.max(0, p.hp - (live?.get(p.id) ?? 0));
    return `<span class="chip ${p === me ? 'me' : ''} ${p.out || !hp ? 'out' : ''}"><i style="background:${p.color}"></i>${esc(oyuncuAdi(p))} <b>⚑ ${num(hp)}</b></span>`;
  }).join('')}</div>`).join('');
  if (!w || state === 'prep') { $('score').hidden = true; $('zone').textContent = ''; return; }
  $('score').hidden = false;
  $('blue').textContent = num(w.alive[0]); $('red').textContent = num(w.alive[1]);
  const z = $('zone');
  if (state === 'flag') { z.textContent = t('hud.bayrak', { s: dec(Math.max(0, FLAG_TIME - w.flagT)) }); z.className = 'warn'; }
  else if (w.t < ZONE.wait) { z.textContent = `${fmt(w.t)} · ${t('hud.alanBekle', { k: fmt(ZONE.wait - w.t) })}`; z.className = ''; }
  else if (w.zone > 0) { z.textContent = `${fmt(w.t)} · ${t('hud.alanDaraliyor', { p: Math.round((w.zone / w.radius) * 100) })}`; z.className = 'warn'; }
  else { z.textContent = `${fmt(w.t)} · ${t('hud.alanKapandi')}`; z.className = 'warn'; }
}

function toast(text, ms = 2500) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- düğmeler ----------

function syncButtons() {
  $('pause').hidden = online; $('speed').hidden = online;
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').title = t(paused ? 'dugme.devam' : 'dugme.duraklat') + ' (P)';
  $('speed').textContent = `${speed}×`;
  for (const b of document.querySelectorAll('[data-size]')) b.classList.toggle('active', Number(b.dataset.size) === secim.takim);
  for (const b of document.querySelectorAll('[data-hp]')) b.classList.toggle('active', Number(b.dataset.hp) === secim.can);
  for (const b of document.querySelectorAll('[data-zor]')) b.classList.toggle('active', b.dataset.zor === secim.zorluk);
  $('menu-home').textContent = t(online ? 'menu.odadanCik' : 'menu.anaMenu');
  $('menu-eyebrow').textContent = t(online ? 'menu.gozCevrim' : 'menu.gozDurdu');
}
function toggleDialog(d) { if (d.open) d.close(); else d.showModal(); }
function openMenu() { if (!online) paused = true; syncButtons(); $('menu-dialog').showModal(); }

$('sizes').innerHTML = TEAM_SIZES.map((n) => `<button data-size="${n}"><b>${n}v${n}</b><small>${n === 1 ? t('ana.tekeTek') : t('ana.botYaninda', { n: n - 1 })}</small></button>`).join('');
$('hps').innerHTML = FLAG_HP.map((n) => `<button data-hp="${n}"><b>${num(n)}</b><small>${t('ana.can.' + n)}</small></button>`).join('');
$('zors').innerHTML = Object.entries(DIFFICULTY).map(([k, v]) => `<button data-zor="${k}"><b>${t('zorluk.' + k)}</b><small>${t('ana.zor.' + k)}</small></button>`).join('');
for (const b of document.querySelectorAll('[data-size]')) b.onclick = () => { secim.takim = +b.dataset.size; save('akinvar.takim', secim.takim); syncButtons(); };
for (const b of document.querySelectorAll('[data-hp]')) b.onclick = () => { secim.can = +b.dataset.hp; save('akinvar.bayrak', secim.can); syncButtons(); };
for (const b of document.querySelectorAll('[data-zor]')) b.onclick = () => { secim.zorluk = b.dataset.zor; save('akinvar.zorluk', secim.zorluk); syncButtons(); };
$('ad').value = secim.ad;
$('ad').oninput = () => { secim.ad = $('ad').value.slice(0, 16); save('akinvar.ad', secim.ad); };
$('play').onclick = startSolo;
$('devam').onclick = devamEt;
addEventListener('pagehide', kaydet);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') kaydet(); });
$('pause').onclick = () => { paused = !paused; syncButtons(); };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; syncButtons(); };
$('stop').onclick = () => order({ type: 'stop' });
$('select-all').onclick = () => w && selectWhere(() => true);
$('t-birak').onclick = () => { selected = new Set(); syncSelection(); };
$('t-coklu').onclick = () => { multiSelect = !multiSelect; $('t-coklu').classList.toggle('secili', multiSelect); };
$('t-ordu').onclick = () => w && focusArmy();
$('help').onclick = () => $('help-dialog').showModal();
$('menu-btn').onclick = () => state !== 'menu' && openMenu();
$('resume').onclick = () => $('menu-dialog').close();
$('menu-dialog').addEventListener('close', () => { paused = false; syncButtons(); });
$('menu-help').onclick = () => $('help-dialog').showModal();
$('menu-home').onclick = () => (online ? odadanCik() : toHome());
$('again').onclick = () => { if (!online) { startSolo(); return; } $('end-dialog').close(); online = false; state = 'over'; if (odaDurum) bekleGoster(); else toHome(); };
$('end-home').onclick = () => (online ? odadanCik() : toHome());
$('end-watch').onclick = () => { $('end-dialog').close(); if (!online) enterPrep(PREP_TIME); };
$('fog').onclick = () => { view.fogOn = !view.fogOn; view.fogFirst = true; $('fog').textContent = t('perf.sis', { d: t(view.fogOn ? 'perf.acik' : 'perf.kapali') }); };
$('shadows').onclick = () => { view.setShadows(!view.shadows); $('shadows').textContent = t('perf.golge', { d: t(view.shadows ? 'perf.acik' : 'perf.kapali') }); };
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
window.__akinCmd = {
  startSolo, beginBattle, selectAll: () => selectWhere(() => true), order, flagOrder, view, net,
  get m() { return m; }, get w() { return w; }, get sel() { return [...selected]; }, get state() { return state; }, get me() { return me; }, get online() { return online; }, get oda() { return odaDurum; },
};

// Android geri tuşu: açık pencereyi kapatır; oyunda menüyü açar; bekleme odasından çıkar; ana ekranda uygulamadan çıkar.
onBackButton(({ exit }) => {
  const open = document.querySelector('dialog[open]');
  if (open) { open.close(); return; }
  if (!$('bekleme').hidden) { odadanCik(); return; }
  if (state === 'menu') { exit(); return; }
  if (state !== 'over') openMenu();
});

dilUygula(); dilDugmesi($('dil'));
showInfo(null); menuBattle(); syncButtons(); hud(); lobiYaz(); lobiBaglan(); devamYaz();
if (params.has('oyna')) startSolo();
requestAnimationFrame(frame);
