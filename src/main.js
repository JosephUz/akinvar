// Akın Var — Faz 0: başarım denemesi. İki ordu karşı karşıya, savaşı izle, asker sayısını değiştir.
import { TICK, DEFAULT_SOLDIERS, MAX_SOLDIERS, TEAMS } from './config.js';
import { createBattle, step } from './sim.js';
import { View } from './view.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const soldiers = Math.min(MAX_SOLDIERS, Number(params.get('asker')) || DEFAULT_SOLDIERS);
const seed = Number(params.get('tohum')) || 1;

const view = new View($('scene'));
view.setShadows(params.get('golge') !== '0');
let w, acc = 0, last = performance.now(), speed = 1, paused = false;
const stats = { fps: 0, simMs: 0, drawMs: 0, frames: 0, simSum: 0, drawSum: 0, since: performance.now() };
window.__akin = stats;

function start() {
  w = createBattle({ soldiers, seed });
  view.build(w); acc = 0;
  stats.soldiers = w.N;
  for (const b of document.querySelectorAll('[data-asker]')) b.classList.toggle('active', Number(b.dataset.asker) === soldiers);
}

// Kamera: WASD / oklar kaydırır, sol tuşla sürükleme kaydırır, tekerlek yakınlaşır, Q / E döndürür, F ortalar.
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest?.('dialog')) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'q') view.angle += Math.PI / 8;
  if (k === 'e') view.angle -= Math.PI / 8;
  if (k === 'f') view.target.set(0, 0, 0);
  if (k === ' ') { paused = !paused; e.preventDefault(); syncButtons(); }
  if (e.key === 'F1') { e.preventDefault(); $('help-dialog').showModal(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
const scene = $('scene');
scene.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.min(w.radius * 1.3, Math.max(6, view.zoom * Math.exp(e.deltaY * 0.0012)));
  view.resize();
}, { passive: false });
let drag = null;
scene.addEventListener('pointerdown', (e) => { if (e.button === 0) { drag = { x: e.clientX, y: e.clientY }; scene.setPointerCapture(e.pointerId); } });
scene.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const a = view.groundAt(drag.x, drag.y), b = view.groundAt(e.clientX, e.clientY);
  if (a && b) view.target.sub(b.sub(a));
  drag = { x: e.clientX, y: e.clientY };
});
scene.addEventListener('pointerup', () => { drag = null; });
scene.addEventListener('contextmenu', (e) => e.preventDefault());

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

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  pan(dt);
  if (!paused && w.winner < 0) {
    acc += dt * speed;
    const a = performance.now();
    let n = 0;
    while (acc >= TICK && n++ < 8) { step(w); acc -= TICK; }
    if (n >= 8) acc = 0;
    stats.simSum += performance.now() - a;
  }
  const b = performance.now();
  view.render(w, paused || w.winner >= 0 ? 1 : acc / TICK, now / 1000);
  stats.drawSum += performance.now() - b;
  stats.frames++;
  if (now - stats.since > 1000) {
    const s = (now - stats.since) / 1000;
    stats.fps = Math.round(stats.frames / s);
    stats.simMs = stats.simSum / stats.frames; stats.drawMs = stats.drawSum / stats.frames;
    stats.frames = stats.simSum = stats.drawSum = 0; stats.since = now;
    hud();
  }
  requestAnimationFrame(frame);
}

function hud() {
  stats.alive = [...w.alive]; stats.t = w.t; stats.winner = w.winner;
  $('fps').textContent = stats.fps;
  $('sim-ms').textContent = stats.simMs.toFixed(1);
  $('draw-ms').textContent = stats.drawMs.toFixed(1);
  $('count').textContent = w.N.toLocaleString('tr-TR');
  $('blue').textContent = w.alive[0].toLocaleString('tr-TR');
  $('red').textContent = w.alive[1].toLocaleString('tr-TR');
  $('clock').textContent = `${Math.floor(w.t / 60)}:${String(Math.floor(w.t % 60)).padStart(2, '0')}`;
  $('result').textContent = w.winner < 0 ? '' : w.winner === 2 ? 'Berabere' : `${TEAMS[w.winner].name} kazandı`;
}

function syncButtons() {
  $('pause').textContent = paused ? '▶ Devam' : 'Ⅱ Duraklat';
  $('speed').textContent = `${speed}×`;
  $('shadows').textContent = `Gölge: ${view.shadows ? 'açık' : 'kapalı'}`;
}
$('pause').onclick = () => { paused = !paused; syncButtons(); };
$('speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; syncButtons(); };
$('restart').onclick = start;
$('shadows').onclick = () => { view.setShadows(!view.shadows); syncButtons(); };
for (const b of document.querySelectorAll('[data-asker]')) b.onclick = () => {
  const u = new URL(location.href); u.searchParams.set('asker', b.dataset.asker); location.href = u.href;
};
$('help').onclick = () => $('help-dialog').showModal();
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();

start(); syncButtons(); hud();
requestAnimationFrame(frame);
