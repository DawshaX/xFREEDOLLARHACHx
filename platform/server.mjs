import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScope } from './scope.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(__dirname, 'public');
const library = JSON.parse(await readFile(path.join(__dirname, 'data/library.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'migration-manifest.json'), 'utf8'));

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('payload too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('invalid json'); }
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'");
    const url = new URL(req.url || '/', 'http://local.invalid');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { status: 'ok', mode: 'read-only', legacyRuntime: 'disabled', networkScanning: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, {
          project: 'NOVA Security Platform',
          repository: manifest.target_repository,
          migration: manifest,
          capabilities: [
            { id: 'migration', status: 'ready', label: 'نقل منقّح للكود المصدري' },
            { id: 'scope', status: 'ready', label: 'تحقق محلي من سياسة النطاق' },
            { id: 'library', status: 'ready', label: 'مكتبة معرفية أولية' },
            { id: 'legacy', status: 'disabled', label: 'تشغيل NOVA القديم' },
            { id: 'active-scanning', status: 'not-enabled', label: 'فحص الأهداف الخارجية' }
          ]
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/library') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const items = q ? library.filter((item) => JSON.stringify(item).toLowerCase().includes(q)) : library;
        return json(res, 200, { items, total: items.length, liveFeed: false });
      }
      if (req.method === 'POST' && url.pathname === '/api/scope/validate') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'cross-origin request rejected' });
        const body = await readJsonBody(req);
        return json(res, 200, validateScope(body));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(path.join(publicDir, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bad request';
      const status = message === 'payload too large' ? 413 : 400;
      return json(res, status, { error: message });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`NOVA safe control plane listening on 0.0.0.0:${port}`);
    console.log('Legacy runtime disabled. No external target scanning is enabled.');
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
