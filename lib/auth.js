import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query, tx } from './db.js';
import { HttpError, getCookie, setCookie } from './http.js';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
export const STARTING_CREDITS = 1000;

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const hash = await scryptAsync(password, salt, 64);
  return timingSafeEqual(hash, Buffer.from(hex, 'hex'));
}

async function startSession(req, res, userId) {
  const token = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [token, userId]
  );
  setCookie(req, res, 'sid', token, SESSION_DAYS * 86400);
}

export function publicUser(user) {
  return user && { id: user.id, username: user.username, balance: user.balance };
}

export async function signUp(req, res, username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    throw new HttpError(400, 'Username must be 3-20 letters, numbers or underscores');
  }
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await tx(async (c) => {
      const { rows } = await c.query(
        'INSERT INTO users (username, password_hash, balance) VALUES ($1, $2, $3) RETURNING *',
        [username, passwordHash, STARTING_CREDITS]
      );
      await c.query("INSERT INTO ledger (user_id, amount, kind) VALUES ($1, $2, 'signup bonus')", [
        rows[0].id,
        STARTING_CREDITS,
      ]);
      return rows[0];
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'That username is taken');
    throw err;
  }
  await startSession(req, res, user.id);
  return user;
}

export async function logIn(req, res, username, password) {
  const { rows } = await query('SELECT * FROM users WHERE lower(username) = lower($1)', [String(username || '').trim()]);
  const user = rows[0];
  if (!user || !(await checkPassword(String(password || ''), user.password_hash))) {
    throw new HttpError(401, 'Wrong username or password');
  }
  await startSession(req, res, user.id);
  return user;
}

export async function logOut(req, res) {
  const token = getCookie(req, 'sid');
  if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
  setCookie(req, res, 'sid', '', 0);
}

export async function currentUser(req) {
  const token = getCookie(req, 'sid');
  if (!token) return null;
  const { rows } = await query(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()',
    [token]
  );
  return rows[0] || null;
}

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Log in first');
  return user;
}
