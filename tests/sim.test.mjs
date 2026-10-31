import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, step, PER_BOLUK } from '../src/sim.js';

const run = (opts) => { const w = createBattle(opts); while (w.winner < 0 && w.t < 600) step(w); return w; };

test('iki ordu eşit sayıda, bölükler 20 asker', () => {
  const w = createBattle({ soldiers: 2000 });
  assert.equal(w.N % PER_BOLUK, 0);
  assert.deepEqual(w.alive, [1000, 1000]);
});

test('savaş biter ve kazanan çıkar', () => {
  const w = run({ soldiers: 400, seed: 3 });
  assert.ok(w.winner >= 0, 'savaş 600 sn içinde bitmeli');
  assert.ok(w.t < 600);
});

test('aynı tohum aynı savaşı verir', () => {
  const a = run({ soldiers: 400, seed: 11 }), b = run({ soldiers: 400, seed: 11 });
  assert.equal(a.t, b.t); assert.deepEqual(a.alive, b.alive);
  assert.deepEqual([...a.x.slice(0, 50)], [...b.x.slice(0, 50)]);
});

test('kalan sayısı canı 0 olmayan askerlerle tutarlı', () => {
  const w = run({ soldiers: 400, seed: 5 });
  for (const team of [0, 1]) {
    let n = 0; for (let i = 0; i < w.N; i++) if (w.team[i] === team && w.hp[i] > 0) n++;
    assert.equal(n, w.alive[team]);
  }
});
