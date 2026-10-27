// Local development server: serves public/ and runs the api/ functions the way Vercel does.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve('public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const API = {
  '/api/auth': (await import('./api/auth.js')).default,
  '/api/bets': (await import('./api/bets.js')).default,
  '/api/lines': (await import('./api/lines.js')).default,
};

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (API[pathname]) return API[pathname](req, res);

    const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    try {
      if (!file.startsWith(PUBLIC_DIR)) throw new Error('outside public/');
      const body = await readFile(file);
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));
