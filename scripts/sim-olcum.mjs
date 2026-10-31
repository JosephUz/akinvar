// Simülasyonun tarayıcısız başarım ölçümü: node scripts/sim-olcum.mjs [2000 5000 10000]
import { createBattle, step } from '../src/sim.js';

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
for (const n of sizes.length ? sizes : [2000, 5000, 10000, 20000]) {
  const w = createBattle({ soldiers: n, seed: 7 });
  let worst = 0, total = 0, steps = 0;
  while (w.winner < 0 && w.t < 600) {
    const a = performance.now(); step(w);
    const d = performance.now() - a; total += d; worst = Math.max(worst, d); steps++;
  }
  console.log(`${n} asker · savaş ${w.t.toFixed(0)} sn · kazanan ${w.winner} · kalan ${w.alive.join('/')} · adım ort ${(total / steps).toFixed(2)} ms, en kötü ${worst.toFixed(1)} ms · arena ${w.radius.toFixed(0)}`);
}
