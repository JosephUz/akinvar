// Akın Var — tur tabanlı takım savaşı. Hazırlıkta kartlarla bölük al, savaşta yönet, bayrak evresinde rakip bayraklara yüklen.
import { TICK, ZONE, TEAMS, PREP_TIME, FLAG_TIME, FLAG_HP, TEAM_SIZES, TALIM, ECONOMY } from './config.js';
import { step, command, visibleTo, createBattle } from './sim.js';
import { CLASSES, FAMILIES } from './units.js';
import {
  createMatch, startBattle, startFlags, endRound, buyUnit, refundUnit, buyEco, refundEco, buyTalim, refundTalim,
  setReady, ecoCost, talimCost, income,
} from './match.js';
import { View } from './view.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const fmt = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const num = (n) => n.toLocaleString('tr-TR');

const view = new View($('scene'));
view.setShadows(params.get('golge') !== '0');
let m = null, w = null, me = null, myIdx = -1, acc = 0, last = performance.now(), speed = 1, paused = false;
let state = 'menu', selected = new Set(), prepLeft = 0;
let teamSize = load('akinvar.takim', 1), flagHp = load('akinvar.bayrak', 100);
const stats = { fps: 0, simMs: 0, drawMs: 0, frames: 0, simSum: 0, drawSum: 0, since: performance.now() };
window.__akin = stats;

function load(k, d) { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* gizli pencere */ } }

// ---------- akış ----------

// Ana ekranın arkasında iki bot ordusu kendi kendine dövüşür.
function menuBattle() {
  const units = (team) => Array.from({ length: 22 }, (_, k) => CLASSES[(k * 7 + team * 11) % CLASSES.length].index);
  w = createBattle({ seed: 3, players: [0, 1].map((team) => ({ team, human: false, units: units(team) })) });
  view.build(w, { team: 0, colors: [TEAMS[0].color, TEAMS[1].color] });
  view.fogOn = false; view.zoom = w.radius * 0.9; view.resize();
}

function startMatch() {
  m = createMatch({ teamSize, flagHp }); me = m.players[0];
  paused = false; speed = 1; syncButtons();
  document.body.classList.add('playing');
  $('home').hidden = true; $('hud').hidden = false;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  enterPrep();
}

function toHome() {
  state = 'menu'; m = null; document.body.classList.remove('playing');
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('home').hidden = false; $('hud').hidden = true; $('orders').hidden = true; $('prep').hidden = true; $('flag-banner').hidden = true;
  $('flag-labels').innerHTML = '';
  menuBattle();
}

function enterPrep() {
  state = 'prep'; prepLeft = PREP_TIME; $('flag-labels').innerHTML = ''; $('flag-banner').hidden = true; $('orders').hidden = true;
  if (me.out) { beginBattle(); return; } // elenen izler: hazırlık yok
  $('prep').hidden = false; renderPrep(); hud();
}

function beginBattle() {
  setReady(m, me);
  w = startBattle(m); myIdx = m.order.indexOf(me.id);
  view.build(w, { team: me.team, colors: m.order.map((id) => m.players[id].color), selected: TEAMS[me.team].selected });
  view.fogOn = !me.out;
  $('prep').hidden = true; $('orders').hidden = me.out; state = 'battle'; acc = 0;
  selected = new Set(); syncSelection(); focusArmy();
  if (w.winner >= 0) toFlags(); // bir taraf hiç asker almadıysa savaş olmaz
  hud();
}

function toFlags() {
  startFlags(m);
  if (w.phase !== 'flag') { roundOver(); return; }
  state = 'flag'; selected = new Set(); syncSelection();
  view.buildFlags(w.flags, w.flags.map((f) => m.players[f.player].color));
  // Kamera tepeye çıkar: bayraklar ve sağ kalanlar tek bakışta.
  const xs = w.flags.map((f) => f.x), zs = w.flags.map((f) => f.z);
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { xs.push(w.x[i]); zs.push(w.z[i]); }
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  view.target.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
  view.zoom = Math.max(18, Math.min(60, span * 0.6 + 8)); view.resize();
  $('flag-labels').innerHTML = w.flags.map((f, k) => `<div class="flag-label" data-flag="${k}"><b>${m.players[f.player].name}</b><span></span></div>`).join('');
  const winnerMe = w.winner === me.team && !me.out;
  $('flag-banner').hidden = false;
  $('flag-title').textContent = w.winner === me.team ? 'Saha senin. Bayraklara yüklen.' : 'Saha düştü. Bayraklarına koşuyorlar.';
  $('flag-hint').textContent = winnerMe ? 'Askerlerini seç, rakip bayrağa sağ tıkla (seçim yoksa hepsi gider). 10 saniyede gönderilmeyen dağılır.' : 'Her asker bayraktan bir can götürür.';
  $('orders').hidden = !winnerMe;
}

function roundOver() {
  state = 'roundEnd';
  const before = new Map(m.players.map((p) => [p.id, p.hp]));
  endRound(m);
  const lost = m.players.filter((p) => before.get(p.id) !== p.hp).map((p) => `${p.name} −${num(before.get(p.id) - p.hp)}${p.out ? ' (elendi)' : ''}`);
  const wn = m.log.at(-1).winner;
  toast(wn === 2 ? 'Berabere: iki ordu da yok oldu.' : `${TEAMS[wn].name} turu kazandı.${lost.length ? ' ' + lost.join(' · ') : ''}`, 3200);
  if (m.phase === 'over') { setTimeout(finish, 1600); return; }
  if (me.out && !me.toldOut) { me.toldOut = true; setTimeout(showOut, 1600); return; }
  setTimeout(() => { if (state === 'roundEnd') enterPrep(); }, 2600);
}

function finish() {
  state = 'over';
  const won = m.winner === me.team;
  $('end-eyebrow').textContent = won ? `${m.round} TURDA ZAFER` : `${m.round}. TURDA SANCAK DÜŞTÜ`;
  $('end-title').textContent = won ? 'Zafer.' : 'Yenilgi.';
  $('end-copy').textContent = m.players.map((p) => `${p.name} (${TEAMS[p.team].name}): ${num(p.hp)} can, ekonomi ${p.eco}`).join(' · ');
  $('end-watch').hidden = true;
  $('end-dialog').showModal();
}

function showOut() {
  $('end-eyebrow').textContent = 'BAYRAĞIN DÜŞTÜ';
  $('end-title').textContent = 'Elendin.';
  $('end-copy').textContent = 'Takımın savaşmayı sürdürüyor. İstersen izle.';
  $('end-watch').hidden = false;
  $('end-dialog').showModal();
}

function focusArmy() {
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0 && (me.out ? w.team[i] === me.team : w.bowner[w.boluk[i]] === myIdx)) { x += w.x[i]; z += w.z[i]; n++; }
  if (n) view.target.set(x / n, 0, z / n);
  view.zoom = Math.min(40, w.radius * 0.45); view.resize();
}

// ---------- hazırlık ekranı ----------

function renderPrep() {
  $('prep-round').textContent = `TUR ${m.round} · HAZIRLIK`;
  $('prep-gold').textContent = num(me.gold);
  $('prep-income').textContent = `Tur geliri ◉ ${num(income(me))}`;
  const eco = ecoCost(me.eco);
  $('perma').innerHTML = `
    <button class="card perma eco ${me.gold < eco ? 'poor' : ''}" data-eco>
      <span class="fam">EKONOMİ</span><b>Seviye ${me.eco}</b>
      <small>Her tur ◉ ${num(income(me))} → ◉ ${num(income(me) + ECONOMY.levelIncome)}</small><span class="price">◉ ${num(eco)}</span>
      ${me.bought.eco ? `<span class="badge">+${me.bought.eco}</span>` : ''}</button>
    ${FAMILIES.map((f, k) => {
      const lv = me.talim[k], cost = talimCost(lv), max = lv >= TALIM.max;
      return `<button class="card perma ${max || me.gold < cost ? 'poor' : ''}" data-talim="${k}" style="--fam:${f.color}">
        <span class="fam">TALİM · ${f.name.toUpperCase()}</span><b>Seviye ${lv}/${TALIM.max}</b>
        <small>Can ${3 + lv}${max ? '' : ` → ${4 + lv}`}</small><span class="price">${max ? 'EN ÜST' : `◉ ${num(cost)}`}</span>
        ${me.bought.talim[k] ? `<span class="badge">+${me.bought.talim[k]}</span>` : ''}</button>`;
    }).join('')}`;
  const counts = new Map();
  for (const u of me.units) counts.set(u, (counts.get(u) ?? 0) + 1);
  $('cards').innerHTML = CLASSES.map((c) => {
    const n = counts.get(c.index) ?? 0, fam = FAMILIES[c.family];
    return `<button class="card unit ${me.gold < c.cost ? 'poor' : ''} ${n ? 'has' : ''}" data-cls="${c.index}" style="--fam:${fam.color}" title="${c.title} · ${c.detail}">
      <span class="fam">${fam.name.toUpperCase()}</span><b>${c.title}</b><small>${c.detail}</small>
      <span class="stats">Can ${3 + me.talim[c.family]} · Menzil ${c.reach.toFixed(1).replace('.', ',')} · Hız ${c.speed.toFixed(1).replace('.', ',')}</span>
      <span class="price">◉ ${num(c.cost)}</span>${n ? `<span class="badge">×${n}</span>` : ''}</button>`;
  }).join('') + `<button class="card ready" id="ready">HAZIR <span>→</span><small>${me.units.length} bölük · ${num(me.units.length * 20)} asker</small></button>`;
  $('prep-team').innerHTML = m.players.map((p) => {
    const info = p.out ? 'elendi' : p === me ? `${me.units.length} bölük` : p.team === me.team ? `${p.units.length} bölük · ekonomi ${p.eco}` : 'hazır';
    return `<div class="pl ${p.team ? 'red' : 'blue'} ${p === me ? 'me' : ''} ${p.out ? 'out' : ''}"><i style="background:${p.color}"></i><b>${p.name}</b><span>${info}</span><em>⚑ ${num(p.hp)}</em></div>`;
  }).join('');
}

function floatAt(el, text, good) {
  const r = el.getBoundingClientRect(), f = document.createElement('div');
  f.className = 'float' + (good ? ' good' : ''); f.textContent = text;
  f.style.left = r.left + r.width / 2 + 'px'; f.style.top = r.top + 14 + 'px';
  $('floats').append(f); setTimeout(() => f.remove(), 1100);
}

const cardSel = (el) => el.dataset.cls ? `[data-cls="${el.dataset.cls}"]` : el.dataset.talim ? `[data-talim="${el.dataset.talim}"]` : '[data-eco]';
$('prep').addEventListener('click', (e) => {
  const el = e.target.closest('button'); if (!el || state !== 'prep') return;
  if (el.id === 'ready') { beginBattle(); return; }
  let ok = false, cost = 0;
  if (el.dataset.cls) { cost = CLASSES[+el.dataset.cls].cost; ok = buyUnit(m, me, +el.dataset.cls); }
  else if ('eco' in el.dataset) { cost = ecoCost(me.eco); ok = buyEco(m, me); }
  else if (el.dataset.talim) { cost = talimCost(me.talim[+el.dataset.talim]); ok = buyTalim(m, me, +el.dataset.talim); }
  if (!ok) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
  const sel = cardSel(el); renderPrep();
  floatAt(document.querySelector(sel), `−${num(cost)}`);
});
$('prep').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const el = e.target.closest('button'); if (!el || state !== 'prep') return;
  let ok = false;
  if (el.dataset.cls) ok = refundUnit(m, me, +el.dataset.cls);
  else if ('eco' in el.dataset) ok = refundEco(m, me);
  else if (el.dataset.talim) ok = refundTalim(m, me, +el.dataset.talim);
  if (!ok) return;
  const cost = el.dataset.cls ? CLASSES[+el.dataset.cls].cost : 'eco' in el.dataset ? ecoCost(me.eco) : talimCost(me.talim[+el.dataset.talim]);
  const sel = cardSel(el); renderPrep();
  floatAt(document.querySelector(sel), `+${num(cost)}`, true);
});

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
    : 'Seçili bölük yok';
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

function order(cmd) {
  if (state !== 'battle' || !selected.size) return;
  command(w, me.team, [...selected], cmd);
}

function flagOrder(p) {
  let best = -1, bestD = 36;
  w.flags.forEach((f, k) => { const d = (f.x - p.x) ** 2 + (f.z - p.z) ** 2; if (f.hp > 0 && d < bestD) { bestD = d; best = k; } });
  if (best < 0) return;
  const list = selected.size ? [...selected] : [...Array(w.B).keys()].filter(mine);
  command(w, me.team, list, { type: 'flag', flag: best });
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
  if (e.target.closest?.('dialog')) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (state === 'menu') return;
    if (selected.size) { selected = new Set(); syncSelection(); } else openMenu();
    return;
  }
  if (state === 'menu') return;
  if (state === 'prep') { if (e.key === 'Enter') beginBattle(); return; }
  keys.add(k);
  if (k === 'q') view.angle += Math.PI / 8;
  if (k === 'e') view.angle -= Math.PI / 8;
  if (k === 'f') focusArmy();
  if (k === 'p') { paused = !paused; syncButtons(); }
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

// ---------- döngü ----------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state !== 'prep') pan(dt);
  const running = (state === 'menu' && w.winner < 0) || ((state === 'battle' || state === 'flag') && !paused);
  if (state === 'prep' && !paused) {
    prepLeft -= dt;
    if (prepLeft <= 0) beginBattle();
  }
  if (running) {
    acc += dt * (state === 'menu' ? 1 : speed);
    const a = performance.now();
    let n = 0;
    while (acc >= TICK && n++ < 8) { step(w); acc -= TICK; }
    if (n >= 8) acc = 0;
    stats.simSum += performance.now() - a;
    if (state === 'battle' && w.winner >= 0) toFlags();
    else if (state === 'flag' && w.phase === 'done') { $('flag-banner').hidden = true; $('orders').hidden = true; roundOver(); }
    if (w.tick % 20 === 0 && state !== 'menu') syncSelection();
  }
  if (state === 'menu') { view.angle += dt * 0.03; if (w.winner >= 0) menuBattle(); }
  if (state !== 'prep') {
    const b = performance.now();
    view.render(w, running ? acc / TICK : 1, now / 1000, dt);
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
    const f = w.flags[+el.dataset.flag], s = view.toScreen(f.x, f.z, 6.2);
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
  if (!m) return;
  if (state === 'prep') { $('prep-time').textContent = fmt(prepLeft); $('prep-time').classList.toggle('warn', prepLeft < 10); }
  $('round').textContent = `TUR ${m.round}`;
  $('flags').innerHTML = [0, 1].map((t) => `<div class="side ${t ? 'red' : 'blue'}">${m.players.filter((p) => p.team === t).map((p) =>
    `<span class="chip ${p === me ? 'me' : ''} ${p.out ? 'out' : ''}"><i style="background:${p.color}"></i>${p.name} <b>⚑ ${num(p.hp)}</b></span>`).join('')}</div>`).join('');
  if (!w || state === 'prep') { $('score').hidden = true; $('zone').textContent = ''; return; }
  $('score').hidden = false;
  $('blue').textContent = num(w.alive[0]); $('red').textContent = num(w.alive[1]);
  const z = $('zone');
  if (state === 'flag') { z.textContent = `Bayrak evresi · ${Math.max(0, FLAG_TIME - w.flagT).toFixed(1).replace('.', ',')} sn`; z.className = 'warn'; }
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
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').title = paused ? 'Devam (P)' : 'Duraklat (P)';
  $('speed').textContent = `${speed}×`;
  for (const b of document.querySelectorAll('[data-size]')) b.classList.toggle('active', Number(b.dataset.size) === teamSize);
  for (const b of document.querySelectorAll('[data-hp]')) b.classList.toggle('active', Number(b.dataset.hp) === flagHp);
}
function toggleDialog(d) { if (d.open) d.close(); else d.showModal(); }
function openMenu() { paused = true; syncButtons(); $('menu-dialog').showModal(); }

$('sizes').innerHTML = TEAM_SIZES.map((n) => `<button data-size="${n}"><b>${n}v${n}</b><small>${n === 1 ? 'teke tek' : `${n - 1} bot yanında`}</small></button>`).join('');
$('hps').innerHTML = FLAG_HP.map((n) => `<button data-hp="${n}"><b>${num(n)}</b><small>${{ 100: 'kısa oyun', 1000: 'orta', 10000: 'uzun', 100000: 'çok uzun' }[n]}</small></button>`).join('');
for (const b of document.querySelectorAll('[data-size]')) b.onclick = () => { teamSize = +b.dataset.size; save('akinvar.takim', teamSize); syncButtons(); };
for (const b of document.querySelectorAll('[data-hp]')) b.onclick = () => { flagHp = +b.dataset.hp; save('akinvar.bayrak', flagHp); syncButtons(); };
$('play').onclick = startMatch;
$('pause').onclick = () => { paused = !paused; syncButtons(); };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; syncButtons(); };
$('stop').onclick = () => order({ type: 'stop' });
$('select-all').onclick = () => w && selectWhere(() => true);
$('help').onclick = () => $('help-dialog').showModal();
$('menu-btn').onclick = () => state !== 'menu' && openMenu();
$('resume').onclick = () => $('menu-dialog').close();
$('menu-dialog').addEventListener('close', () => { paused = false; syncButtons(); });
$('menu-help').onclick = () => $('help-dialog').showModal();
$('menu-home').onclick = toHome;
$('again').onclick = startMatch;
$('end-home').onclick = toHome;
$('end-watch').onclick = () => { $('end-dialog').close(); enterPrep(); };
$('fog').onclick = () => { view.fogOn = !view.fogOn; view.fogFirst = true; $('fog').textContent = `Sis: ${view.fogOn ? 'açık' : 'kapalı'}`; };
$('shadows').onclick = () => { view.setShadows(!view.shadows); $('shadows').textContent = `Gölge: ${view.shadows ? 'açık' : 'kapalı'}`; };
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
window.__akinCmd = {
  startMatch, beginBattle, selectAll: () => selectWhere(() => true), order, flagOrder, view,
  get m() { return m; }, get w() { return w; }, get state() { return state; }, get me() { return me; },
};

menuBattle(); syncButtons(); hud();
if (params.has('oyna')) startMatch();
requestAnimationFrame(frame);
