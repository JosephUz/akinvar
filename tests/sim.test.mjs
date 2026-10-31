import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, command, visibleTo, PER_BOLUK } from '../src/sim.js';
import { ZONE } from '../src/config.js';

const run = (opts, until = 600) => { const w = createBattle(opts); while (w.winner < 0 && w.t < until) step(w); return w; };
const bots = [false, false];

test('iki ordu eşit sayıda, bölükler 20 asker', () => {
  const w = createBattle({ soldiers: 2000 });
  assert.equal(w.N % PER_BOLUK, 0);
  assert.deepEqual(w.alive, [1000, 1000]);
});

test('ordular arenanın içinde, karşılıklı ve birbirini görmeden başlar', () => {
  const w = createBattle({ soldiers: 2000 });
  for (let i = 0; i < w.N; i++) assert.ok(Math.hypot(w.x[i], w.z[i]) < w.radius, 'asker arenanın içinde');
  for (let b = 0; b < w.B; b++) {
    const enemy = 1 - w.bteam[b];
    assert.equal(visibleTo(w, enemy, w.cx[b], w.cz[b]), false, 'başta düşman görünmez');
    assert.equal(visibleTo(w, w.bteam[b], w.cx[b], w.cz[b]), true, 'kendi bölüğü görünür');
  }
});

test('iki bot: savaş biter ve kazanan çıkar', () => {
  const w = run({ soldiers: 400, seed: 3, human: bots });
  assert.ok(w.winner >= 0 && w.t < 600);
});

test('oyuncu hiç emir vermese de bot gelir, savaş biter', () => {
  const w = run({ soldiers: 400, seed: 4 });
  assert.ok(w.winner >= 0, 'bot sisin içinde oyuncuyu bulmalı ya da alan bitirmeli');
});

test('aynı tohum ve aynı emirler aynı savaşı verir', () => {
  const play = () => {
    const w = createBattle({ soldiers: 400, seed: 11 });
    const mine = [...Array(w.B).keys()].filter((b) => w.bteam[b] === 0);
    for (let k = 0; k < 4000 && w.winner < 0; k++) {
      if (k === 40) command(w, 0, mine, { type: 'move', x: 0, z: 0 });
      step(w);
    }
    return w;
  };
  const a = play(), b = play();
  assert.equal(a.t, b.t); assert.deepEqual(a.alive, b.alive);
  assert.deepEqual([...a.x.slice(0, 50)], [...b.x.slice(0, 50)]);
});

test('yürü emri bölüğü hedefe götürür', () => {
  const w = createBattle({ soldiers: 200, human: [true, true] });
  const b = 0;
  step(w);
  command(w, 0, [b], { type: 'move', x: -10, z: 15 });
  for (let k = 0; k < 1000; k++) step(w); // 66 birim, yürüyüş 2,1 birim/sn
  assert.ok(Math.hypot(w.cx[b] + 10, w.cz[b] - 15) < 2.5, `bölük hedefte olmalı: ${w.cx[b]}, ${w.cz[b]}`);
});

test('alan daralır, dışarıda kalan can kaybeder', () => {
  const w = createBattle({ soldiers: 200, human: [true, true] });
  while (w.t < ZONE.wait + ZONE.shrink * 0.9) step(w);
  assert.ok(w.zone < w.radius * 0.15);
  assert.ok(w.alive[0] < 100 && w.alive[1] < 100, 'kenarda bekleyen ordular erimeli');
});

test('kalan sayısı canı 0 olmayan askerlerle tutarlı', () => {
  const w = run({ soldiers: 400, seed: 5, human: bots });
  for (const team of [0, 1]) {
    let n = 0; for (let i = 0; i < w.N; i++) if (w.team[i] === team && w.hp[i] > 0) n++;
    assert.equal(n, w.alive[team]);
  }
});
