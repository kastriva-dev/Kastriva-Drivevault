/* Uji end-to-end modul API: share public -> visitor anonim buka /p/<token> -> lihat nama + unduh.
   Start sendiri mock server di PORT 8190 agar instance dev 8177 tidak terganggu. */
const puppeteer = require('C:/kastriva/_ganghub_uiaudit/node_modules/puppeteer-core');
const { spawn } = require('node:child_process');
const path = require('node:path');
const BASE = 'http://127.0.0.1:8190';
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? ' | ' + x : '')); if (!c) fails++; };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-server.mjs')],
    { env: { ...process.env, PORT: '8190', GFM_DATA_DIR: path.join(require('node:os').tmpdir(), 'gfm-publink-' + process.pid) }, stdio: 'ignore' });
  // tunggu siap (poll ringan, max 8s)
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/manifest.json'); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
  // siapkan data bersih + file publik lewat API (token sesi owner)
  const j = (a, p = {}) => fetch(BASE + '/api/gas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: a, ...p }) }).then((r) => r.json());
  await j('_reset');
  const login = await j('login', { email: 'uji@gfm.app', password: 'password123' });
  const tok = login.data.token;
  const up = await j('upload', { token: tok, parentId: 'root', name: 'uji-link.txt', mime: 'text/plain',
    dataUrl: 'data:text/plain;base64,' + Buffer.from('isi link publik').toString('base64') });
  check('upload file uji', up.ok, up.error || '');
  const pub = await j('share', { token: tok, id: up.data.id, mode: 'public' });
  check('share public', pub.ok && !!pub.data.share.publicToken, pub.error || '');
  const link = pub.data.share.publicToken;

  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: 900, height: 700 });

  // visitor ANONIM: tanpa localStorage sesi sama sekali
  await page.goto(BASE + '/p/' + link, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => /uji-link\.txt/.test(document.getElementById('title').textContent), { timeout: 8000 })
    .catch(() => {});
  check('anonim: halaman /p/<token> tampil nama file', await page.evaluate(() =>
    document.getElementById('title').textContent === 'uji-link.txt'));
  check('anonim: metadata ukuran/mime tampil', await page.evaluate(() =>
    /text\/plain/.test(document.getElementById('meta').textContent)));
  check('anonim: tombol Unduh ada', await page.evaluate(() => !!document.getElementById('dl')));

  // unduh: klik -> blob download ter-trigger (intercept via CDP)
  const dl = await page.evaluate(() => new Promise((res) => {
    const orig = HTMLAnchorElement.prototype.click;
    let got = null;
    HTMLAnchorElement.prototype.click = function () { if (this.download) got = { name: this.download, href: (this.href || '').slice(0, 5) }; return orig.call(this); };
    document.getElementById('dl').click();
    setTimeout(() => { HTMLAnchorElement.prototype.click = orig; res(got); }, 300);
  }));
  check('unduh: anchor download memakai nama file', dl && dl.name === 'uji-link.txt' && dl.href === 'blob:', JSON.stringify(dl));
  check('tanpa error JS di halaman publik', errs.length === 0, errs.join(' ; '));

  // token sampah -> status ditolak rapi
  await page.goto(BASE + '/p/DEADBEAFdeadbeef0011', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => /Link tidak tersedia/.test(document.getElementById('title').textContent), { timeout: 6000 }).catch(() => {});
  check('token salah: pesan "Link tidak tersedia"', await page.evaluate(() =>
    /Link tidak tersedia/.test(document.getElementById('title').textContent)));

  // cabut -> halaman menunjukkan unavailable
  await j('share', { token: tok, id: up.data.id, mode: 'private' });
  await page.goto(BASE + '/p/' + link, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => /tidak valid|dicabut|tidak tersedia/i.test(document.body.textContent), { timeout: 6000 }).catch(() => {});
  check('setelah dicabut: link mati, halaman menolak', await page.evaluate(() =>
    /Link tidak tersedia/i.test(document.getElementById('title').textContent)));

  console.log('== ' + (fails ? fails + ' FAIL' : 'ALL PASS') + ' ==');
  await b.close();
  process.exitCode = fails ? 1 : 0;
  } finally { srv.kill(); }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
