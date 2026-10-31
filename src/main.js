// Akın Var — Faz 1: tek savaş. Sen Mavi'sin, karşında bot. Sis içinde düşmanı bul, alan daralmadan yen.
import { TICK, KINDS, SIZES, DEFAULT_SOLDIERS, MAX_SOLDIERS, ZONE } from './config.js';
import { createBattle, step, command, visibleTo } from './sim.js';
import { View } from './view.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ME = 0;
let soldiers = Math.min(MAX_SOLDIERS, Number(params.get('asker')) || load('akinvar.asker', DEFAULT_SOLDIERS));
const seedParam = Number(params.get('tohum')) || 0;

const view = new View($('scene'));
view.setShadows(params.get('golge') !== '0');
let w, acc = 0, last = performance.now(), speed = 1, paused = false, state = 'menu', selected = new Set();
const stats = { fps: 0, simMs: 0, drawMs: 0, frames: 0, simSum: 0, drawSum: 0, since: performance.now() };
window.__akin = stats;

function load(k, d) { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* gizli pencere */ } }

// ---------- akış ----------

function newBattle(play) {
  w = createBattle({ soldiers, seed: seedParam || (play ? (Math.random() * 1e9) | 0 : 1) });
  view.build(w, ME); acc = 0; selected = new Set(); syncSelection();
  view.fogOn = play; // ana ekranda iki ordu da görünür
  stats.soldiers = w.N;
  if (play) focusArmy();
  else { view.zoom = w.radius * 0.95; view.resize(); }
}

function startGame() {
  newBattle(true); state = 'battle'; paused = false; speed = 1;
  document.body.classList.add('playing');
  $('home').hidden = true; $('hud').hidden = false; $('orders').hidden = false;
  $('end-dialog').open && $('end-dialog').close();
  syncButtons(); hud();
}

function toHome() {
  state = 'menu'; document.body.classList.remove('playing');
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('home').hidden = false; $('hud').hidden = true; $('orders').hidden = true;
  newBattle(false);
}

function finish() {
  state = 'end';
  const won = w.winner === ME, draw = w.winner === 2;
  $('end-eyebrow').textContent = draw ? 'ALAN İKİ ORDUYU DA YUTTU' : won ? 'SAHA SENİN' : 'SANCAĞIN DÜŞTÜ';
  $('end-title').textContent = draw ? 'Berabere.' : won ? 'Zafer.' : 'Yenilgi.';
  const m = Math.floor(w.t / 60), s = String(Math.floor(w.t % 60)).padStart(2, '0');
  $('end-copy').textContent = `${m}:${s} sürdü. Mavi'den ${w.alive[0].toLocaleString('tr-TR')}, Kırmızı'dan ${w.alive[1].toLocaleString('tr-TR')} asker ayakta.`;
  $('end-dialog').showModal();
}

function focusArmy() {
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < w.N; i++) if (w.team[i] === ME && w.hp[i] > 0) { x += w.x[i]; z += w.z[i]; n++; }
  if (n) view.target.set(x / n, 0, z / n);
  view.zoom = Math.min(45, w.radius * 0.45); view.resize();
}

// ---------- seçim ve emir ----------

function syncSelection() {
  for (const b of [...selected]) if (!w.balive[b]) selected.delete(b);
  view.setSelection(selected);
  let n = 0; const kinds = [0, 0];
  for (const b of selected) { n += w.balive[b]; kinds[w.bkind[b]]++; }
  $('sel-info').textContent = selected.size
    ? `${selected.size} bölük · ${n.toLocaleString('tr-TR')} asker` + (kinds[0] && kinds[1] ? '' : ` · ${KINDS[kinds[0] ? 0 : 1]}`)
    : 'Seçili bölük yok';
}

// Bölük merkezleri (canlı askerlerin ortası) — seçim için anlık.
function centers() {
  const cx = new Float32Array(w.B), cz = new Float32Array(w.B), n = new Int32Array(w.B);
  for (let i = 0; i < w.N; i++) if (w.hp[i] > 0) { const b = w.boluk[i]; cx[b] += w.x[i]; cz[b] += w.z[i]; n[b]++; }
  for (let b = 0; b < w.B; b++) if (n[b]) { cx[b] /= n[b]; cz[b] /= n[b]; }
  return { cx, cz, n };
}

// Yerdeki noktaya en yakın asker (yalnız görünenler).
function soldierAt(p, team, range = 1.6) {
  let best = -1, bestD = range * range;
  for (let i = 0; i < w.N; i++) {
    if (w.hp[i] <= 0 || (team !== undefined && w.team[i] !== team)) continue;
    if (w.team[i] !== ME && !visibleTo(w, ME, w.x[i], w.z[i])) continue;
    const d = (w.x[i] - p.x) ** 2 + (w.z[i] - p.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function selectWhere(pred, add) {
  if (!add) selected = new Set();
  const c = centers();
  for (let b = 0; b < w.B; b++) if (w.bteam[b] === ME && c.n[b] && pred(b, c)) selected.add(b);
  syncSelection();
}

function order(cmd) {
  if (!selected.size || state !== 'battle') return;
  command(w, ME, [...selected], cmd);
}

const scene = $('scene'), box = $('selbox');
let press = null, panDrag = null, lastClick = { t: 0, b: -1 };
scene.addEventListener('pointerdown', (e) => {
  if (state === 'menu') return;
  scene.setPointerCapture(e.pointerId);
  if (e.button === 1) { panDrag = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
  if (e.button === 0) press = { x: e.clientX, y: e.clientY, box: false };
  if (e.button === 2 && state === 'battle') {
    const p = view.groundAt(e.clientX, e.clientY); if (!p) return;
    const enemy = soldierAt(p, 1 - ME, 1.8);
    if (enemy >= 0) { order({ type: 'attack', target: w.boluk[enemy] }); view.showMarker(w.x[enemy], w.z[enemy], true); }
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
  if (press.box) {
    const l = Math.min(press.x, e.clientX), r = Math.max(press.x, e.clientX), t = Math.min(press.y, e.clientY), btm = Math.max(press.y, e.clientY);
    selectWhere((b, c) => { const s = view.toScreen(c.cx[b], c.cz[b]); return s.x >= l && s.x <= r && s.y >= t && s.y <= btm; }, add);
  } else {
    const p = view.groundAt(e.clientX, e.clientY), i = p ? soldierAt(p, ME) : -1;
    const now = performance.now();
    if (i < 0) { if (!add) { selected = new Set(); syncSelection(); } }
    else {
      const b = w.boluk[i];
      if (now - lastClick.t < 350 && lastClick.b === b) {
        // Çift tık: ekrandaki aynı türden bölüklerin hepsi.
        const kind = w.bkind[b];
        selectWhere((o, c) => w.bkind[o] === kind && view.toScreen(c.cx[o], c.cz[o]).on, add);
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
    if (state === 'battle') { if (selected.size) { selected = new Set(); syncSelection(); } else openMenu(); }
    return;
  }
  if (state === 'menu') return;
  keys.add(k);
  if (k === 'q') view.angle += Math.PI / 8;
  if (k === 'e') view.angle -= Math.PI / 8;
  if (k === 'f') focusArmy();
  if (k === 'p') { paused = !paused; syncButtons(); }
  if (state !== 'battle') return;
  if (e.key === ' ') { e.preventDefault(); order({ type: 'stop' }); }
  if (k === '1' || k === '2') selectWhere((b) => w.bkind[b] === Number(k) - 1, e.shiftKey);
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
  pan(dt);
  const running = state === 'battle' && !paused && w.winner < 0;
  if (running) {
    acc += dt * speed;
    const a = performance.now();
    let n = 0;
    while (acc >= TICK && n++ < 8) { step(w); acc -= TICK; }
    if (n >= 8) acc = 0;
    stats.simSum += performance.now() - a;
    if (w.winner >= 0) finish();
    if (w.tick % 20 === 0) syncSelection();
  }
  if (state === 'menu') view.angle += dt * 0.03;
  const b = performance.now();
  view.render(w, running ? acc / TICK : 1, now / 1000, dt);
  stats.drawSum += performance.now() - b;
  stats.frames++;
  if (now - stats.since > 250) hud(now);
  requestAnimationFrame(frame);
}

function hud(now = performance.now()) {
  if (now - stats.since > 1000) {
    const s = (now - stats.since) / 1000;
    stats.fps = Math.round(stats.frames / s);
    stats.simMs = stats.simSum / stats.frames; stats.drawMs = stats.drawSum / stats.frames;
    stats.frames = stats.simSum = stats.drawSum = 0; stats.since = now;
    $('fps').textContent = stats.fps; $('sim-ms').textContent = stats.simMs.toFixed(1); $('draw-ms').textContent = stats.drawMs.toFixed(1);
  }
  stats.alive = [...w.alive]; stats.t = w.t; stats.winner = w.winner; stats.zone = w.zone;
  $('blue').textContent = w.alive[0].toLocaleString('tr-TR');
  $('red').textContent = w.alive[1].toLocaleString('tr-TR');
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const z = $('zone');
  if (w.t < ZONE.wait) { z.textContent = `Alan ${fmt(ZONE.wait - w.t)} sonra daralıyor`; z.className = ''; }
  else if (w.zone > 0) { z.textContent = `Alan daralıyor · ${Math.round((w.zone / w.radius) * 100)}%`; z.className = 'warn'; }
  else { z.textContent = 'Alan kapandı'; z.className = 'warn'; }
  $('clock').textContent = fmt(w.t);
}

// ---------- düğmeler ----------

function syncButtons() {
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').title = paused ? 'Devam (P)' : 'Duraklat (P)';
  $('speed').textContent = `${speed}×`;
  for (const b of document.querySelectorAll('[data-size]')) b.classList.toggle('active', Number(b.dataset.size) === soldiers);
}
function toggleDialog(d) { if (d.open) d.close(); else d.showModal(); }
function openMenu() { paused = true; syncButtons(); $('menu-dialog').showModal(); }

$('sizes').innerHTML = SIZES.map((s) => `<button data-size="${s.soldiers}"><b>${s.name}</b><small>${s.soldiers.toLocaleString('tr-TR')} asker</small></button>`).join('');
for (const b of document.querySelectorAll('[data-size]')) b.onclick = () => {
  soldiers = Number(b.dataset.size); save('akinvar.asker', soldiers); syncButtons(); newBattle(false);
};
$('play').onclick = startGame;
$('pause').onclick = () => { paused = !paused; syncButtons(); };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; syncButtons(); };
$('stop').onclick = () => order({ type: 'stop' });
$('select-all').onclick = () => selectWhere(() => true);
$('help').onclick = () => $('help-dialog').showModal();
$('menu-btn').onclick = openMenu;
$('resume').onclick = () => { $('menu-dialog').close(); };
$('menu-dialog').addEventListener('close', () => { paused = false; syncButtons(); });
$('menu-help').onclick = () => $('help-dialog').showModal();
$('menu-home').onclick = toHome;
$('again').onclick = startGame;
$('end-home').onclick = toHome;
$('end-watch').onclick = () => $('end-dialog').close();
$('fog').onclick = () => { view.fogOn = !view.fogOn; view.fogFirst = true; $('fog').textContent = `Sis: ${view.fogOn ? 'açık' : 'kapalı'}`; };
$('shadows').onclick = () => { view.setShadows(!view.shadows); $('shadows').textContent = `Gölge: ${view.shadows ? 'açık' : 'kapalı'}`; };
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();
window.__akinCmd = { startGame, selectAll: () => selectWhere(() => true), order, get w() { return w; }, view };

newBattle(false); syncButtons(); hud();
if (params.has('oyna')) startGame();
requestAnimationFrame(frame);
