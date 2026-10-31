import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startBattle, startFlags, endRound, buyUnit, refundUnit, buyEco, refundEco, buyTalim, ecoCost, talimCost, income } from '../src/match.js';
import { step, command, PER_BOLUK } from '../src/sim.js';
import { CLASSES, CLASS_BY_KEY } from '../src/units.js';

test('tur başı gelir, kart al ve geri ver tam iade', () => {
  const m = createMatch({ teamSize: 1, seed: 1 }), me = m.players[0];
  assert.equal(me.gold, 1000);
  const c = CLASSES[5];
  assert.ok(buyUnit(m, me, c.index)); assert.equal(me.gold, 1000 - c.cost);
  assert.ok(refundUnit(m, me, c.index)); assert.equal(me.gold, 1000);
  assert.ok(!refundUnit(m, me, c.index), 'almadığını geri veremez');
});

test('ekonomi 400 × n, her seviye tur başına +150; talim bölük fiyatı × 2 × n', () => {
  const m = createMatch({ seed: 2 }), me = m.players[0];
  assert.equal(ecoCost(0), 400); assert.equal(ecoCost(1), 800);
  assert.ok(buyEco(m, me)); assert.equal(me.gold, 600); assert.equal(income(me), 1150);
  assert.ok(refundEco(m, me)); assert.equal(me.gold, 1000);
  const ucuz = CLASSES[0], pahali = CLASSES[CLASSES.length - 1];
  assert.equal(talimCost(0, 0), Math.round(ucuz.cost * 2 / 10) * 10); assert.equal(talimCost(0, 1), Math.round(ucuz.cost * 4 / 10) * 10);
  assert.ok(talimCost(pahali.index, 0) > talimCost(0, 0) * 5, 'çelik askerin geliştirmesi çok daha pahalı');
  assert.ok(buyTalim(m, me, 2)); assert.equal(me.talim[2], 1);
});

test('ölen asker kendi bayrağından, bayrağa giden rakibinkinden bir can götürür; gönderilmeyen dağılır', () => {
  const m = createMatch({ teamSize: 1, flagHp: 1000, seed: 3, humans: [0] }), me = m.players[0];
  const strong = CLASS_BY_KEY['sp:st-sh:st-fo-st'];
  while (me.gold >= strong.cost) buyUnit(m, me, strong.index);
  m.players[1].units = [CLASS_BY_KEY['ua-no-fo-no'].index]; // savaşı biz kazanalım
  const w = startBattle(m);
  while (w.winner < 0) step(w);
  assert.equal(w.winner, 0);
  startFlags(m);
  assert.equal(m.losses[1], PER_BOLUK, 'rakibin ölen 20 askeri');
  assert.equal(me.hp, 1000 - (m.losses[0] ?? 0));
  assert.equal(w.phase, 'flag'); assert.equal(w.flags.length, 1); assert.equal(w.flags[0].hp, 1000 - PER_BOLUK);
  const alive = w.alive[0];
  const mine = [...Array(w.B).keys()].filter((b) => w.bteam[b] === 0);
  command(w, 0, mine.slice(0, 1), { type: 'flag', flag: 0 }); // yalnız ilk bölük
  const sent = w.balive[mine[0]];
  while (w.phase === 'flag') step(w);
  assert.equal(w.flags[0].hits, sent);
  assert.ok(alive > sent);
  endRound(m);
  assert.equal(m.players[1].hp, 1000 - PER_BOLUK - sent);
  assert.equal(m.round, 2);
});

test('botlar arası maç biter', () => {
  const m = createMatch({ teamSize: 2, flagHp: 100, seed: 9, humans: [] });
  while (m.phase !== 'over' && m.round < 60) {
    const w = startBattle(m);
    while (w.winner < 0) step(w);
    startFlags(m);
    while (w.phase === 'flag') step(w);
    endRound(m);
  }
  assert.equal(m.phase, 'over');
  assert.ok(m.players.some((p) => p.out));
});
