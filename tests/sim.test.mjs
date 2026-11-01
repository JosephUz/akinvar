import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, command, visibleTo, PER_BOLUK } from '../src/sim.js';
import { CLASSES, CLASS_BY_KEY, hitChance } from '../src/units.js';
import { ZONE } from '../src/config.js';

const cls = (key) => CLASS_BY_KEY[key].index;
const army = (team, n, key = 'sp:ir-sh:ir-fo-no', human = false, talim) => ({ team, human, units: Array(n).fill(cls(key)), talim });
const run = (players, seed = 1, until = 600) => { const w = createBattle({ players, seed }); while (w.winner < 0 && w.t < until) step(w); return w; };

test('throneofcurse sınıfları: 39 sınıf, üstünlük tablosu, arkadan vuruş', () => {
  assert.equal(CLASSES.length, 39);
  // atlı okçuya üstün
  assert.ok(hitChance(cls('sw:ir-sh:ir-ho-le'), cls('bo-no-fo-no'), false) > hitChance(cls('bo-no-fo-no'), cls('sw:ir-sh:ir-ho-le'), false));
  // arkadan vuruş +20
  const a = cls('sw:ir-no-fo-no');
  assert.equal(Math.round((hitChance(a, a, true) - hitChance(a, a, false)) * 100), 20);
});

test('bölükler 20 asker, can 3 + o sınıfın geliştirmesi', () => {
  const talim = new Array(CLASSES.length).fill(0); talim[cls('sw:ir-no-fo-no')] = 2;
  const w = createBattle({ players: [army(0, 3, 'sw:ir-no-fo-no', true, talim), army(1, 2)] });
  assert.equal(w.N, 5 * PER_BOLUK);
  assert.deepEqual(w.alive, [60, 40]);
  assert.equal(w.hp[0], 5);
  assert.equal(w.hp[w.N - 1], 3);
});

test('ordular arenanın içinde ve birbirini görmeden başlar', () => {
  const w = createBattle({ players: [army(0, 30), army(1, 30)] });
  for (let i = 0; i < w.N; i++) assert.ok(Math.hypot(w.x[i], w.z[i]) < w.radius);
  for (let b = 0; b < w.B; b++) assert.equal(visibleTo(w, 1 - w.bteam[b], w.cx[b], w.cz[b]), false);
  // 5v5'te takım yanlara geniş açılır; düz dizilim uçlardan çemberin dışına taşıyordu
  const w5 = createBattle({ players: Array.from({ length: 10 }, (_, p) => army(p % 2, 12)) });
  for (let i = 0; i < w5.N; i++) assert.ok(Math.hypot(w5.x[i], w5.z[i]) < w5.radius - 5);
  for (let b = 0; b < w5.B; b++) assert.equal(visibleTo(w5, 1 - w5.bteam[b], w5.cx[b], w5.cz[b]), false);
});

test('iki bot: savaş biter ve kazanan çıkar', () => {
  const w = run([army(0, 10), army(1, 10, 'sw:ir-sh:ir-fo-le')], 3);
  assert.ok(w.winner >= 0 && w.t < 600);
});

test('okçular uzaktan ok atar ve öldürür', () => {
  const w = createBattle({ players: [army(0, 6, 'lb-no-fo-no'), army(1, 3, 'ua-no-fo-no')], seed: 2 });
  let shot = 0;
  while (w.winner < 0 && w.t < 300) { step(w); shot = Math.max(shot, w.arrows.length); }
  assert.ok(shot > 0, 'havada ok olmalı');
  assert.equal(w.winner, 0);
});

test('atlı yayadan hızlı yürür', () => {
  const w = createBattle({ players: [{ team: 0, human: true, units: [cls('sw:ir-sh:ir-ho-le'), cls('sw:ir-sh:ir-fo-le')] }, army(1, 1, 'sp:ir-sh:ir-fo-no', true)] });
  step(w);
  const start = [w.cx[0], w.cx[1]];
  command(w, 0, [0], { type: 'move', x: 0, z: w.cz[0] });
  command(w, 0, [1], { type: 'move', x: 0, z: w.cz[1] });
  for (let k = 0; k < 200; k++) step(w);
  const atli = w.bcls[0] === cls('sw:ir-sh:ir-ho-le') ? 0 : 1, yaya = 1 - atli;
  assert.ok(Math.abs(w.cx[atli] - start[atli]) > Math.abs(w.cx[yaya] - start[yaya]) * 1.4);
});

test('aynı tohum ve aynı emirler aynı savaşı verir', () => {
  const play = () => {
    const w = createBattle({ players: [army(0, 8, 'sp:ir-sh:ir-fo-no', true), army(1, 8, 'bo-no-fo-no')], seed: 11 });
    const mine = [...Array(w.B).keys()].filter((b) => w.bteam[b] === 0);
    for (let k = 0; k < 4000 && w.winner < 0; k++) { if (k === 40) command(w, 0, mine, { type: 'move', x: 0, z: 0 }); step(w); }
    return w;
  };
  const a = play(), b = play();
  assert.equal(a.t, b.t); assert.deepEqual(a.alive, b.alive);
  assert.deepEqual([...a.x.slice(0, 50)], [...b.x.slice(0, 50)]);
});

test('yürü emri bölüğü hedefe götürür', () => {
  const w = createBattle({ players: [army(0, 5, undefined, true), army(1, 5, undefined, true)] });
  step(w);
  // öbür bölükler yerinde beklesin (emirsiz bölük bot gibi ilerler)
  for (const t of [0, 1]) command(w, t, [...Array(w.B).keys()].filter((b) => w.bteam[b] === t && b !== 0), { type: 'stop' });
  command(w, 0, [0], { type: 'move', x: -10, z: 15 });
  for (let k = 0; k < 1200; k++) step(w);
  assert.ok(Math.hypot(w.cx[0] + 10, w.cz[0] - 15) < 2.5, `bölük hedefte olmalı: ${w.cx[0]}, ${w.cz[0]}`);
});

test('alan daralır, dışarıda kalan can kaybeder', () => {
  const w = createBattle({ players: [army(0, 5, undefined, true), army(1, 5, undefined, true)] });
  while (w.t < ZONE.wait + ZONE.shrink * 0.9) step(w);
  assert.ok(w.zone < w.radius * 0.15);
  assert.ok(w.alive[0] < 100 && w.alive[1] < 100);
});

test('kalan sayısı canı 0 olmayan askerlerle tutarlı', () => {
  const w = run([army(0, 10), army(1, 10, 'tb-no-ho-le')], 5);
  for (const team of [0, 1]) {
    let n = 0; for (let i = 0; i < w.N; i++) if (w.team[i] === team && w.hp[i] > 0) n++;
    assert.equal(n, w.alive[team]);
  }
});
