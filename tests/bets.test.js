// Runs the escrow flow against a real Postgres. Set TEST_DATABASE_URL to a throwaway database;
// its tables are dropped before the run.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url;
delete process.env.ODDS_API_KEY;

const { query, ensureSchema, closePool } = await import('../lib/db.js');
const bets = await import('../lib/bets.js');
const { getGames } = await import('../lib/odds-api.js');

const SPORT = 'basketball_nba';
let game;

async function makeUser(name, balance = 1000) {
  const { rows } = await query(
    "INSERT INTO users (username, password_hash, balance) VALUES ($1, 'x', $2) RETURNING *",
    [name, balance]
  );
  return rows[0];
}

async function balance(user) {
  const { rows } = await query('SELECT balance FROM users WHERE id = $1', [user.id]);
  return rows[0].balance;
}

function spreadBet(overrides = {}) {
  return {
    sport: SPORT,
    event_id: game.id,
    market: 'spreads',
    selection: game.home_team,
    point: -3.5,
    price: -110,
    stake: 110,
    ...overrides,
  };
}

before(async () => {
  if (!url) return;
  await query('DROP TABLE IF EXISTS ledger, bets, sessions, odds_cache, users CASCADE');
  await ensureSchema();
  [game] = await getGames(SPORT);
});
after(() => closePool());

test('both stakes go into escrow and the winner takes the pot', { skip: !url }, async () => {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const id = await bets.createBet(alice, spreadBet());
  assert.equal(await balance(alice), 890);

  await bets.acceptBet(bob, id);
  assert.equal(await balance(bob), 900); // -110 odds: 110 to win 100

  await query("UPDATE bets SET commence_time = now() - interval '1 hour' WHERE id = $1", [id]);
  await bets.reportResult(alice, id, 'creator');
  assert.equal((await bets.getBet(id, alice)).status, 'matched');
  await bets.reportResult(bob, id, 'creator');

  const bet = await bets.getBet(id, alice);
  assert.equal(bet.status, 'settled');
  assert.equal(await balance(alice), 1100);
  assert.equal(await balance(bob), 900);
});

test('an accepted cash-out offer pays out the agreed split', { skip: !url }, async () => {
  const carol = await makeUser('carol');
  const dan = await makeUser('dan');
  const id = await bets.createBet(carol, spreadBet({ market: 'player_points', selection: 'Over', point: 22.5, player: 'Marcus Hale', price: 100, stake: 200 }));
  await bets.acceptBet(dan, id);

  await bets.offerCashOut(dan, id, 300); // Dan takes 300 of the 400 pot
  await assert.rejects(bets.respondCashOut(dan, id, true), /your own offer/);
  await bets.respondCashOut(carol, id, true);

  assert.equal(await balance(carol), 900);
  assert.equal(await balance(dan), 1100);
  assert.equal((await bets.getBet(id, carol)).result, 'cashout');
});

test('rules: no overdrafts, no taking your own bet, no double-taking', { skip: !url }, async () => {
  const erin = await makeUser('erin', 50);
  const frank = await makeUser('frank');
  const gina = await makeUser('gina');
  await assert.rejects(bets.createBet(erin, spreadBet()), /enough credits/);

  const id = await bets.createBet(frank, spreadBet());
  await assert.rejects(bets.acceptBet(frank, id), /own bet/);
  await assert.rejects(bets.acceptBet(erin, id), /enough credits/);
  await Promise.allSettled([bets.acceptBet(gina, id), bets.acceptBet(erin, id)]);
  assert.equal(await balance(gina), 900);
  assert.equal(await balance(erin), 50);
  await assert.rejects(bets.cancelBet(frank, id), /nobody has taken/);
});

test('cancelling or expiring an untaken bet refunds it', { skip: !url }, async () => {
  const hank = await makeUser('hank');
  const first = await bets.createBet(hank, spreadBet());
  await bets.cancelBet(hank, first);
  assert.equal(await balance(hank), 1000);

  const second = await bets.createBet(hank, spreadBet());
  await query("UPDATE bets SET commence_time = now() - interval '1 minute' WHERE id = $1", [second]);
  await bets.expireOpenBets();
  assert.equal(await balance(hank), 1000);
  assert.equal((await bets.getBet(second, hank)).result, 'expired');
});

test('no credits are created or lost: ledger changes equal what is held in escrow', { skip: !url }, async () => {
  const { rows } = await query(`
    SELECT (SELECT coalesce(sum(amount), 0) FROM ledger) AS moved,
           (SELECT coalesce(sum(creator_stake + CASE WHEN status = 'matched' THEN taker_stake ELSE 0 END), 0)
              FROM bets WHERE status IN ('open', 'matched')) AS escrow`);
  assert.equal(Number(rows[0].moved), -Number(rows[0].escrow));
});

test('game bets settle themselves from the final score', { skip: !url }, async () => {
  const ivy = await makeUser('ivy');
  const jack = await makeUser('jack');
  const id = await bets.createBet(ivy, spreadBet()); // home -3.5
  await bets.acceptBet(jack, id);
  await query("UPDATE bets SET commence_time = now() - interval '3 hours' WHERE id = $1", [id]);
  // A fresh cached scores response, so no request goes out.
  const final = [{ id: game.id, completed: true, scores: [{ name: game.home_team, score: '101' }, { name: game.away_team, score: '99' }] }];
  await query("INSERT INTO odds_cache (key, data) VALUES ($1, $2)", [`scores:${SPORT}`, JSON.stringify(final)]);

  process.env.ODDS_API_KEY = 'test';
  try {
    await bets.gradeFinishedGames();
  } finally {
    delete process.env.ODDS_API_KEY;
  }
  const bet = await bets.getBet(id, jack);
  assert.equal(bet.result, 'taker'); // won by 2, didn't cover 3.5
  assert.equal(await balance(jack), 1110);
});
