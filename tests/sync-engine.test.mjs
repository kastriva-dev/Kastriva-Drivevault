/* Uji sync engine: rencana & eksekusi, anti-overwrite (konflik ditahan via MMConflicts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* sync.js adalah IIFE browser (window.MM) — muat manual di Node + stub MMConflicts */
const recorded = [];
globalThis.window = {
  MM: {},
  MMConflicts: {
    record: async (entryId, le, ce) => { recorded.push({ entryId, le, ce }); },
    remove: async () => {},
  },
};
(0, eval)(readFileSync(path.join(ROOT, 'js', 'sync.js'), 'utf8'));
const sync = window.MM.sync;
assert.ok(sync, 'MM.sync harus termuat');

const E = (id, modified, version = 1, extra = {}) => (
  { id, name: id, type: 'file', parentId: 'root', size: 10, mime: 'text/plain', deleted: false, version, modified, ...extra });

test('isNewer: modified terbaru menang; seri -> version lebih tinggi', () => {
  assert.ok(sync.isNewer(E('a', '2026-01-02T00:00:00Z'), E('a', '2026-01-01T00:00:00Z')));
  assert.ok(!sync.isNewer(E('a', '2026-01-01T00:00:00Z'), E('a', '2026-01-02T00:00:00Z')));
  assert.ok(sync.isNewer(E('a', '2026-01-01T00:00:00Z', 2), E('a', '2026-01-01T00:00:00Z', 1)));
});

test('plan local2cloud: lokal lebih baru -> push; cloud lebih baru -> konflik (ditahan)', () => {
  const L = [E('a', '2026-01-02T00:00:00Z'), E('b', '2026-01-01T00:00:00Z')];
  const C = [E('a', '2026-01-01T00:00:00Z'), E('b', '2026-01-03T00:00:00Z')];
  const p = sync.plan(L, C, 'local2cloud');
  assert.deepEqual(p.pushes, ['a']);
  assert.equal(p.conflicts.length, 1);
  assert.equal(p.conflicts[0].id, 'b');
  assert.equal(p.conflicts[0].side, 'cloud'); // cloud lebih baru, TIDAK ditimpa
});

test('plan cloud2local: entri hanya di cloud -> pull; hanya di lokal -> hapus lokal (mirror)', () => {
  const L = [E('stale', '2026-01-01T00:00:00Z')];
  const C = [E('baru', '2026-01-02T00:00:00Z')];
  const p = sync.plan(L, C, 'cloud2local');
  assert.deepEqual(p.pulls, ['baru']);
  assert.deepEqual(p.deletes.local, ['stale']);
});

test('plan twoway: hanya di satu sisi -> push/pull tanpa hapus', () => {
  const L = [E('lokal-baru', '2026-01-01T00:00:00Z')];
  const C = [E('cloud-baru', '2026-01-02T00:00:00Z')];
  const p = sync.plan(L, C, 'twoway');
  assert.deepEqual(p.pushes, ['lokal-baru']);
  assert.deepEqual(p.pulls, ['cloud-baru']);
  assert.equal(p.deletes.local.length + p.deletes.cloud.length, 0);
});

test('plan twoway: syncKey memasangkan ID desktop dan cloud yang berbeda', () => {
  const L = [E('local-1', '2026-01-02T00:00:00Z', 1, { hash: 'sama' })];
  const C = [E('cloud-9', '2026-01-02T00:00:00Z', 1, { hash: 'sama', syncKey: 'local-1' })];
  const p = sync.plan(L, C, 'twoway');
  assert.equal(p.unchanged, 1);
  assert.deepEqual(p.pushes, []);
  assert.deepEqual(p.pulls, []);
});

test('plan twoway: perubahan sama-sama baru -> konflik ditahan, tidak ada yang hilang', () => {
  const L = [E('x', '2026-01-05T00:00:00Z', 3, { size: 11 })];
  const C = [E('x', '2026-01-05T00:00:00Z', 3, { size: 99 })];
  const p = sync.plan(L, C, 'twoway');
  assert.equal(p.pushes.length, 0);
  assert.equal(p.pulls.length, 0);
  assert.equal(p.conflicts.length, 1);
});

test('plan: delete vs edit lebih baru -> konflik (jangan auto-hapus)', () => {
  const L = [E('f', '2026-01-02T00:00:00Z', 2, { deleted: true })]; // lokal dihapus
  const C = [E('f', '2026-01-04T00:00:00Z', 2, { size: 55 })];      // cloud diedit setelahnya
  const p = sync.plan(L, C, 'twoway');
  assert.equal(p.conflicts.length, 1);
  assert.equal(p.conflicts[0].kind, 'delete-edit');
  assert.equal(p.deletes.local.length + p.deletes.cloud.length, 0);
});

test('conflictName: ekstensi dipertahankan', () => {
  assert.equal(sync.conflictName('laporan.pdf', 'Cloud'), 'laporan (konflik dari Cloud).pdf');
  assert.equal(sync.conflictName('README', 'Local'), 'README (konflik dari Local)');
});

test('run: push/pull jalan, konflik direkam ke MMConflicts (tanpa copyEntry otomatis)', async () => {
  recorded.length = 0;
  const pushed = [], pulled = [], delLocal = [], delCloud = [];
  const L = [E('push-me', '2026-01-02T00:00:00Z'), E('konflik', '2026-01-05T00:00:00Z', 3, { size: 11 })];
  const C = [E('pull-me', '2026-01-03T00:00:00Z'), E('konflik', '2026-01-05T00:00:00Z', 3, { size: 99 })];
  const res = await sync.run({
    mode: 'twoway',
    getLocal: async () => L,
    getCloud: async () => C,
    pushEntry: async (e) => { pushed.push(e.id); },
    pullEntry: async (e) => { pulled.push(e.id); },
    deleteLocal: async (ids) => { delLocal.push(...ids); },
    deleteCloud: async (ids) => { delCloud.push(...ids); },
  });
  assert.deepEqual(pushed, ['push-me']);
  assert.deepEqual(pulled, ['pull-me']);
  assert.deepEqual(delLocal, []);
  assert.deepEqual(delCloud, []);
  assert.equal(res.conflicts, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].entryId, 'konflik');
  assert.ok(res.log.some((l) => l.includes('DITAHAN')));
  assert.ok(res.log.some((l) => l.includes('Sync selesai')));
});

test('run: local2cloud tidak menimpa cloud yang lebih baru (konflik direkam)', async () => {
  recorded.length = 0;
  const pushed = [];
  const L = [E('b', '2026-01-01T00:00:00Z')];
  const C = [E('b', '2026-01-03T00:00:00Z')];
  const res = await sync.run({
    mode: 'local2cloud',
    getLocal: async () => L,
    getCloud: async () => C,
    pushEntry: async (e) => { pushed.push(e.id); },
  });
  assert.deepEqual(pushed, []); // cloud lebih baru -> jangan timpa
  assert.equal(recorded.length, 1);
  assert.equal(res.conflicts, 1);
});
