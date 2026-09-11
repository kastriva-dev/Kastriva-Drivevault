/* Verifikasi manual #30/#33: login UI -> context menu Share -> set Public -> token muncul -> toast varian -> cabut ke Private.
   Pakai PORT server 8178 (server dev 8177 tidak diganggu). */
const puppeteer = require('C:/kastriva/_ganghub_uiaudit/node_modules/puppeteer-core');
const BASE = 'http://127.0.0.1:8177';

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await b.newPage();
  // clipboard API butuh izin eksplisit di headless
  await b.defaultBrowserContext().overridePermissions(BASE, ['clipboard-sanitized-write']);
  await page.setViewport({ width: 1280, height: 800 });
  // matikan service worker agar tidak ada navigasi ganda dari cache/SW skipWaiting
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'serviceWorker', { get: () => ({ register: async () => {}, getRegistration: async () => undefined, getRegistrations: async () => [] }) });
  });
  let fails = 0;
  const check = (name, cond, extra = '') => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? ' | ' + extra : '')); if (!cond) fails++; };

  // mulai dari data bersih (sesi aktif tidak ikut ter-reset oleh _reset)
  await fetch(BASE + '/api/gas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: '_reset' }) }).then((x) => x.json());
  // login via API lalu injeksi sesi SEBELUM load pertama (tanpa reload)
  const r = await fetch(BASE + '/api/gas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: 'uji@gfm.app', password: 'password123' }) }).then((x) => x.json());
  check('login API', r.ok, r.error || '');
  await page.evaluateOnNewDocument((tok, user) => { localStorage.setItem('gfm.auth.v1', JSON.stringify({ token: tok, user })); }, r.data.token, r.data.user);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForSelector('#grid .card .name', { timeout: 15000 });
  check('sesi injeksi -> grid tampil', true);
  const token = r.data.token;
  check('token sesi tersedia', !!token);

  // context menu pada laporan.pdf
  const clickShare = async () => {
    const box = await (await page.evaluateHandle(() => Array.from(document.querySelectorAll('.card')).find((el) => /laporan\.pdf/.test(el.textContent)))).asElement().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForFunction(() => !document.querySelector('#ctx-menu').classList.contains('hidden'), { timeout: 5000 });
    await page.evaluate(() => Array.from(document.querySelectorAll('#ctx-menu li')).find((li) => li.textContent === 'Share').click());
    await page.waitForFunction(() => document.querySelector('#dialog').open && document.querySelector('#share-hint'), { timeout: 5000 });
  };
  await clickShare();
  check('dialog Share tampil', await page.evaluate(() => /laporan\.pdf/.test(document.querySelector('#dialog-title').textContent)));
  check('default Private terpilih', await page.evaluate(() => document.querySelector('input[name="share-mode"][value="private"]').checked));
  check('hint private tampil', await page.evaluate(() => document.querySelector('#share-hint').textContent.includes('tidak dapat diakses')));

  // pilih Public -> Terapkan
  await page.click('input[name="share-mode"][value="public"]');
  check('link box visible saat public', await page.evaluate(() => !document.querySelector('#share-link').classList.contains('hidden')));
  await page.click('#dialog-ok');
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('toast-success'), { timeout: 5000 });
  check('toast sukses varian success', await page.evaluate(() => /Link publik dibuat/.test(document.querySelector('#toast').textContent)));

  // token tersimpan di server + anonim bisa akses
  const info = await page.evaluate(async (tok) => {
    const id = App.state.entries.find((e) => e.name === 'laporan.pdf').id;
    return MM.api.call('shareInfo', { id, token: tok });
  }, token);
  check('shareInfo mode public', info.data.share.mode === 'public');
  const pubTok = info.data.share.publicToken;
  const anon = await fetch(BASE + '/api/gas?action=publicGet&link=' + pubTok).then((x) => x.json());
  check('publicGet anonim OK', anon.ok && !!anon.data.dataUrl, anon.error || '');

  // buka lagi dialog: radio public terpilih + URL token tampil
  await new Promise((r) => setTimeout(r, 400));
  await clickShare();
  check('state public dipertahankan + URL tampil', await page.evaluate((t) =>
    document.querySelector('input[name="share-mode"][value="public"]').checked &&
    document.querySelector('#share-url').value.includes(t.slice(0, 8)), pubTok));

  // cabut -> private, link mati
  await page.click('input[name="share-mode"][value="private"]');
  await page.click('#dialog-ok');
  await page.waitForFunction(() => /Private/.test(document.querySelector('#toast').textContent), { timeout: 5000 });
  const anon2 = await fetch(BASE + '/api/gas?action=publicGet&link=' + pubTok).then((x) => x.json());
  check('link dicabut -> ditolak', anon2.ok === false);

  // toast varian error
  const errKind = await page.evaluate(() => { App.toast('gagal', 'error'); return document.querySelector('#toast').className; });
  check('toast error varian', errKind.includes('toast-error'), errKind);

  console.log('== ' + (fails ? fails + ' FAIL' : 'ALL PASS') + ' ==');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
