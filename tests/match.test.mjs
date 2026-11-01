import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startBattle, startFlags, endRound, buyUnit, refundUnit, buyEco, refundEco, buyTalim, refundTalim, ecoCost, talimCost, income, saveMatch, loadMatch } from '../src/match.js';
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

test('ekonomi ve geliştirme bedeli tur gelirinin yarısı, her ekonomi seviyesi tur başına +150', () => {
  const m = createMatch({ seed: 2 }), me = m.players[0];
  assert.equal(ecoCost(0), 500); assert.equal(ecoCost(1), 575); assert.equal(ecoCost(2), 650);
  assert.ok(buyEco(m, me)); assert.equal(me.gold, 500); assert.equal(income(me), 1150);
  assert.ok(refundEco(m, me)); assert.equal(me.gold, 1000);
  assert.equal(talimCost(me), 500);
  assert.ok(buyTalim(m, me, 2)); assert.equal(me.talim[2], 1); assert.equal(me.gold, 500);
  assert.ok(buyTalim(m, me, 2)); assert.equal(me.gold, 0); // ikinci seviye de aynı bedel
  assert.ok(refundTalim(m, me, 2)); assert.ok(refundTalim(m, me, 2)); assert.equal(me.gold, 1000);
  me.gold = 2000; assert.ok(buyEco(m, me)); assert.equal(talimCost(me), 575); // tur 1.150 → geliştirme 575
  assert.ok(buyTalim(m, me, CLASSES.length - 1)); assert.equal(me.gold, 2000 - 500 - 575);
  assert.ok(refundEco(m, me)); assert.ok(refundTalim(m, me, CLASSES.length - 1)); assert.equal(me.gold, 2000); // ödenen aynen döner
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

test('kayıt: hazırlıkta, savaşın ortasında ve bayrak evresinde kaydedilen maç aynen sürer', () => {
  const m = createMatch({ teamSize: 2, seed: 9 }), me = m.players[0];
  buyUnit(m, me, CLASS_BY_KEY['tb-no-ho-no'].index); buyUnit(m, me, CLASSES[3].index); me.ready = true;
  const roundTrip = (x) => loadMatch(JSON.parse(JSON.stringify(saveMatch(x))));
  const prep = roundTrip(m);
  assert.equal(prep.players[0].gold, me.gold); assert.deepEqual(prep.players[0].units, me.units);
  assert.equal(prep.rng(), m.rng());

  startBattle(m);
  for (let k = 0; k < 400; k++) step(m.battle);
  const mid = roundTrip(m);
  const fingerprint = (x) => { const w = x.battle; let s = w.alive.join(); for (let i = 0; i < w.N; i += 7) s += `|${w.hp[i]},${w.x[i].toFixed(3)}`; return s + `|${w.arrows.length}|${w.t.toFixed(2)}`; };
  assert.equal(fingerprint(mid), fingerprint(m));
  for (const x of [m, mid]) { while (x.battle.winner < 0 && x.battle.t < 600) step(x.battle); }
  assert.equal(fingerprint(mid), fingerprint(m));

  startFlags(m); startFlags(mid);
  if (m.battle.phase === 'flag') {
    for (let k = 0; k < 20; k++) { step(m.battle); step(mid.battle); }
    const fl = roundTrip(m);
    assert.equal(fl.battle.phase, 'flag'); assert.equal(fl.battle.flagT, m.battle.flagT);
    assert.deepEqual(fl.battle.flags, m.battle.flags);
  }
  for (const x of [m, mid]) { while (x.battle.phase === 'flag') step(x.battle); endRound(x); }
  assert.deepEqual(mid.players.map((p) => [p.hp, p.gold, p.eco]), m.players.map((p) => [p.hp, p.gold, p.eco]));
  assert.equal(loadMatch({ v: 0 }), null);
});
