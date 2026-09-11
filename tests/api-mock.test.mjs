/* Uji API mock server: CRUD lengkap via HTTP + reset data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* data terisolasi per-file-test: dua instance mock (8277 di sini + 8288/8190 di file/check lain)
   tidak boleh saling timpa dev/.data */
process.env.GFM_DATA_DIR = process.env.GFM_DATA_DIR || path.join(os.tmpdir(), 'gfm-test-' + process.pid);
const { start, resetData, sanitizeName } = await import(pathToFileURL(path.join(ROOT, 'dev', 'mock-server.mjs')));

const srv = await start(8277);
const BASE = 'http://127.0.0.1:8277/api/gas';

let TOKEN = null; // #29 auth: semua action non-public wajib token sesi
async function api(action, payload = {}) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(TOKEN ? { token: TOKEN } : {}), ...payload }),
  });
  return res.json();
}

test.after(async () => { srv.close(); });

test('login demo user -> token sesi valid (auth gate #29)', async () => {
  const noAuth = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }).then((r) => r.json());
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.error, /unauthorized/);
  const bad = await api('login', { email: 'uji@gfm.app', password: 'salah' });
  assert.equal(bad.ok, false);
  const r = await api('login', { email: 'uji@gfm.app', password: 'password123' });
  assert.ok(r.ok, r.error);
  assert.ok(r.data.token);
  TOKEN = r.data.token;
});

test('reset: seed Projects/laporan.pdf/data.xlsx/foto.jpg', async () => {
  const r = await api('_reset');
  assert.ok(r.ok);
  const list = await api('list');
  const names = list.data.map((e) => e.name).sort();
  assert.deepEqual(names, ['Projects', 'data.xlsx', 'foto.jpg', 'laporan.pdf']);
  const projects = list.data.find((e) => e.name === 'Projects');
  assert.equal(projects.type, 'folder');
});

test('upload + download roundtrip base64 utuh', async () => {
  await api('_reset');
  const dataUrl = 'data:text/plain;base64,' + Buffer.from('hello gfm').toString('base64');
  const up = await api('upload', { parentId: 'root', name: 'uji.txt', mime: 'text/plain', dataUrl });
  assert.ok(up.ok, up.error);
  assert.equal(up.data.size, 9);
  const dl = await api('download', { id: up.data.id });
  assert.ok(dl.ok, dl.error);
  assert.equal(Buffer.from(dl.data.dataUrl.split(',')[1], 'base64').toString(), 'hello gfm');
});

test('upload nama sama di folder sama -> replace (bukan duplikat), version naik', async () => {
  await api('_reset');
  const mk = (s) => 'data:text/plain;base64,' + Buffer.from(s).toString('base64');
  const a = await api('upload', { parentId: 'root', name: 'dup.txt', mime: 'text/plain', dataUrl: mk('v1') });
  const b = await api('upload', { parentId: 'root', name: 'dup.txt', mime: 'text/plain', dataUrl: mk('v2-lebih-panjang') });
  assert.equal(b.data.id, a.data.id);
  assert.equal(b.data.version, a.data.version + 1);
  const list = await api('list');
  assert.equal(list.data.filter((e) => e.name === 'dup.txt' && !e.deleted).length, 1);
});

test('createFolder + uniqueName (+1) saat nama bentrok', async () => {
  await api('_reset');
  const f1 = await api('createFolder', { parentId: 'root', name: 'Docs' });
  const f2 = await api('createFolder', { parentId: 'root', name: 'Docs' });
  assert.ok(f1.ok && f2.ok);
  assert.equal(f2.data.name, 'Docs (1)');
});

test('delete folder -> anak ikut soft-delete', async () => {
  await api('_reset');
  const f = await api('createFolder', { parentId: 'root', name: 'Parent' });
  const dataUrl = 'data:text/plain;base64,' + Buffer.from('x').toString('base64');
  const u = await api('upload', { parentId: f.data.id, name: 'anak.txt', mime: 'text/plain', dataUrl });
  const del = await api('delete', { ids: [f.data.id] });
  assert.ok(del.ok);
  assert.equal(del.data, 2); // parent + anak
  const list = await api('list');
  const anak = list.data.find((e) => e.id === u.data.id);
  assert.equal(anak.deleted, true);
});

test('move + rename + favorite', async () => {
  await api('_reset');
  const folder = await api('createFolder', { parentId: 'root', name: 'Tujuan' });
  const dataUrl = 'data:text/plain;base64,' + Buffer.from('m').toString('base64');
  const u = await api('upload', { parentId: 'root', name: 'pindah.txt', mime: 'text/plain', dataUrl });
  const mv = await api('move', { ids: [u.data.id], parentId: folder.data.id });
  assert.ok(mv.ok, mv.error);
  const rn = await api('rename', { id: u.data.id, name: 'sudah-dipindah.txt' });
  assert.equal(rn.data.name, 'sudah-dipindah.txt');
  const fav = await api('favorite', { id: u.data.id, on: true });
  assert.equal(fav.data.favorite, true);
  // cegah folder masuk dirinya sendiri
  const bad = await api('move', { ids: [folder.data.id], parentId: folder.data.id });
  assert.ok(!bad.ok);
});

test('action tidak dikenal -> error jelas', async () => {
  const r = await api('ngasal');
  assert.equal(r.ok, false);
  assert.match(r.error, /tidak dikenal/);
});

/* ---------- #32 FILE NAME SECURITY ---------- */
test('sanitizeName: path traversal & karakter berbahaya dinetralkan', async () => {
  const cases = [
    ['../evil', 'evil'],
    ['..\\..\\Windows\\system32', 'Windowssystem32'],
    ['a/b/c.txt', 'abc.txt'],
    ['rap.mp3\u0000.exe', 'rap.mp3.exe'],
    ['con.txt', '_con.txt'],
    ['nul', '_nul'],
    ['.hidden', 'hidden'],
    ['trailing. ', 'trailing'],
    ['', 'tanpa-nama'],
    ['   ', 'tanpa-nama'],
    ['ok name.txt', 'ok name.txt'],
    ['laporan "kutip".pdf', 'laporan kutip.pdf'],
    ['a<b>c|d?e*f:g/h"i', 'abcdefghi'],
  ];
  for (const [input, want] of cases) {
    assert.equal(sanitizeName(input), want, 'input=' + JSON.stringify(input));
  }
});

test('upload/rename/createFolder dengan nama berbahaya -> tersimpan bersih, blob tidak keluar FILES_DIR', async () => {
  await api('_reset');
  const dataUrl = 'data:text/plain;base64,' + Buffer.from('payload').toString('base64');
  const up = await api('upload', { parentId: 'root', name: '../../outside.txt', mime: 'text/plain', dataUrl });
  assert.ok(up.ok, up.error);
  assert.equal(up.data.name, 'outside.txt');
  const filesDir = path.join(process.env.GFM_DATA_DIR, 'files'); // dir data instance test ini
  assert.ok(fs.existsSync(path.join(filesDir, up.data.id)), 'blob ada di FILES_DIR');
  const outside = path.join(ROOT, '..', 'outside.txt');
  assert.ok(!fs.existsSync(outside), 'tidak boleh menulis di luar workspace');
  const rn = await api('rename', { id: up.data.id, name: '..\\..\\evil.txt' });
  assert.equal(rn.data.name, 'evil.txt');
  const f = await api('createFolder', { parentId: 'root', name: '../Pwn' });
  assert.equal(f.data.name, 'Pwn');
});

/* ---------- #30 SHARING ---------- */
test('share: default private, public butuh mode eksplisit + token, cabut = private', async () => {
  await api('_reset');
  const dataUrl = 'data:text/plain;base64,' + Buffer.from('rahasia').toString('base64');
  const up = await api('upload', { parentId: 'root', name: 'rahasia.txt', mime: 'text/plain', dataUrl });
  const info0 = await api('shareInfo', { id: up.data.id });
  assert.equal(info0.data.share.mode, 'private'); // tidak pernah public otomatis
  const bad = await api('share', { id: up.data.id, mode: 'public-others' });
  assert.equal(bad.ok, false);
  const pub = await api('share', { id: up.data.id, mode: 'public' });
  assert.ok(pub.ok, pub.error);
  const tok = pub.data.share.publicToken;
  assert.ok(tok && /^[0-9a-f]{32}$/.test(tok));
  // anonim GET via token harus bisa membaca TANPA login
  const anon = await fetch(BASE + '?action=publicGet&link=' + tok).then((r) => r.json());
  assert.ok(anon.ok, anon.error);
  assert.equal(Buffer.from(anon.data.dataUrl.split(',')[1], 'base64').toString(), 'rahasia');
  // link token lama mati saat di-public ulang
  const pub2 = await api('share', { id: up.data.id, mode: 'public' });
  assert.notEqual(pub2.data.share.publicToken, tok);
  const stale = await fetch(BASE + '?action=publicGet&link=' + tok).then((r) => r.json());
  assert.equal(stale.ok, false);
  // cabut -> private, semua link mati, blob masih utuh utk pemilik
  const off = await api('share', { id: up.data.id, mode: 'private' });
  assert.ok(off.ok);
  assert.equal(off.data.share.publicToken, undefined);
  const gone = await fetch(BASE + '?action=publicGet&link=' + pub2.data.share.publicToken).then((r) => r.json());
  assert.equal(gone.ok, false);
  const dl = await api('download', { id: up.data.id });
  assert.ok(dl.ok);
});

test('share: mode shared butuh email terdaftar; role default viewer (least privilege)', async () => {
  await api('_reset');
  const dataUrl = 'data:text/plain;base64,' + Buffer.from('x').toString('base64');
  const up = await api('upload', { parentId: 'root', name: 'kolab.txt', mime: 'text/plain', dataUrl });
  const nope = await api('share', { id: up.data.id, mode: 'shared', emails: 'hantu@nowhere.app' });
  assert.equal(nope.ok, false);
  const empty = await api('share', { id: up.data.id, mode: 'shared', emails: '' });
  assert.equal(empty.ok, false);
  const ok = await api('share', { id: up.data.id, mode: 'shared', emails: 'Uji@GFM.app' });
  assert.ok(ok.ok, ok.error);
  assert.equal(ok.data.share.withUsers[0].role, 'viewer');
  assert.equal(ok.data.share.withUsers[0].email, 'uji@gfm.app'); // dinormalisasi lowercase
});
