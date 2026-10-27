// GET ?id=ID: one bet (anyone with the link can view it).
// GET ?view=mine | board: your bets, or open bets anyone can take.
// POST { action, id, ... }: create, accept, cancel, offer, respond, withdraw, report.
import { currentUser, publicUser, requireUser } from '../lib/auth.js';
import {
  acceptBet,
  cancelBet,
  createBet,
  expireOpenBets,
  getBet,
  gradeFinishedGames,
  listMyBets,
  listOpenBoard,
  offerCashOut,
  reportResult,
  respondCashOut,
  withdrawCashOut,
} from '../lib/bets.js';
import { HttpError, getQuery, readJson, route, send } from '../lib/http.js';

export default route(async (req, res) => {
  if (req.method === 'GET') {
    const { id, view } = getQuery(req);
    await expireOpenBets();
    await gradeFinishedGames();
    if (id) return send(res, 200, { bet: await getBet(id, await currentUser(req)) });

    const user = await requireUser(req);
    if (view === 'board') return send(res, 200, { bets: await listOpenBoard(user) });
    return send(res, 200, { user: publicUser(user), bets: await listMyBets(user) });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const user = await requireUser(req);
  const body = await readJson(req);
  const id = String(body.id || '');
  switch (body.action) {
    case 'create':
      return send(res, 200, { id: await createBet(user, body) });
    case 'accept':
      await acceptBet(user, id);
      break;
    case 'cancel':
      await cancelBet(user, id);
      break;
    case 'offer':
      await offerCashOut(user, id, body.amount);
      break;
    case 'respond':
      await respondCashOut(user, id, body.accept === true);
      break;
    case 'withdraw':
      await withdrawCashOut(user, id);
      break;
    case 'report':
      await reportResult(user, id, body.result);
      break;
    default:
      throw new HttpError(400, 'Unknown action');
  }
  send(res, 200, { bet: await getBet(id, user) });
});
