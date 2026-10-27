// GET ?sport=KEY: upcoming games with moneylines, spreads and totals.
// GET ?sport=KEY&event=ID: that game plus its player props.
import { HttpError, getQuery, route, send } from '../lib/http.js';
import { getGames, getProps, isDemo } from '../lib/odds-api.js';

export default route(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  const { sport, event } = getQuery(req);
  const games = await getGames(sport);
  if (!event) return send(res, 200, { demo: isDemo(), games });

  const game = games.find((g) => g.id === event);
  if (!game) throw new HttpError(404, 'That game has started or is no longer available');
  send(res, 200, { demo: isDemo(), game, props: await getProps(sport, event) });
});
