/* Uji modul API: proxy Vercel (api/gas.js) + rute halaman link publik /p/<token> di mock server.
   Proxy diuji dengan mengimpornya langsung (ESM) terhadap upstream HTTP tiruan. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GFM_DATA_DIR = process.env.GFM_DATA_DIR || path.join(os.tmpdir(), 'gfm-proxy-test-' + process.pid);
const { start } = await import(pathToFileURL(path.join(ROOT, 'dev', 'mock-server.mjs')));
const handler = (await import(pathToFileURL(path.join(ROOT, 'api', 'gas.js')))).default;

/* ---------- upstream Apps Script tiruan ---------- */
const upstream = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://up');
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (u.pathname === '/non-json') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login redirect</html>'); return; }
    let out;
    if (req.method === 'POST') {
      const p = JSON.parse(body || '{}');
      out = { ok: true, data: { action: p.action, token: p.token || null, parentId: p.parentId || null } };
    } else {
      out = { ok: true, data: { action: u.searchParams.get('action'), link: u.searchParams.get('link') } };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
  });
});
await new Promise((r) => upstream.listen(0, r));
process.env.GAS_URL = `http://127.0.0.1:${upstream.address().port}/exec`;
process.env.GAS_URL_BAD = `http://127.0.0.1:${upstream.address().port}/non-json`;

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null, sent: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (j) => { res.body = j; res.sent = true; return res; };
  res.send = (s) => { res.body = s; res.sent = true; return res; };
  return res;
}
const call = (req) => new Promise((r) => { const res = fakeRes(); Promise.resolve(handler(req, res)).then(() => r(res)); });

test.after(async () => { upstream.close(); });

test('proxy gas.js: POST diteruskan ke GAS_URL apa adanya', async () => {
  const res = await call({ method: 'POST', url: '/api/gas', body: { action: 'list', token: 'tok-123' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.action, 'list');
  assert.equal(res.body.data.token, 'tok-123');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('proxy gas.js: GET query diteruskan (jalur publicGet anonim)', async () => {
  const res = await call({ method: 'GET', url: '/api/gas?action=publicGet&link=abc123' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.action, 'publicGet');
  assert.equal(res.body.data.link, 'abc123');
});

test('proxy gas.js: method lain -> 405', async () => {
  const res = await call({ method: 'PUT', url: '/api/gas', body: {} });
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.ok, false);
});

test('proxy gas.js: upstream non-JSON -> 502 terstruktur (bukan crash)', async () => {
  process.env.GAS_URL = process.env.GAS_URL_BAD;
  const res = await call({ method: 'POST', url: '/api/gas', body: { action: 'list' } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /bukan JSON|HTTP/);
  process.env.GAS_URL = `http://127.0.0.1:${upstream.address().port}/exec`;
});

test('proxy gas.js: GAS_URL tidak diset -> 500 dengan pesan jelas', async () => {
  const saved = process.env.GAS_URL;
  delete process.env.GAS_URL;
  const res = await call({ method: 'POST', url: '/api/gas', body: { action: 'list' } });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /GAS_URL/);
  if (saved) process.env.GAS_URL = saved;
});

/* ---------- mock server: rute /p/<token> ---------- */
const srv = await start(8288);
const BASE = 'http://127.0.0.1:8288';
test.after(async () => { srv.close(); });

async function api(action, payload = {}) {
  const r = await fetch(BASE + '/api/gas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return r.json();
}

test('rute /p/<token>: menyajikan halaman link publik (anonim)', async () => {
  const r = await fetch(BASE + '/p/sometoken1234567890');
  assert.equal(r.status, 200);
  const ct = r.headers.get('content-type') || '';
  assert.match(ct, /text\/html/);
  const html = await r.text();
  assert.match(html, /Link Berbagi/, 'judul halaman hilang');
  assert.match(html, /publicGet/, 'halaman harus memanggil publicGet');
  assert.match(html, /TOKEN_RE/, 'validasi format token di client wajib ada');
});

test('rute /p/ tidak membuka path traversal', async () => {
  const r = await fetch(BASE + '/p/..%2f..%2fdev%2f.data%2ffs.json');
  // decode -> /p/../../dev/.data/fs.json tetap dipaksa ke /p/index.html
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Link Berbagi/, 'harus fallback ke halaman publik, bukan file db');
  assert.ok(!html.includes('"users"'), 'isi fs.json tidak boleh bocor');
});

test('satu putaran publik penuh via API mock: public -> publicGet anonim -> cabut', async () => {
  await api('_reset');
  const login = await api('login', { email: 'uji@gfm.app', password: 'password123' });
  assert.ok(login.ok);
  const tok = login.data.token;
  const up = await api('upload', { token: tok, parentId: 'root', name: 'uji-proxy.txt', mime: 'text/plain',
    dataUrl: 'data:text/plain;base64,' + Buffer.from('isi uji').toString('base64') });
  assert.ok(up.ok, up.error);
  const pub = await api('share', { token: tok, id: up.data.id, mode: 'public' });
  assert.ok(pub.ok, pub.error);
  const link = pub.data.share.publicToken;
  const anon = await (await fetch(BASE + '/api/gas?action=publicGet&link=' + link)).json();
  assert.ok(anon.ok, anon.error);
  assert.equal(anon.data.name, 'uji-proxy.txt');
  assert.match(anon.data.dataUrl, /^data:text\/plain/);
  const off = await api('share', { token: tok, id: up.data.id, mode: 'private' });
  assert.ok(off.ok);
  const dead = await (await fetch(BASE + '/api/gas?action=publicGet&link=' + link)).json();
  assert.equal(dead.ok, false, 'token lama harus mati setelah dicabut');
});

test('kontrak: daftar action mock server == daftar action Code.gs (parity modul API)', async () => {
  const fs = await import('node:fs');
  const mock = fs.readFileSync(path.join(ROOT, 'dev', 'mock-server.mjs'), 'utf8');
  const gs = fs.readFileSync(path.join(ROOT, 'gas', 'Code.gs'), 'utf8');
  const of = (src) => new Set([...src.matchAll(/case '([a-zA-Z_]+)':/g)].map((m) => m[1]));
  const a = of(mock), b = of(gs);
  // Code.gs bolehSubset (mis. purge/restore ada keduanya); yang wajib: semua aksi publik + share
  for (const act of ['list', 'upload', 'createFolder', 'rename', 'move', 'favorite', 'delete', 'restore',
    'purge', 'emptyTrash', 'download', 'share', 'shareInfo', 'publicGet']) {
    assert.ok(a.has(act), 'mock kehilangan action: ' + act);
    assert.ok(b.has(act), 'Code.gs kehilangan action: ' + act);
  }
  // sharedList hanya masuk akal di backend multi-user (mock); selain itu harus sama
  const onlyMock = [...a].filter((x) => !b.has(x) && !['sharedList', 'register', 'login', 'logout', 'me', 'quota', '_reset'].includes(x));
  assert.deepEqual(onlyMock, [], 'aksi mock tidak punya padanan di Code.gs: ' + onlyMock.join(', '));
});
