// Bets between two people. Both stakes sit in escrow (taken out of their balances) until the bet
// is settled by the final score, by both sides reporting the same result, or by an agreed cash-out.
import { randomBytes } from 'node:crypto';
import { query, tx } from './db.js';
import { HttpError } from './http.js';
import { findSport, getGames, getScores, isDemo } from './odds-api.js';
import {
  MARKET_NAMES,
  gradeGame,
  isGameMarket,
  isValidPrice,
  matchStake,
  otherSide,
  payouts,
  sideLabel,
} from '../public/js/markets.js';

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RESULTS = ['creator', 'taker', 'push'];

function newId() {
  return [...randomBytes(10)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

const SELECT_BETS = `
  SELECT b.*, cu.username AS creator_name, tu.username AS taker_name
  FROM bets b JOIN users cu ON cu.id = b.creator_id LEFT JOIN users tu ON tu.id = b.taker_id`;

// Adds (or with a negative amount, takes) credits and records it in the ledger.
async function moveCredits(c, userId, betId, amount, kind) {
  const { rowCount } = await c.query(
    'UPDATE users SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0',
    [amount, userId]
  );
  if (!rowCount) throw new HttpError(400, "You don't have enough credits");
  await c.query('INSERT INTO ledger (user_id, bet_id, amount, kind) VALUES ($1, $2, $3, $4)', [
    userId,
    betId,
    amount,
    kind,
  ]);
}

async function lockBet(c, id) {
  const { rows } = await c.query('SELECT * FROM bets WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new HttpError(404, 'Bet not found');
  return rows[0];
}

function roleOf(bet, user) {
  if (bet.creator_id === user.id) return 'creator';
  if (bet.taker_id === user.id) return 'taker';
  return null;
}

function requireParty(bet, user) {
  const role = roleOf(bet, user);
  if (!role) throw new HttpError(403, "You're not part of this bet");
  if (bet.status !== 'matched') throw new HttpError(409, 'This bet is not active');
  return role;
}

async function settle(c, bet, result, creatorPayout, takerPayout) {
  const kind = result === 'cashout' ? 'cash out' : result === 'push' ? 'push refund' : 'winnings';
  // Credit in user id order so two bets settling at once can't deadlock.
  const credits = [
    [bet.creator_id, creatorPayout],
    [bet.taker_id, takerPayout],
  ]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => a[0] - b[0]);
  for (const [userId, amount] of credits) await moveCredits(c, userId, bet.id, amount, kind);
  await c.query(
    `UPDATE bets SET status = 'settled', result = $2, creator_payout = $3, taker_payout = $4,
       settled_at = now(), offer_by = NULL, offer_creator_amount = NULL
     WHERE id = $1`,
    [bet.id, result, creatorPayout, takerPayout]
  );
}

function wholeCredits(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${label} must be a whole number of credits`);
  return n;
}

export async function createBet(user, input) {
  const sport = findSport(input.sport);
  const game = (await getGames(sport.key)).find((g) => g.id === input.event_id);
  if (!game) throw new HttpError(400, 'That game has started or is no longer available');

  const market = String(input.market || '');
  const selection = String(input.selection || '');
  const price = Number(input.price);
  if (!isValidPrice(price)) throw new HttpError(400, 'Odds must be +100 or higher, or -100 or lower');
  let point = input.point === null || input.point === undefined || input.point === '' ? null : Number(input.point);
  if (point !== null && !(Number.isFinite(point) && Number.isInteger(point * 2) && Math.abs(point) < 10000)) {
    throw new HttpError(400, 'Lines must be in whole or half points');
  }
  let player = null;

  if (market === 'h2h' || market === 'spreads') {
    if (selection !== game.home_team && selection !== game.away_team) throw new HttpError(400, 'Pick one of the two teams');
    if (market === 'h2h') point = null;
    else if (point === null) throw new HttpError(400, 'A spread needs a line');
  } else if (market === 'totals') {
    if (selection !== 'Over' && selection !== 'Under') throw new HttpError(400, 'Pick Over or Under');
    if (point === null) throw new HttpError(400, 'A total needs a line');
  } else if (sport.props.includes(market)) {
    player = String(input.player || '').trim().slice(0, 80);
    if (!player) throw new HttpError(400, 'A player prop needs a player');
    if (selection === 'Yes' || selection === 'No') point = null;
    else if (selection !== 'Over' && selection !== 'Under') throw new HttpError(400, 'Pick Over or Under');
    else if (point === null) throw new HttpError(400, 'An over/under needs a line');
  } else {
    throw new HttpError(400, 'Unknown bet type');
  }

  const stake = wholeCredits(input.stake, 'Your stake');
  const takerStake =
    input.taker_stake === undefined || input.taker_stake === null || input.taker_stake === ''
      ? matchStake(stake, price)
      : wholeCredits(input.taker_stake, "Your opponent's stake");
  const visibility = input.visibility === 'open' ? 'open' : 'private';
  const note = String(input.note || '').trim().slice(0, 200) || null;
  const id = newId();

  await tx(async (c) => {
    await c.query(
      `INSERT INTO bets (id, creator_id, visibility, sport_key, sport_title, event_id, home_team, away_team,
         commence_time, market, selection, point, player, price, creator_stake, taker_stake, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [id, user.id, visibility, sport.key, sport.title, game.id, game.home_team, game.away_team,
        game.commence_time, market, selection, point, player, price, stake, takerStake, note]
    );
    await moveCredits(c, user.id, id, -stake, 'stake');
  });
  return id;
}

export function acceptBet(user, id) {
  return tx(async (c) => {
    const bet = await lockBet(c, id);
    if (bet.status !== 'open') throw new HttpError(409, 'Someone already took this bet, or it was cancelled');
    if (bet.creator_id === user.id) throw new HttpError(400, "You can't take your own bet");
    if (bet.commence_time <= new Date()) throw new HttpError(409, 'This game has already started');
    await moveCredits(c, user.id, id, -bet.taker_stake, 'stake');
    await c.query("UPDATE bets SET taker_id = $1, status = 'matched', matched_at = now() WHERE id = $2", [user.id, id]);
  });
}

export function cancelBet(user, id) {
  return tx(async (c) => {
    const bet = await lockBet(c, id);
    if (bet.creator_id !== user.id) throw new HttpError(403, 'Only the person who made this bet can cancel it');
    if (bet.status !== 'open') throw new HttpError(409, 'Only bets nobody has taken yet can be cancelled');
    await moveCredits(c, user.id, id, bet.creator_stake, 'refund');
    await c.query("UPDATE bets SET status = 'cancelled', result = 'cancelled', settled_at = now() WHERE id = $1", [id]);
  });
}

// Proposes ending the bet now: the proposer takes `amount` of the pot and the other side gets the rest.
export function offerCashOut(user, id, amount) {
  return tx(async (c) => {
    const bet = await lockBet(c, id);
    const role = requireParty(bet, user);
    const pot = bet.creator_stake + bet.taker_stake;
    const mine = Number(amount);
    if (!Number.isInteger(mine) || mine < 0 || mine > pot) {
      throw new HttpError(400, `Your share must be a whole number from 0 to ${pot}`);
    }
    const creatorAmount = role === 'creator' ? mine : pot - mine;
    await c.query('UPDATE bets SET offer_by = $1, offer_creator_amount = $2 WHERE id = $3', [user.id, creatorAmount, id]);
  });
}

export function respondCashOut(user, id, accept) {
  return tx(async (c) => {
    const bet = await lockBet(c, id);
    requireParty(bet, user);
    if (bet.offer_by === null) throw new HttpError(409, 'There is no cash-out offer to answer');
    if (bet.offer_by === user.id) throw new HttpError(400, "You can't answer your own offer");
    if (!accept) {
      await c.query('UPDATE bets SET offer_by = NULL, offer_creator_amount = NULL WHERE id = $1', [id]);
      return;
    }
    const pot = bet.creator_stake + bet.taker_stake;
    await settle(c, bet, 'cashout', bet.offer_creator_amount, pot - bet.offer_creator_amount);
  });
}

export function withdrawCashOut(user, id) {
  return tx(async (c) => {
    const bet = await lockBet(c, id);
    requireParty(bet, user);
    if (bet.offer_by !== user.id) throw new HttpError(409, 'You have no offer to withdraw');
    await c.query('UPDATE bets SET offer_by = NULL, offer_creator_amount = NULL WHERE id = $1', [id]);
  });
}

// Each side says who won; once both say the same thing the bet pays out.
export function reportResult(user, id, result) {
  if (!RESULTS.includes(result)) throw new HttpError(400, 'Unknown result');
  return tx(async (c) => {
    const bet = await lockBet(c, id);
    const role = requireParty(bet, user);
    if (bet.commence_time > new Date()) throw new HttpError(409, "The game hasn't started yet");
    bet[`${role}_report`] = result;
    await c.query(`UPDATE bets SET ${role}_report = $1 WHERE id = $2`, [result, id]);
    if (bet.creator_report && bet.creator_report === bet.taker_report) {
      await settle(c, bet, result, ...payouts(bet, result));
    }
  });
}

// Refunds open bets nobody took before the game started.
export async function expireOpenBets() {
  const { rows } = await query("SELECT id FROM bets WHERE status = 'open' AND commence_time <= now()");
  for (const { id } of rows) {
    await tx(async (c) => {
      const bet = await lockBet(c, id);
      if (bet.status !== 'open' || bet.commence_time > new Date()) return;
      await moveCredits(c, bet.creator_id, id, bet.creator_stake, 'refund');
      await c.query("UPDATE bets SET status = 'cancelled', result = 'expired', settled_at = now() WHERE id = $1", [id]);
    });
  }
}

// Settles moneyline, spread and total bets on games that have finished.
export async function gradeFinishedGames() {
  if (isDemo()) return;
  const { rows: pending } = await query(
    `SELECT id, sport_key, event_id FROM bets
     WHERE status = 'matched' AND market IN ('h2h', 'spreads', 'totals') AND commence_time < now()`
  );
  const sports = [...new Set(pending.map((b) => b.sport_key))];
  for (const sport of sports) {
    let scores;
    try {
      scores = await getScores(sport);
    } catch (err) {
      console.error(err);
      continue;
    }
    const finals = new Map(scores.filter((s) => s.completed && s.scores).map((s) => [s.id, s]));
    for (const { id, event_id } of pending.filter((b) => b.sport_key === sport && finals.has(b.event_id))) {
      const final = finals.get(event_id);
      const scoreOf = (team) => Number(final.scores.find((s) => s.name === team)?.score);
      await tx(async (c) => {
        const bet = await lockBet(c, id);
        if (bet.status !== 'matched') return;
        const home = scoreOf(bet.home_team);
        const away = scoreOf(bet.away_team);
        if (!Number.isFinite(home) || !Number.isFinite(away)) return;
        const result = gradeGame(bet, home, away);
        await settle(c, bet, result, ...payouts(bet, result));
      });
    }
  }
}

export function serializeBet(bet, viewer) {
  const role = viewer ? roleOf(bet, viewer) : null;
  const pot = bet.creator_stake + bet.taker_stake;
  return {
    id: bet.id,
    status: bet.status,
    result: bet.result,
    visibility: bet.visibility,
    sport_title: bet.sport_title,
    home_team: bet.home_team,
    away_team: bet.away_team,
    commence_time: bet.commence_time,
    market: bet.market,
    market_name: MARKET_NAMES[bet.market] || bet.market,
    auto_settles: isGameMarket(bet.market) && !isDemo(),
    price: bet.price,
    pot,
    note: bet.note,
    creator: {
      username: bet.creator_name,
      side: sideLabel(bet, { selection: bet.selection, point: bet.point }),
      stake: bet.creator_stake,
      report: bet.creator_report,
      payout: bet.creator_payout,
    },
    taker: {
      username: bet.taker_name,
      side: sideLabel(bet, otherSide(bet)),
      stake: bet.taker_stake,
      report: bet.taker_report,
      payout: bet.taker_payout,
    },
    offer:
      bet.offer_by === null
        ? null
        : {
            by: bet.offer_by === bet.creator_id ? 'creator' : 'taker',
            creator_amount: bet.offer_creator_amount,
            taker_amount: pot - bet.offer_creator_amount,
          },
    role,
    created_at: bet.created_at,
    settled_at: bet.settled_at,
  };
}

export async function getBet(id, viewer) {
  const { rows } = await query(`${SELECT_BETS} WHERE b.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Bet not found');
  return serializeBet(rows[0], viewer);
}

export async function listMyBets(user) {
  const { rows } = await query(
    `${SELECT_BETS} WHERE b.creator_id = $1 OR b.taker_id = $1
     ORDER BY (b.status IN ('open', 'matched')) DESC, b.commence_time DESC LIMIT 200`,
    [user.id]
  );
  return rows.map((b) => serializeBet(b, user));
}

export async function listOpenBoard(user) {
  const { rows } = await query(
    `${SELECT_BETS} WHERE b.visibility = 'open' AND b.status = 'open' AND b.commence_time > now()
     ORDER BY b.commence_time LIMIT 200`
  );
  return rows.map((b) => serializeBet(b, user));
}
