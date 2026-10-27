// GET: who is logged in. POST { action: 'signup' | 'login' | 'logout', username, password }.
import { currentUser, logIn, logOut, publicUser, signUp } from '../lib/auth.js';
import { HttpError, readJson, route, send } from '../lib/http.js';
import { isDemo } from '../lib/odds-api.js';

export default route(async (req, res) => {
  if (req.method === 'GET') {
    return send(res, 200, { user: publicUser(await currentUser(req)), demo: isDemo() });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const { action, username, password } = await readJson(req);
  if (action === 'signup') return send(res, 200, { user: publicUser(await signUp(req, res, username, password)) });
  if (action === 'login') return send(res, 200, { user: publicUser(await logIn(req, res, username, password)) });
  if (action === 'logout') {
    await logOut(req, res);
    return send(res, 200, { user: null });
  }
  throw new HttpError(400, 'Unknown action');
});
