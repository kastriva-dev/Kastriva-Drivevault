/* Validasi aset PWA: manifest, service worker, ikon, dan aturan no-horizontal-scroll. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('manifest.json: installable (name, icons 192+512, standalone)', () => {
  const m = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.ok(m.name && m.short_name);
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), 'butuh ikon 192');
  assert.ok(sizes.includes('512x512'), 'butuh ikon 512');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'butuh ikon maskable');
  for (const i of m.icons) {
    const p = path.join(ROOT, i.src);
    assert.ok(existsSync(p), 'ikon hilang: ' + i.src);
    assert.ok(statSync(p).size > 100, 'ikon kosong: ' + i.src);
  }
});

test('sw.js: precache shell + fallback offline', () => {
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /const CACHE = /);
  assert.match(sw, /index\.html/);
  assert.match(sw, /addEventListener\('fetch'/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  for (const asset of ['css/app.css', 'js/core.js', 'js/app-main.js', 'manifest.json']) {
    assert.ok(sw.includes(asset), 'shell tidak memuat ' + asset);
  }
});

test('index.html: lengkap (manifest, sw, grid+list, ctx menu, sync panel)', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /js\/app-sync\.js/);
  assert.match(html, /id="grid"/);
  assert.match(html, /id="list"/);
  assert.match(html, /id="ctx-menu"/);
  assert.match(html, /sync-mode/);
  assert.match(html, /btn-install/);
  assert.match(html, /data:.*dataView|data-view/);
});

test('CSS: tanpa horizontal scroll (overflow-x hidden, grid fluid, minmax(0))', () => {
  const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /minmax\(0,\s*1fr\)/); // kolom list bisa menyusut
  assert.match(css, /auto-fill,\s*minmax/); // grid fluid
  assert.ok(!/overflow-x:\s*(auto|scroll)/.test(css), 'dilarang overflow-x auto/scroll');
});

test('dark/light theme: tersedia Dark/Light/System + persist + anti-FOUC', () => {
  const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  assert.match(css, /html\[data-theme="light"\]/, 'variabel light theme');
  const blurDecls = css.match(/backdrop-filter:[^;]+/g) || [];
  assert.ok(blurDecls.length >= 4, 'backdrop-filter dipakai di panel utama: ' + blurDecls.length);
  // semua blur via var(--blur) — tidak ada nilai piksel hardcoded (readability terkontrol per tema)
  const hard = blurDecls.filter((d) => /blur\(\s*\d/.test(d));
  assert.equal(hard.length, 0, 'blur harus var(--blur), tidak boleh angka: ' + hard.join(';'));
  assert.match(css, /--blur:\s*1[04]px/, 'nilai blur moderat');

  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const t of ['data-theme="dark"', 'data-theme="light"', 'data-theme="system"']) {
    assert.ok(html.includes(t), 'tombol tema: ' + t);
  }
  assert.match(html, /gfm\.theme\.v1/, 'anti-FOUC membaca key tema');
  assert.match(html, /js\/theme\.js/);

  const themeJs = readFileSync(path.join(ROOT, 'js', 'theme.js'), 'utf8');
  assert.match(themeJs, /localStorage\.setItem\(KEY/, 'pilihan disimpan ke localStorage');
  assert.match(themeJs, /prefers-color-scheme/, 'mode system mengikuti OS');

  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /js\/theme\.js/, 'theme.js masuk precache shell');
});

test('offline mode: sw cache + indikator + IndexedDB queue', () => {
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /js\/offline\.js/, 'offline.js masuk precache');

  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /● Online/, 'indikator Online');
  assert.match(html, /● Offline/, 'indikator Offline harus tersedia eksplisit');
  assert.match(html, /offline-badge/, 'badge antrian offline');
  assert.match(html, /id="queue-list"/, 'Sync Queue UI');
  assert.match(html, /sync-target-name/, 'label server (Google Drive)');

  const off = readFileSync(path.join(ROOT, 'js', 'offline.js'), 'utf8');
  assert.match(off, /indexedDB\.open/, 'local cache pakai IndexedDB');
  assert.match(off, /enqueue/, 'antrian offline changes');
  assert.match(off, /flushQueue/, 'flush saat online kembali');
  assert.match(off, /addEventListener\('online'/, 'deteksi koneksi kembali');
  assert.match(off, /net-status/, 'modul offline harus memperbarui indikator utama');
});

test('GAS Code.gs: semua action tersedia', () => {
  const gs = readFileSync(path.join(ROOT, 'gas', 'Code.gs'), 'utf8');
  for (const a of ['list', 'upload', 'delete', 'createFolder', 'rename', 'move', 'favorite', 'download',
    'share', 'shareInfo', 'publicGet']) {
    assert.ok(gs.includes(`'${a}'`), 'action hilang: ' + a);
  }
  const drive = readFileSync(path.join(ROOT, 'gas', 'DriveService.gs'), 'utf8');
  assert.ok(drive.includes('DriveApp'), 'DriveService harus memakai DriveApp');
  // #31/#32: sanitasi nama juga wajib ada di backend (parity dengan mock)
  assert.ok(gs.includes('sanitizeName_'), 'sanitizeName_ hilang');
  assert.match(gs, /uniqueName_\(db, e\.parentId, sanitizeName_\(/, 'rename tidak men-sanitize nama');
});
