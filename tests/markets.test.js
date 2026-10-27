import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeGame, matchStake, otherSide, payouts, sideLabel } from '../public/js/markets.js';

const game = { home_team: 'Lakers', away_team: 'Celtics' };

test('matchStake pays out what the odds say', () => {
  assert.equal(matchStake(110, -110), 100);
  assert.equal(matchStake(100, 150), 150);
  assert.equal(matchStake(100, -200), 50);
  assert.equal(matchStake(1, -1000), 1);
});

test('otherSide flips teams, spreads and over/unders', () => {
  assert.deepEqual(otherSide({ ...game, market: 'spreads', selection: 'Lakers', point: -3.5 }), { selection: 'Celtics', point: 3.5 });
  assert.deepEqual(otherSide({ ...game, market: 'h2h', selection: 'Celtics', point: null }), { selection: 'Lakers', point: null });
  assert.deepEqual(otherSide({ ...game, market: 'totals', selection: 'Over', point: 220.5 }), { selection: 'Under', point: 220.5 });
  assert.deepEqual(otherSide({ ...game, market: 'player_anytime_td', selection: 'Yes', point: null }), { selection: 'No', point: null });
});

test('sideLabel reads like a bet slip', () => {
  const spread = { ...game, market: 'spreads', selection: 'Lakers', point: -3.5 };
  assert.equal(sideLabel(spread, spread), 'Lakers -3.5');
  assert.equal(sideLabel(spread, otherSide(spread)), 'Celtics +3.5');
  const prop = { ...game, market: 'player_points', selection: 'Over', point: 25.5, player: 'J. Doe' };
  assert.equal(sideLabel(prop, otherSide(prop)), 'J. Doe Under 25.5 Points');
  const td = { ...game, market: 'player_anytime_td', selection: 'Yes', point: null, player: 'J. Doe' };
  assert.equal(sideLabel(td, td), 'J. Doe Anytime TD: Yes');
});

test('gradeGame grades spreads, moneylines and totals', () => {
  const lakersMinus = { ...game, market: 'spreads', selection: 'Lakers', point: -3.5 };
  assert.equal(gradeGame(lakersMinus, 110, 106), 'creator');
  assert.equal(gradeGame(lakersMinus, 108, 106), 'taker');
  const celticsPlus = { ...game, market: 'spreads', selection: 'Celtics', point: 3 };
  assert.equal(gradeGame(celticsPlus, 103, 100), 'push');
  assert.equal(gradeGame({ ...game, market: 'h2h', selection: 'Celtics' }, 99, 100), 'creator');
  assert.equal(gradeGame({ ...game, market: 'h2h', selection: 'Celtics' }, 100, 100), 'push');
  assert.equal(gradeGame({ ...game, market: 'totals', selection: 'Under', point: 200.5 }, 100, 101), 'taker');
});

test('payouts split the pot', () => {
  const bet = { creator_stake: 110, taker_stake: 100 };
  assert.deepEqual(payouts(bet, 'creator'), [210, 0]);
  assert.deepEqual(payouts(bet, 'taker'), [0, 210]);
  assert.deepEqual(payouts(bet, 'push'), [110, 100]);
});
