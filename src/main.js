// Akın Var — tur tabanlı takım savaşı. Hazırlıkta kartlarla bölük al, savaşta yönet, bayrak evresinde rakip bayraklara yüklen.
// Tek başına: maç (match.js) ve savaş (sim.js) tarayıcıda. Çevrim içi: maçı sunucu yürütür; istemci savaşı sunucunun
// adımları ve emirleriyle aynen koşar, anlıklarla düzeltir (server/odalar.mjs).
import { TICK, ZONE, TEAMS, PREP_TIME, FLAG_TIME, FLAG_HP, TEAM_SIZES, TALIM, ECONOMY, DIFFICULTY } from './config.js';
import { step, command, visibleTo, createBattle, applySnapshot } from './sim.js';
import { CLASSES, FAMILIES, HIT, CLASS_COUNT } from './units.js';
import {
  createMatch, startBattle, startFlags, endRound, buyUnit, refundUnit, buyEco, refundEco, buyTalim, refundTalim,
  setReady, ecoCost, talimCost, income,
} from './match.js';
import { View } from './view.js';
import { sunucuBaglanti } from './ag.js';
import { kodDuzelt, kodYeterli } from './kod.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const fmt = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const num = (n) => Math.round(n).toLocaleString('tr-TR');
const dec = (n) => n.toFixed(1).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IMG = (c) => `img/asker/${c.img}.png`, ICON = (k) => `img/ikon/${k}.png`;

const view = new View($('scene'));
view.setShadows(params.get('golge') !== '0');
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
const adim = () => secim.ad.trim() || `Komutan-${String(1000 + ((Math.random() * 9000) | 0))}`;

// ---------- akış ----------

// Ana ekranın arkasında iki bot ordusu kendi kendine dövüşür.
function menuBattle() {
  const units = (team) => Array.from({ length: 22 }, (_, k) => CLASSES[(k * 7 + team * 11) % CLASSES.length].index);
  w = createBattle({ seed: 3, players: [0, 1].map((team) => ({ team, human: false, units: units(team) })) });
  view.build(w, { team: 0, colors: [TEAMS[0].color, TEAMS[1].color] });
  view.fogOn = false; view.zoom = w.radius * 0.9; view.resize();
}

function enterGame() {
  paused = false; speed = 1; syncButtons();
  document.body.classList.add('playing');
  $('home').hidden = true; $('bekleme').hidden = true; $('hud').hidden = false;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

function startSolo() {
  online = false;
  m = createMatch({ teamSize: secim.takim, flagHp: secim.can, difficulty: secim.zorluk });
  me = m.players[0]; me.name = secim.ad.trim() || 'Sen';
  enterGame(); enterPrep(PREP_TIME);
}

function toHome() {
  state = 'menu'; m = null; online = false; netQueue.length = 0; document.body.classList.remove('playing');
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('home').hidden = false; $('hud').hidden = true; $('orders').hidden = true; $('prep').hidden = true; $('flag-banner').hidden = true;
  $('flag-labels').innerHTML = ''; $('bekleme').hidden = true;
  menuBattle(); lobiYaz(); lobiYenile();
}

function enterPrep(left) {
  state = 'prep'; prepLeft = left; $('flag-labels').innerHTML = ''; $('flag-banner').hidden = true; $('orders').hidden = true;
  if (me.out) { $('prep').hidden = true; if (!online) beginBattle(); return; } // elenen izler: hazırlık yok
  $('prep').hidden = false; renderPrep(); hud();
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
  selected = new Set(); syncSelection(); focusArmy();
  if (!online && w.winner >= 0) toFlags(); // bir taraf hiç asker almadıysa savaş olmaz
  hud();
}

function toFlags() {
  if (!online) startFlags(m);
  if (w.phase !== 'flag') { if (!online) roundOver(); return; }
  state = 'flag'; selected = new Set(); syncSelection();
  view.buildFlags(w.flags, w.flags.map((f) => m.players[f.player].color));
  // Kamera tepeye çıkar: bayraklar ve sağ kalanlar tek bakışta.
  const xs = w.flags.map((f) => f.x), zs = w.flags.map((f) => f.z);
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { xs.push(w.x[i]); zs.push(w.z[i]); }
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  view.target.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
  view.zoom = Math.max(18, Math.min(60, span * 0.6 + 8)); view.resize();
  $('flag-labels').innerHTML = w.flags.map((f, k) => `<div class="flag-label" data-flag="${k}"><b>${esc(m.players[f.player].name)}</b><span></span></div>`).join('');
  const winnerMe = w.winner === me.team && !me.out;
  $('flag-banner').hidden = false;
  $('flag-title').textContent = w.winner === me.team ? 'Saha senin. Bayraklara yüklen.' : 'Saha düştü. Bayraklarına koşuyorlar.';
  $('flag-hint').textContent = winnerMe ? 'Askerlerini seç, rakip bayrağa sağ tıkla (seçim yoksa hepsi gider). 10 saniyede gönderilmeyen dağılır.' : 'Her asker bayraktan bir can götürür.';
  $('orders').hidden = !winnerMe;
}

/** Tur bitti. Tek başına: maçı burada ilerletir. Çevrim içi: sunucunun yeni maç görünümü gelmiştir (before = eski canlar). */
function roundOver(before = new Map(m.players.map((p) => [p.id, p.hp])), result = null) {
  state = 'roundEnd'; $('flag-banner').hidden = true; $('orders').hidden = true;
  if (!online) endRound(m);
  const lost = m.players.filter((p) => before.get(p.id) !== p.hp).map((p) => `${p.name} −${num(before.get(p.id) - p.hp)}${p.out ? ' (elendi)' : ''}`);
  const wn = (result ?? m.log.at(-1))?.winner;
  toast(wn === 2 || wn === undefined ? 'Berabere: iki ordu da yok oldu.' : `${TEAMS[wn].name} turu kazandı.${lost.length ? ' ' + lost.join(' · ') : ''}`, 3200);
  if (m.phase === 'over') { setTimeout(finish, 1600); return; }
  if (me.out && !me.toldOut) { me.toldOut = true; setTimeout(showOut, 1600); return; }
  if (!online) setTimeout(() => { if (state === 'roundEnd') enterPrep(PREP_TIME); }, 2600);
}

function finish() {
  state = 'over';
  const won = m.winner === me.team;
  $('end-eyebrow').textContent = won ? `${m.round} TURDA ZAFER` : `${m.round}. TURDA SANCAK DÜŞTÜ`;
  $('end-title').textContent = won ? 'Zafer.' : 'Yenilgi.';
  $('end-copy').textContent = m.players.map((p) => `${p.name} (${TEAMS[p.team].name}): ${num(p.hp)} can, ekonomi ${p.eco}`).join(' · ');
  $('end-watch').hidden = true;
  $('again').innerHTML = online ? 'LOBİYE DÖN →' : 'YENİ MAÇ →';
  $('end-home').textContent = online ? 'Odadan çık' : 'Ana menü';
  $('end-dialog').showModal();
}

function showOut() {
  $('end-eyebrow').textContent = 'BAYRAĞIN DÜŞTÜ';
  $('end-title').textContent = 'Elendin.';
  $('end-copy').textContent = 'Takımın savaşmayı sürdürüyor. İstersen izle.';
  $('end-watch').hidden = false;
  $('again').innerHTML = online ? 'LOBİYE DÖN →' : 'YENİ MAÇ →';
  $('end-home').textContent = online ? 'Odadan çık' : 'Ana menü';
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
const MAT = [['wood', 'WOOD', 'odun'], ['iron', 'IRON', 'demir'], ['steel', 'STEEL', 'çelik'], ['leather', 'LEATHER', 'deri'], ['wheat', 'WHEAT', 'yem']];

function renderPrep() {
  $('prep-round').textContent = `TUR ${m.round} · HAZIRLIK`;
  $('prep-gold').textContent = num(me.gold);
  $('prep-income').textContent = `her tur +◉ ${num(income(me))}`;
  const eco = ecoCost(me.eco);
  $('eco').innerHTML = `<img src="${ICON('GOLD')}" alt=""><div><span class="fam">EKONOMİ · SEVİYE ${me.eco}</span><b>Her tur ◉ ${num(income(me))} → ◉ ${num(income(me) + ECONOMY.levelIncome)}</b></div><span class="price">◉ ${num(eco)}</span>${me.bought.eco ? `<span class="badge">+${me.bought.eco}</span>` : ''}`;
  $('eco').classList.toggle('poor', me.gold < eco);
  const counts = new Map();
  for (const u of me.units) counts.set(u, (counts.get(u) ?? 0) + 1);
  $('cards').innerHTML = CLASSES.map((c) => {
    const n = counts.get(c.index) ?? 0, fam = FAMILIES[c.family], lv = me.talim[c.index], up = talimCost(lv), max = lv >= TALIM.max;
    return `<div class="card unit ${me.gold < c.cost ? 'poor' : ''} ${n ? 'has' : ''}" data-cls="${c.index}" style="--fam:${fam.color}" role="button" tabindex="0" title="${c.title} · ${c.detail}">
      <div class="card-top"><span class="fam">${fam.name}</span>
        <button class="up ${max || me.gold < up ? 'off' : ''} ${lv ? 'on' : ''}" data-up="${c.index}" title="Geliştir: bu sınıfın her askerine +1 can (seviye ${lv}/${TALIM.max})">⬆ ${max ? 'EN ÜST' : num(up)}</button></div>
      <div class="pic"><img class="soldier" src="${IMG(c)}" alt="" draggable="false">
        <div class="items">${c.items.map((k) => `<img src="${ICON(k)}" alt="">`).join('')}</div>
        ${n ? `<span class="badge">×${n}</span>` : ''}</div>
      <b class="name">${c.title}</b>
      <div class="foot"><span class="hp" title="Can">♥ ${3 + lv}${lv ? `<sup>+${lv}</sup>` : ''}</span><span title="Menzil">⇢ ${dec(c.reach)}</span><span title="Hız">» ${dec(c.speed)}</span><span class="price">◉ ${num(c.cost)}</span></div>
    </div>`;
  }).join('') + `<button class="card ready" id="ready" ${me.ready ? 'disabled' : ''}>${me.ready ? 'BEKLENİYOR…' : 'HAZIR <span>→</span>'}<small>${me.units.length} bölük · ${num(me.units.length * 20)} asker</small></button>`;
  $('prep').classList.toggle('waiting', !!me.ready);
  $('prep-team').innerHTML = m.players.map((p) => {
    const info = p.out ? 'elendi' : p === me ? `${me.units.length} bölük` : p.team === me.team ? `${p.units.length} bölük · eko ${p.eco}` : p.ready ? 'hazır' : 'kuruyor…';
    return `<div class="pl ${p.team ? 'red' : 'blue'} ${p === me ? 'me' : ''} ${p.out ? 'out' : ''}"><i style="background:${p.color}"></i><b>${esc(p.name)}</b><span>${info}</span><em>⚑ ${num(p.hp)}</em></div>`;
  }).join('');
}

function showInfo(c) {
  if (!c) { $('info').innerHTML = '<span class="muted">Bir kartın üstüne gel: malzemesi ve kime üstün olduğu burada görünür.</span>'; return; }
  const strong = EDGE[c.index].filter((x) => x.s > 0).slice(0, 3), weak = EDGE[c.index].filter((x) => x.s < 0).slice(-3).reverse();
  const chip = (x) => `<span class="mini"><img src="${IMG(x.d)}" alt="">${x.d.title}${x.d.detail !== 'Zırhsız' ? ' · ' + x.d.detail : ''}</span>`;
  const mats = MAT.filter(([k]) => c.materials[k]).map(([k, icon, ad]) => `<span class="mat"><img src="${ICON(icon)}" alt="">${c.materials[k]} ${ad}</span>`).join('') || '<span class="muted">eşyasız</span>';
  $('info').innerHTML = `<b>${c.title}</b><span class="muted">${c.detail}</span><span class="sep"></span><span class="lbl">ASKER BAŞI</span>${mats}
    <span class="sep"></span><span class="lbl good">ÜSTÜN</span>${strong.map(chip).join('') || '—'}<span class="sep"></span><span class="lbl bad">ZAYIF</span>${weak.map(chip).join('') || '—'}`;
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
  talim: { run: (c) => buyTalim(m, me, c), back: (c) => refundTalim(m, me, c), cost: (c) => talimCost(me.talim[c]), backCost: (c) => talimCost(me.talim[c]) },
  eko: { run: () => buyEco(m, me), back: () => refundEco(m, me), cost: () => ecoCost(me.eco), backCost: () => ecoCost(me.eco) },
};
const NET = { al: ['al', 'geri'], talim: ['talim', 'talimGeri'], eko: ['eko', 'ekoGeri'] };
function act(kind, arg, el, refund) {
  if (state !== 'prep' || me.ready) return;
  const a = ACT[kind], cost = refund ? null : a.cost(arg);
  const ok = refund ? a.back(arg) : a.run(arg);
  if (!ok) { if (!refund) shake(el); return; }
  if (online) net({ t: NET[kind][refund ? 1 : 0], c: arg, f: arg });
  const sel = el.dataset.up ? `[data-up="${arg}"]` : el.dataset.cls ? `[data-cls="${arg}"]` : '#eco';
  const back = refund ? (a.backCost ? a.backCost(arg) : a.cost(arg)) : cost;
  renderPrep();
  floatAt(document.querySelector(sel), `${refund ? '+' : '−'}${num(back)}`, refund);
}
function prepClick(e, refund) {
  const up = e.target.closest('[data-up]'), card = e.target.closest('[data-cls]');
  if (e.target.closest('#ready')) { if (!refund) beginBattle(); return; }
  if (e.target.closest('#eco')) { act('eko', 0, $('eco'), refund); return; }
  if (up) { act('talim', +up.dataset.up, up, refund); return; }
  if (card) act('al', +card.dataset.cls, card, refund);
}
$('prep').addEventListener('click', (e) => prepClick(e, false));
$('prep').addEventListener('contextmenu', (e) => { e.preventDefault(); prepClick(e, true); });
$('prep').addEventListener('mouseover', (e) => { const card = e.target.closest('[data-cls]'); showInfo(card ? CLASSES[+card.dataset.cls] : null); });

// ---------- seçim ve emir ----------

const mine = (b) => w && w.bowner[b] === myIdx;

function syncSelection() {
  if (!w) return;
  for (const b of [...selected]) if (!w.balive[b]) selected.delete(b);
  view.setSelection(selected);
  let n = 0; const fams = new Set();
  for (const b of selected) { n += w.balive[b]; fams.add(CLASSES[w.bcls[b]].family); }
  $('sel-info').textContent = selected.size
    ? `${selected.size} bölük · ${num(n)} asker` + (fams.size === 1 ? ` · ${FAMILIES[[...fams][0]].name}` : '')
    : 'Seçili bölük yok · emirsiz bölükler kendi savaşır';
}

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
  if (state === 'menu' || state === 'prep') return;
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
  if (['1', '2', '3', '4'].includes(k)) selectWhere((b) => CLASSES[w.bcls[b]].family === Number(k) - 1, e.shiftKey);
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
const ozetYazi = (o) => `${o.takim}v${o.takim} · ⚑ ${num(o.can)} · ${DIFFICULTY[o.zorluk]?.name ?? 'Orta'}`;

function lobiBaglan() {
  if (lobiBag || params.has('cevrimdisi')) return;
  const b = lobiBag = sunucuBaglanti((d) => {
    if (d === 'acik') {
      lobiAcik = true; lobiDeneme = 0; b.gonder({ t: 'lobi' }); lobiYaz();
      const kayit = oturum.al(), kod = adresKodu() ? kodDuzelt(adresKodu()) : null;
      if (kayit?.kod && (!kod || kod === kayit.kod)) { durumYaz('Odaya geri bağlanıyor…'); istek({ t: 'don', kod: kayit.kod, jeton: kayit.jeton }); }
      else if (kod) { durumYaz('Odaya bağlanıyor…'); istek({ t: 'kod', kod }); }
      return;
    }
    const oyunda = online && state !== 'menu', odada = oyunda || !!odaDurum;
    lobiAcik = false; lobiBag = null;
    if (odada) { odaDurum = null; toHome(); toast('Sunucuyla bağlantı koptu.'); }
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
      durumYaz({ 'oda.yok': 'Böyle bir oda yok', 'oda.dolu': 'Oda dolu' }[msg.kod] ?? msg.m);
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
  $('cevrimici-sayi').textContent = lobiAcik ? `● ${lobiListe.cevrimici ?? 0} çevrim içi` : 'YAKINDA';
  $('acik-odalar').hidden = !lobiAcik;
  const l = lobiListe.odalar ?? [], k = $('odalar');
  $('oda-sayi').textContent = l.length ? String(l.length) : '';
  k.innerHTML = '';
  if (!l.length) { k.innerHTML = '<div class="bos">Şu an açık oda yok. Hızlı katıl yeni bir oda kurar.</div>'; return; }
  for (const o of l) {
    const dolu = o.n >= o.max, e = document.createElement('button');
    e.className = 'oda'; e.disabled = dolu;
    e.innerHTML = `<span class="oda-ad"><b></b><small>${ozetYazi(o)} · ${o.n}/${o.max} oyuncu</small></span><em class="oda-durum${o.durum === 'mac' ? ' macta' : ''}">${o.durum === 'mac' ? 'MAÇTA' : 'LOBİDE'}</em><em class="oda-katil">${dolu ? 'DOLU' : 'KATIL →'}</em>`;
    e.querySelector('b').textContent = o.kuran;
    e.onclick = () => { durumYaz('Odaya bağlanıyor…'); istek({ t: 'kod', kod: o.kod }); };
    k.append(e);
  }
}
$('hizli').onclick = () => { if (!lobiAcik) return; durumYaz('Oda aranıyor…'); istek({ t: 'hizli' }); };
$('oda-kur').onclick = () => { if (!lobiAcik) return; durumYaz('Oda kuruluyor…'); istek({ t: 'kur' }); };
$('odaya-katil').onclick = () => { const s = $('kod-satir'); s.hidden = !s.hidden; if (!s.hidden) $('kod').focus(); };
function kodlaKatil() {
  const kod = kodDuzelt($('kod').value);
  if (!kodYeterli(kod)) { durumYaz('Oda kodunu yaz'); $('kod').focus(); return; }
  $('kod').value = kod; durumYaz('Odaya bağlanıyor…'); istek({ t: 'kod', kod });
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
  $('b-goz').textContent = `ODA · ${ozetYazi(d)}`;
  $('b-kod').textContent = d.kod;
  $('b-gorunur').textContent = d.ozel ? 'ÖZEL ODA · yalnız kodla' : 'AÇIK ODA · listede görünür';
  if (!kuran || !d.koltuk.some((k) => k && k.u === tasiSecili)) tasiSecili = null;
  const n = d.koltuk.length / 2;
  $('koltuklar').innerHTML = [0, 1].map((t) => `<div class="takim ${t ? 'red' : 'blue'}"><span class="eyebrow">${TEAMS[t].name.toUpperCase()}</span><div class="sutun" data-t="${t}"></div></div>`).join('');
  d.koltuk.forEach((k, i) => {
    const e = document.createElement('button'); e.type = 'button';
    e.className = 'koltuk ' + (k ? 'dolu' : 'bos') + (k?.u === d.ben ? ' sen' : '') + (k?.koptu ? ' koptu' : '') + (k && k.u === tasiSecili ? ' secili' : '');
    e.innerHTML = k
      ? `<b></b>${k.u === d.kuran ? '<small>kuran</small>' : ''}${k.u === d.ben ? '<small class="sen">sen</small>' : ''}${k.koptu ? '<small class="kop">koptu</small>' : ''}`
      : '<span class="bot-yazi">Bot · boş koltuk</span><span class="otur-yazi">Buraya otur</span>';
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
  $('b-zorluk').innerHTML = Object.entries(DIFFICULTY).map(([key, v]) => `<button data-v="${key}" class="${key === d.zorluk ? 'secili' : ''}" ${kuran ? '' : 'disabled'}>${v.name}</button>`).join('');
  for (const b of $('b-ozel').children) { b.classList.toggle('secili', (b.dataset.v === '1') === d.ozel); b.disabled = !kuran; }
  const insan = d.koltuk.filter(Boolean).length;
  $('b-bilgi').textContent = `${insan} insan · ${d.koltuk.length - insan} bot`;
  $('b-ipucu').textContent = tasiSecili != null ? 'Taşınacak koltuğa tıkla' : kuran ? 'Boş koltuğa tıklayıp geçebilir, oyuncuları sürükleyip taşıyabilirsin.' : 'Boş koltuğa tıklayıp geçebilirsin.';
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
  try { navigator.clipboard.writeText(u).then(() => { b.textContent = 'Link kopyalandı'; setTimeout(() => { b.textContent = 'Linki kopyala'; }, 1600); }, yaz); } catch { yaz(); }
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
  if (running && state !== 'menu') {
    if (state === 'battle' && !online && w.winner >= 0) toFlags();
    else if (state === 'flag' && w.phase === 'done' && !online) roundOver();
    if (w.tick % 20 === 0) syncSelection();
  }
  if (state === 'menu') { view.angle += dt * 0.03; if (w.winner >= 0) menuBattle(); }
  if (state !== 'prep') {
    const b = performance.now();
    view.render(w, running ? Math.min(1, acc / TICK) : 1, now / 1000, dt);
    stats.drawSum += performance.now() - b;
  }
  if (state === 'flag' || state === 'roundEnd') placeFlagLabels();
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
  $('round').textContent = `TUR ${m.round}`;
  $('flags').innerHTML = [0, 1].map((t) => `<div class="side ${t ? 'red' : 'blue'}">${m.players.filter((p) => p.team === t).map((p) =>
    `<span class="chip ${p === me ? 'me' : ''} ${p.out ? 'out' : ''}"><i style="background:${p.color}"></i>${esc(p.name)} <b>⚑ ${num(p.hp)}</b></span>`).join('')}</div>`).join('');
  if (!w || state === 'prep') { $('score').hidden = true; $('zone').textContent = ''; return; }
  $('score').hidden = false;
  $('blue').textContent = num(w.alive[0]); $('red').textContent = num(w.alive[1]);
  const z = $('zone');
  if (state === 'flag') { z.textContent = `Bayrak evresi · ${dec(Math.max(0, FLAG_TIME - w.flagT))} sn`; z.className = 'warn'; }
  else if (w.t < ZONE.wait) { z.textContent = `${fmt(w.t)} · Alan ${fmt(ZONE.wait - w.t)} sonra daralıyor`; z.className = ''; }
  else if (w.zone > 0) { z.textContent = `${fmt(w.t)} · Alan daralıyor · ${Math.round((w.zone / w.radius) * 100)}%`; z.className = 'warn'; }
  else { z.textContent = `${fmt(w.t)} · Alan kapandı`; z.className = 'warn'; }
}

function toast(text, ms = 2500) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- düğmeler ----------

function syncButtons() {
  $('pause').hidden = online; $('speed').hidden = online;
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').title = paused ? 'Devam (P)' : 'Duraklat (P)';
  $('speed').textContent = `${speed}×`;
  for (const b of document.querySelectorAll('[data-size]')) b.classList.toggle('active', Number(b.dataset.size) === secim.takim);
  for (const b of document.querySelectorAll('[data-hp]')) b.classList.toggle('active', Number(b.dataset.hp) === secim.can);
  for (const b of document.querySelectorAll('[data-zor]')) b.classList.toggle('active', b.dataset.zor === secim.zorluk);
  $('menu-home').textContent = online ? 'Odadan çık' : 'Ana menü';
  $('menu-eyebrow').textContent = online ? 'ÇEVRİM İÇİ · MAÇ SÜRÜYOR' : 'OYUN DURDU';
}
function toggleDialog(d) { if (d.open) d.close(); else d.showModal(); }
function openMenu() { if (!online) paused = true; syncButtons(); $('menu-dialog').showModal(); }

$('sizes').innerHTML = TEAM_SIZES.map((n) => `<button data-size="${n}"><b>${n}v${n}</b><small>${n === 1 ? 'teke tek' : `${n - 1} bot yanında`}</small></button>`).join('');
$('hps').innerHTML = FLAG_HP.map((n) => `<button data-hp="${n}"><b>${num(n)}</b><small>${{ 100: 'kısa oyun', 1000: 'orta', 10000: 'uzun', 100000: 'çok uzun' }[n]}</small></button>`).join('');
$('zors').innerHTML = Object.entries(DIFFICULTY).map(([k, v]) => `<button data-zor="${k}"><b>${v.name}</b><small>${{ kolay: 'paranın %70’i', orta: 'paranın %85’i', zor: 'hepsini harcar' }[k]}</small></button>`).join('');
for (const b of document.querySelectorAll('[data-size]')) b.onclick = () => { secim.takim = +b.dataset.size; save('akinvar.takim', secim.takim); syncButtons(); };
for (const b of document.querySelectorAll('[data-hp]')) b.onclick = () => { secim.can = +b.dataset.hp; save('akinvar.bayrak', secim.can); syncButtons(); };
for (const b of document.querySelectorAll('[data-zor]')) b.onclick = () => { secim.zorluk = b.dataset.zor; save('akinvar.zorluk', secim.zorluk); syncButtons(); };
$('ad').value = secim.ad;
$('ad').oninput = () => { secim.ad = $('ad').value.slice(0, 16); save('akinvar.ad', secim.ad); };
$('play').onclick = startSolo;
$('pause').onclick = () => { paused = !paused; syncButtons(); };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; syncButtons(); };
$('stop').onclick = () => order({ type: 'stop' });
$('select-all').onclick = () => w && selectWhere(() => true);
$('help').onclick = () => $('help-dialog').showModal();
$('menu-btn').onclick = () => state !== 'menu' && openMenu();
$('resume').onclick = () => $('menu-dialog').close();
$('menu-dialog').addEventListener('close', () => { paused = false; syncButtons(); });
$('menu-help').onclick = () => $('help-dialog').showModal();
$('menu-home').onclick = () => (online ? odadanCik() : toHome());
$('again').onclick = () => { if (!online) { startSolo(); return; } $('end-dialog').close(); online = false; state = 'over'; if (odaDurum) bekleGoster(); else toHome(); };
$('end-home').onclick = () => (online ? odadanCik() : toHome());
$('end-watch').onclick = () => { $('end-dialog').close(); if (!online) enterPrep(PREP_TIME); };
$('fog').onclick = () => { view.fogOn = !view.fogOn; view.fogFirst = true; $('fog').textContent = `Sis: ${view.fogOn ? 'açık' : 'kapalı'}`; };
$('shadows').onclick = () => { view.setShadows(!view.shadows); $('shadows').textContent = `Gölge: ${view.shadows ? 'açık' : 'kapalı'}`; };
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
window.__akinCmd = {
  startSolo, beginBattle, selectAll: () => selectWhere(() => true), order, flagOrder, view, net,
  get m() { return m; }, get w() { return w; }, get state() { return state; }, get me() { return me; }, get online() { return online; }, get oda() { return odaDurum; },
};

showInfo(null); menuBattle(); syncButtons(); hud(); lobiYaz(); lobiBaglan();
if (params.has('oyna')) startSolo();
requestAnimationFrame(frame);
