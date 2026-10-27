// Small request/response helpers that work the same on Vercel and in the local server.
import { ensureSchema } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function getQuery(req) {
  return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

export async function readJson(req) {
  // Vercel has already parsed the body; the local server has not.
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

export function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setCookie(req, res, name, value, maxAgeSeconds) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
  );
}

// Wraps an API handler: sets up the database and turns thrown errors into JSON responses.
export function route(fn) {
  return async (req, res) => {
    try {
      await ensureSchema();
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Something went wrong. Try again.' });
    }
  };
}
