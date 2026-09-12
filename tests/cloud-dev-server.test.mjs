import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { startCloudDevServer } = await import(pathToFileURL(path.join(ROOT, 'dev', 'cloud-server.mjs')));

test('cloud dev server menyajikan web lokal dan meneruskan API ke backend cloud yang sama', async (t) => {
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, method: req.method, path: req.url, body: JSON.parse(body || '{}') }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());

  const cloudOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const server = await startCloudDevServer({ port: 0, host: '127.0.0.1', cloudOrigin });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Kastriva-DriveVault/);

  const api = await fetch(base + '/api/gas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list', token: 'same-cloud-token' }),
  });
  assert.equal(api.status, 200);
  assert.match(api.headers.get('cache-control') || '', /no-store/);
  const result = await api.json();
  assert.equal(result.method, 'POST');
  assert.equal(result.path, '/api/gas');
  assert.deepEqual(result.body, { action: 'list', token: 'same-cloud-token' });
});
