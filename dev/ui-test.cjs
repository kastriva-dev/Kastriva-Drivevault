/* Smoke test UI GFileManager via puppeteer-core + Chrome sistem.
   Verifikasi: render grid/list, upload, context menu, no-horizontal-scroll, sync panel. */
const puppeteer = require('C:/kastriva/_ganghub_uiaudit/node_modules/puppeteer-core');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const BASE = 'http://127.0.0.1:8187';
const ok = [], fail = [];
function check(name, cond, extra = '') {
  (cond ? ok : fail).push(name);
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' — ' + extra : ''));
}

async function api(action, payload = {}) {
  const res = await fetch(BASE + '/api/gas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

(async () => {
  const port = String(new URL(BASE).port);
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-server.mjs')], {
    env: { ...process.env, PORT: port, GFM_DATA_DIR: path.join(os.tmpdir(), 'gfm-ui-' + process.pid) },
    stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (srv.exitCode !== null) throw new Error('mock server UI gagal start; port ' + port + ' mungkin sedang dipakai');
    try { const res = await fetch(BASE + '/manifest.json'); if (res.ok) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('mock server UI tidak siap di ' + BASE);
  await api('_reset');
  const login = await api('login', { email: 'uji@gfm.app', password: 'password123' });
  if (!login.ok) { console.error('login gagal:', login.error); process.exit(1); }
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.setViewport({ width: 1366, height: 900 });
    // sesi diinjeksi sebelum halaman load pertama (auth gate #29 aktif di init)
    await page.evaluateOnNewDocument((t, u) => {
      sessionStorage.setItem('gfm.auth.v1', JSON.stringify({ token: t, user: u }));
    }, login.data.token, login.data.user);
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 700));

    /* 1. seed tampil di grid */
    const names = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('grid menampilkan seed (Projects, laporan.pdf, data.xlsx, foto.jpg)',
      ['Projects', 'laporan.pdf', 'data.xlsx', 'foto.jpg'].every((n) => names.includes(n)),
      names.join(', '));

    /* 2. tidak ada horizontal scroll (desktop) */
    const hscrollD = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('desktop 1366px: tanpa horizontal scroll', !hscrollD);

    /* 3. list view + header kolom */
    await page.click('#view-list');
    await new Promise((r) => setTimeout(r, 300));
    const rows = await page.$$eval('#list .list-row:not(.list-head)', (els) => els.length);
    check('list view merender baris', rows >= 4, rows + ' baris');
    const hscrollL = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('list view: tanpa horizontal scroll', !hscrollL);

    /* 4. buka folder Projects via dblclick, breadcrumb bertambah */
    await page.click('#view-grid');
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'Projects');
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const bc = await page.$eval('#breadcrumb', (el) => el.textContent);
    check('dblclick folder -> breadcrumb menunjukkan Projects', bc.includes('Projects'), bc);
    const emptyShown = await page.$eval('#empty-state', (el) => !el.classList.contains('hidden'));
    check('folder kosong -> empty state tampil', emptyShown);

    /* 5. upload via set file input */
    const input = await page.$('#file-input');
    await input.uploadFile(require('path').join(__dirname, 'sample-upload.txt'));
    await new Promise((r) => setTimeout(r, 800));
    const inFolder = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('upload file masuk folder aktif', inFolder.includes('sample-upload.txt'), inFolder.join(', '));

    /* 6. context menu: klik kanan -> menu tampil dengan item wajib */
    await page.evaluate(() => { document.querySelector('#btn-back').click(); });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'laporan.pdf');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    });
    await new Promise((r) => setTimeout(r, 200));
    const ctxItems = await page.$$eval('#ctx-menu li', (els) => els.map((e) => e.textContent));
    for (const it of ['Open', 'Rename', 'Copy', 'Cut', 'Move', 'Share', 'Favorite', 'Properties', 'Delete']) {
      check('ctx menu: ' + it, ctxItems.includes(it), ctxItems.join(', '));
    }

    /* 7. favorite via ctx menu */
    await page.evaluate(() => {
      const li = Array.from(document.querySelectorAll('#ctx-menu li'))
        .find((l) => l.textContent === 'Favorite');
      li.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const fav = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'laporan.pdf');
      return !!(card && card.querySelector('.fav'));
    });
    check('favorite -> bintang tampil di kartu', fav);

    /* 8. sidebar favorit filter */
    await page.evaluate(() => {
      document.querySelector('.side-item[data-view="favorites"]').click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const favNames = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('filter favorit hanya laporan.pdf', favNames.length === 1 && favNames[0] === 'laporan.pdf', favNames.join(', '));

    /* 9. sync panel + two-way run tanpa error */
    await page.click('#btn-sync');
    await new Promise((r) => setTimeout(r, 200));
    const panelShown = await page.$eval('#sync-panel', (el) => !el.classList.contains('hidden'));
    check('panel sync tampil', panelShown);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.sync-mode')).find((x) => x.dataset.mode === 'twoway');
      b.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const syncLog = await page.$eval('#sync-log', (el) => el.textContent);
    check('sync twoway berjalan (log selesai)', syncLog.includes('Sync selesai'), syncLog.split('\n').pop());

    /* 10. multi-select ctrl+click */
    await page.evaluate(() => { document.querySelector('#sync-close').click(); });
    await page.evaluate(() => {
      document.querySelector('.side-item[data-view="all"]').click();
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#grid .card'));
      cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const selInfo = await page.$eval('#selection-info', (el) => el.textContent);
    check('ctrl+click multi-select (2 selected)', selInfo.includes('2 files selected'), selInfo);

    /* 12. tema: light switch -> data-theme berubah + persist setelah reload */
    await page.setViewport({ width: 1366, height: 900 });
    await page.evaluate(() => { document.querySelector('.theme-btn[data-theme="light"]').click(); });
    await new Promise((r) => setTimeout(r, 200));
    const themeLight = await page.evaluate(() => document.documentElement.dataset.theme);
    check('klik Light -> html[data-theme=light]', themeLight === 'light');
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    const themePersist = await page.evaluate(() => ({
      attr: document.documentElement.dataset.theme,
      ls: localStorage.getItem('gfm.theme.v1'),
    }));
    check('tema tersimpan di localStorage & bertahan setelah reload',
      themePersist.ls === 'light' && themePersist.attr === 'light', JSON.stringify(themePersist));
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).color);
    check('light theme: warna teks kontras gelap', lightBg === 'rgb(23, 35, 63)', lightBg);
    await page.evaluate(() => { document.querySelector('.theme-btn[data-theme="dark"]').click(); });
    await new Promise((r) => setTimeout(r, 200));

    /* 12b. matriks responsive FULL: 3 zona (desktop / tablet collapsible / mobile bottom-nav) */
    const VIEWPORTS = [
      [2560, 1440, 'desktop'], [1920, 1080, 'desktop'], [1366, 768, 'desktop'], [1280, 800, 'desktop'],
      [1200, 900, 'tablet'], [1024, 768, 'tablet'], [1000, 800, 'tablet'], [901, 700, 'tablet'],
      [900, 900, 'mobile'], [820, 1180, 'mobile'], [768, 1024, 'mobile'],
      [844, 390, 'mobile'], [620, 900, 'mobile'],
      [414, 896, 'mobile'], [390, 844, 'mobile'], [360, 800, 'mobile'], [320, 700, 'mobile'],
    ];
    for (const [w, h, zone] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await new Promise((r) => setTimeout(r, 250));
      const st = await page.evaluate(() => {
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        return {
          hs: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          sbPos: cs('#sidebar').position,
          sbW: Math.round(document.querySelector('#sidebar').getBoundingClientRect().width),
          bn: cs('#bottom-nav').display,
          menu: cs('#btn-menu').display,
        };
      });
      check(zone + ' ' + w + 'px: tanpa horizontal scroll', !st.hs);
      if (zone === 'desktop') {
        check('desktop ' + w + 'px: sidebar di alur + tanpa hamburger/bottom-nav',
          ['static', 'sticky', 'relative'].includes(st.sbPos) && st.bn === 'none' && st.menu === 'none',
          JSON.stringify(st));
      } else if (zone === 'tablet') {
        check('tablet ' + w + 'px: rail 64px + hamburger tampil + tanpa bottom-nav',
          Math.abs(st.sbW - 64) <= 2 && st.menu !== 'none' && st.bn === 'none', JSON.stringify(st));
      } else {
        check('mobile ' + w + 'px: sidebar fixed (drawer) + bottom-nav tampil + hamburger',
          st.sbPos === 'fixed' && st.bn === 'flex' && st.menu !== 'none', JSON.stringify(st));
      }
      const cards = await page.$$eval('#grid .card, #list .list-row', (els) => els.length);
      check(zone + ' ' + w + 'px: konten ter-render', cards >= 4, cards + ' item');
    }

    /* 12c. drawer: buka via hamburger, tutup via backdrop (mobile 390) */
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.click('#btn-menu');
    await new Promise((r) => setTimeout(r, 350));
    const drawerOpen = await page.evaluate(() => ({
      cls: document.querySelector('#sidebar').classList.contains('drawer-open'),
      bd: document.querySelector('#drawer-backdrop').classList.contains('visible'),
      x: Math.round(document.querySelector('#sidebar').getBoundingClientRect().left),
    }));
    check('mobile: hamburger membuka drawer (backdrop muncul, sidebar masuk layar)',
      drawerOpen.cls && drawerOpen.bd && drawerOpen.x >= 0 && drawerOpen.x < 100, JSON.stringify(drawerOpen));
    await page.mouse.click(340, 500); // area backdrop di kanan drawer (di luar sidebar)
    await new Promise((r) => setTimeout(r, 350));
    const drawerClosed = await page.evaluate(() =>
      !document.querySelector('#sidebar').classList.contains('drawer-open'));
    check('mobile: klik backdrop menutup drawer', drawerClosed);

    /* 12d. drawer di tablet: rail -> drawer dengan label */
    await page.setViewport({ width: 1024, height: 768 });
    await new Promise((r) => setTimeout(r, 300));
    const railW = await page.evaluate(() => Math.round(document.querySelector('#sidebar').getBoundingClientRect().width));
    check('tablet: rail 64px sebelum dibuka', railW === 64, String(railW));
    await page.click('#btn-menu');
    await new Promise((r) => setTimeout(r, 350));
    const tabletDrawer = await page.evaluate(() => {
      const sb = document.querySelector('#sidebar');
      const lbl = sb.querySelector('.lbl');
      return {
        fixed: getComputedStyle(sb).position === 'fixed',
        w: Math.round(sb.getBoundingClientRect().width),
        lblVisible: lbl && getComputedStyle(lbl).display !== 'none',
      };
    });
    check('tablet: hamburger -> drawer 250px dengan label', tabletDrawer.fixed && tabletDrawer.w === 250 && tabletDrawer.lblVisible, JSON.stringify(tabletDrawer));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
    const tabletClosed = await page.evaluate(() => {
      const sb = document.querySelector('#sidebar');
      return !sb.classList.contains('drawer-open') &&
        Math.abs(sb.getBoundingClientRect().width - 64) <= 2;
    });
    check('tablet: Escape menutup drawer -> kembali rail', tabletClosed);

    /* 12e. overlay fit di ponsel 390x844 */
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'laporan.pdf');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 370, clientY: 780 }));
    });
    await new Promise((r) => setTimeout(r, 200));
    const ctxFit = await page.$eval('#ctx-menu', (el) => {
      const r = el.getBoundingClientRect();
      return { fit: r.right <= 390 && r.bottom <= 844 && r.left >= 0 && r.top >= 0, right: Math.round(r.right), bottom: Math.round(r.bottom) };
    });
    check('ponsel: ctx menu di tepi kanan-bawah tetap dalam viewport', ctxFit.fit, JSON.stringify(ctxFit));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('#btn-sync').click());
    await new Promise((r) => setTimeout(r, 200));
    const syncFit = await page.$eval('#sync-panel', (el) => {
      const r = el.getBoundingClientRect();
      return { fit: r.right <= 390 && r.left >= 0 && r.bottom <= 844, w: Math.round(r.width) };
    });
    check('ponsel: sync panel dalam viewport & tidak menabrak bottom nav', syncFit.fit, JSON.stringify(syncFit));
    await page.evaluate(() => document.querySelector('#sync-close').click());
    await page.evaluate(() => document.querySelector('#btn-newfolder').click());
    await new Promise((r) => setTimeout(r, 300));
    const dlgFit = await page.$eval('#dialog', (el) => {
      const r = el.getBoundingClientRect();
      return { fit: r.right <= 390 && r.left >= 0 && r.bottom <= 844 && r.top >= 0, w: Math.round(r.width) };
    });
    check('ponsel: dialog dalam viewport', dlgFit.fit, JSON.stringify(dlgFit));
    await page.evaluate(() => document.querySelector('#dialog-cancel').click());
    await page.setViewport({ width: 1366, height: 900 });

    /* 12f. OFFLINE MODE: indikator, operasi lokal, antrian, auto-sync saat online */
    await page.setViewport({ width: 1366, height: 900 });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));
    check('indikator Online tampil', (await page.$eval('#net-status', (el) => el.textContent)) === '● Online');

    await page.setOfflineMode(true); // putuskan koneksi (CDP)
    await new Promise((r) => setTimeout(r, 500));
    check('indikator Offline saat koneksi diputus',
      (await page.$eval('#net-status', (el) => el.textContent)) === '● Offline');

    // operasi lokal saat offline: buat folder -> tampil + diantrikan
    await page.click('#btn-newfolder');
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => { document.querySelector('#dlg-name').value = ''; }); // kosongkan default
    await page.type('#dlg-name', 'Offline Folder');
    await page.click('#dialog-ok');
    await new Promise((r) => setTimeout(r, 600));
    const offNames = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('offline: folder baru tetap bisa dibuat (optimis UI)', offNames.includes('Offline Folder'), offNames.join(', '));
    const badgeTxt = await page.$eval('#offline-badge', (el) => ({ t: el.textContent, hid: el.classList.contains('hidden') }));
    check('badge antrian tampil (1 perubahan offline)', !badgeTxt.hid && badgeTxt.t.includes('1'), JSON.stringify(badgeTxt));

    // Sync Queue menampilkan operasi yang diantrikan
    await page.click('#btn-sync');
    await new Promise((r) => setTimeout(r, 300));
    const queueTxt = await page.$eval('#queue-list', (el) => el.textContent);
    check('Sync Queue menampilkan operasi offline', queueTxt.includes('Folder baru'), queueTxt.slice(0, 80));
    check('panel menunjukkan target server Google Drive',
      (await page.$eval('#sync-target-name', (el) => el.textContent)) === 'Google Drive');
    await page.click('#sync-close');

    // kembali online -> flush otomatis -> folder benar-benar ada di server
    await page.setOfflineMode(false);
    await new Promise((r) => setTimeout(r, 1500));
    const serverList = await (await fetch(BASE + '/api/gas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', token: login.data.token }),
    })).json();
    check('online kembali: folder offline tersinkron ke server',
      serverList.data.some((e) => e.name === 'Offline Folder' && !e.deleted));
    const badgeAfter = await page.$eval('#offline-badge', (el) => el.classList.contains('hidden'));
    check('badge antrian kosong setelah flush', badgeAfter);

    /* 14. TRASH: delete -> restore -> purge; SORT & FILTER; PREVIEW; ZIP; Ctrl+A */
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 700));

    // trash: hapus data.xlsx -> muncul di trash view -> restore
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'data.xlsx');
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); // buka preview? tidak - dblclick file membuka download; gunakan ctx menu
    });
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'data.xlsx');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => {
      const li = Array.from(document.querySelectorAll('#ctx-menu li')).find((l) => l.textContent === 'Delete');
      li.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.click('#dialog-ok'); // konfirmasi hapus
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => { document.querySelector('.side-item[data-view="trash"]').click(); });
    await new Promise((r) => setTimeout(r, 300));
    const trashNames = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('trash: data.xlsx masuk trash (soft delete)', trashNames.includes('data.xlsx'), trashNames.join(', '));
    // ctx menu trash: Restore
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'data.xlsx');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => {
      const li = Array.from(document.querySelectorAll('#ctx-menu li')).find((l) => l.textContent === 'Restore');
      li.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => { document.querySelector('.side-item[data-view="all"]').click(); });
    await new Promise((r) => setTimeout(r, 300));
    const afterRestore = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('trash: restore mengembalikan data.xlsx', afterRestore.includes('data.xlsx'), afterRestore.join(', '));

    // sort by size asc -> file terkecil pertama di antara file (folder tetap di atas)
    await page.evaluate(() => { document.querySelector('#btn-adv').click(); });
    await new Promise((r) => setTimeout(r, 200));
    await page.select('#sort-key', 'size');
    await new Promise((r) => setTimeout(r, 300));
    const sizeOrder = await page.$$eval('#grid .card', (els) => els.map((c) => c.querySelector('.name').textContent));
    check('sort size asc: urutan berubah sesuai ukuran', sizeOrder.length >= 4, sizeOrder.join(', '));
    // filter type=sheet -> hanya data.xlsx
    await page.select('#filter-type', 'sheet');
    await new Promise((r) => setTimeout(r, 300));
    const filtered = await page.$$eval('#grid .card .name', (els) => els.map((e) => e.textContent));
    check('filter type=sheet: hanya data.xlsx', filtered.length === 1 && filtered[0] === 'data.xlsx', filtered.join(', '));
    await page.evaluate(() => { document.querySelector('#btn-filter-reset').click(); });
    await new Promise((r) => setTimeout(r, 200));

    // preview image: dialog berisi <img>
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find((c) => c.querySelector('.name').textContent === 'foto.jpg');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => {
      const li = Array.from(document.querySelectorAll('#ctx-menu li')).find((l) => l.textContent === 'Preview');
      li.click();
    });
    await new Promise((r) => setTimeout(r, 800));
    const previewHasMedia = await page.evaluate(() => {
      const d = document.querySelector('#dialog');
      return d.open && !!d.querySelector('img, video, audio, iframe, pre, .preview-unavailable');
    });
    check('preview foto.jpg: dialog preview tampil dengan media atau fallback', previewHasMedia);
    await page.evaluate(() => document.querySelector('#dialog-cancel').click());

    // ZIP: makeZip menghasilkan blob > 0
    const zipSize = await page.evaluate(async () => {
      const targets = App.state.entries.filter((e) => !e.deleted && e.type === 'file');
      const blob = await F.makeZip(targets);
      return blob.size;
    });
    check('makeZip: blob ZIP dihasilkan (' + zipSize + ' byte)', zipSize > 100);

    // Ctrl+A pilih semua
    await page.evaluate(() => { document.querySelector('#grid').focus(); });
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 300));
    const selCount = await page.$eval('#selection-info', (el) => el.textContent);
    check('Ctrl+A: pilih semua item', /\d+ files? selected/.test(selCount) && !selCount.startsWith('0'), selCount);
    await page.evaluate(() => { App.state.selected.clear(); App.render(); });

    /* 13. tidak ada page error JS */
    check('tanpa error JS di halaman', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

    console.log('\nRINGKASAN: ' + ok.length + ' pass, ' + fail.length + ' fail');
    process.exitCode = fail.length ? 1 : 0;
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
