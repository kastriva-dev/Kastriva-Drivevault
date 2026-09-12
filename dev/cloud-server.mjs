/* Local web/PWA server that intentionally uses the deployed Vercel API.
   This keeps localhost on the same GAS backend and account data as production. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CLOUD_ORIGIN = 'https://kastriva-drivevault.vercel.app';
const DEFAULT_PORT = Number(process.env.PORT || 8177);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};
const HIDDEN_TOP_LEVEL = new Set(['.git', '.github', '.hermes', '.vercel', 'api', 'desktop', 'dev', 'dist', 'gas', 'node_modules', 'tests']);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function proxyApi(req, res, cloudOrigin) {
  const target = new URL(req.url, cloudOrigin);
  const headers = { ...req.headers, host: target.host };
  delete headers['content-length'];
  const init = { method: req.method, headers, redirect: 'follow' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }
  fetch(target, init).then(async (upstream) => {
    const body = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = Object.fromEntries(upstream.headers.entries());
    responseHeaders['cache-control'] = 'no-store';
    delete responseHeaders['content-encoding'];
    delete responseHeaders['content-length'];
    res.writeHead(upstream.status, responseHeaders);
    res.end(body);
  }).catch((error) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'Cloud API tidak dapat dijangkau: ' + error.message }));
  });
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('bad path'); return; }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/p' || pathname.startsWith('/p/')) pathname = '/p/index.html';
  const first = pathname.split('/').filter(Boolean)[0] || '';
  if (first.startsWith('.') || HIDDEN_TOP_LEVEL.has(first)) { res.writeHead(404); res.end('not found'); return; }
  const file = path.resolve(ROOT, '.' + pathname);
  if (!inside(ROOT, file)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 ' + pathname); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
}

export function startCloudDevServer({ port = DEFAULT_PORT, host = '127.0.0.1', cloudOrigin = process.env.GFM_CLOUD_ORIGIN || DEFAULT_CLOUD_ORIGIN } = {}) {
  const origin = new URL(cloudOrigin).origin;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/gas' || pathname === '/api/gas/') return proxyApi(req, res, origin);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('GET/HEAD saja'); return; }
    return serveStatic(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCloudDevServer().then((server) => {
    const address = server.address();
    console.log(`[cloud-dev] http://localhost:${address.port} -> ${process.env.GFM_CLOUD_ORIGIN || DEFAULT_CLOUD_ORIGIN}/api/gas`);
  }).catch((error) => {
    console.error('[cloud-dev] gagal:', error.message);
    process.exitCode = 1;
  });
}
