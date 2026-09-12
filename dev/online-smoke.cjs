/* Smoke test aman untuk deployment production: tidak membuat atau mengubah data. */
const puppeteer = require('C:/kastriva/_ganghub_uiaudit/node_modules/puppeteer-core');

const BASE = process.env.GFM_ONLINE_URL || 'https://kastriva-drivevault.vercel.app';
let fails = 0;
function check(name, condition, extra = '') {
  console.log((condition ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' — ' + extra : ''));
  if (!condition) fails += 1;
}

(async () => {
  const home = await fetch(BASE + '/');
  check('halaman production dapat diakses', home.status === 200, 'HTTP ' + home.status);

  const invalidLogin = await fetch(BASE + '/api/gas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'login',
      email: '__healthcheck_invalid__@example.invalid',
      password: 'invalid-healthcheck',
    }),
  });
  const apiBody = await invalidLogin.json().catch(() => null);
  check('Vercel /api/gas terhubung ke GAS dan membalas JSON',
    invalidLogin.status === 200 && apiBody && apiBody.ok === false &&
      !/GAS_URL|upstream|respons.*JSON/i.test(String(apiBody.error || apiBody.message || '')),
    JSON.stringify(apiBody));

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#auth-overlay:not(.hidden)', { timeout: 15000 });
    check('UI production memuat form login', await page.evaluate(() =>
      !!document.querySelector('#auth-email') && !!document.querySelector('#auth-pass')));
    check('production tidak mengalami error JavaScript', errors.length === 0, errors.join(' | '));

    await page.setViewport({ width: 390, height: 844 });
    const horizontal = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('form login mobile tanpa horizontal scroll', !horizontal);
  } finally {
    await browser.close();
  }
  console.log('RINGKASAN ONLINE: ' + (fails ? fails + ' fail' : 'semua pass'));
  process.exitCode = fails ? 1 : 0;
})().catch((error) => {
  console.error('FATAL', error);
  process.exitCode = 1;
});
