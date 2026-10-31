// Botlar arası maçları tarayıcısız oynatır: node scripts/mac-olcum.mjs [takım boyu] [bayrak canı] [maç sayısı]
import { createMatch, startBattle, startFlags, endRound } from '../src/match.js';
import { step } from '../src/sim.js';

const [size = 1, hp = 100, count = 5] = process.argv.slice(2).map(Number);
const wins = [0, 0];
for (let k = 0; k < count; k++) {
  const m = createMatch({ teamSize: size, flagHp: hp, seed: 1000 + k, humans: [] });
  let maxSoldiers = 0, worst = 0;
  while (m.phase !== 'over' && m.round < 200) {
    const w = startBattle(m);
    maxSoldiers = Math.max(maxSoldiers, w.N);
    while (w.winner < 0) { const a = performance.now(); step(w); worst = Math.max(worst, performance.now() - a); }
    startFlags(m);
    while (w.phase === 'flag') step(w);
    endRound(m);
  }
  wins[m.winner]++;
  const desc = m.players.map((p) => `${p.name}(${p.team ? 'K' : 'M'}) can ${p.hp} eko ${p.eco} talim ${p.talim.join('')}`).join(' | ');
  console.log(`maç ${k + 1}: ${m.round} tur, kazanan ${m.winner ? 'Kırmızı' : 'Mavi'}, en kalabalık savaş ${maxSoldiers} asker, en yavaş adım ${worst.toFixed(1)} ms\n   ${desc}`);
}
console.log('galibiyet', wins);
