import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const serviceUrl = pathToFileURL(path.resolve('desktop/file-service.mjs')).href;
const { createFileService } = await import(serviceUrl);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfm-desktop-'));
  await fs.writeFile(path.join(root, 'awal.txt'), 'isi awal');
  const service = await createFileService(root);
  return { root, service };
}

test('desktop service mengurung semua operasi di Workspace Root', async (t) => {
  const { root, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(() => service.resolveUserPath('../rahasia.txt'), /di luar Workspace Root/);
  await assert.rejects(() => service.resolveUserPath(path.resolve(root, '..', 'rahasia.txt')), /di luar Workspace Root/);
  await assert.rejects(() => service.rename('../rahasia', 'x.txt'), /ID tidak valid|tidak ditemukan/);
});

test('desktop service menjalankan CRUD, move, copy, pencarian, dan download nyata', async (t) => {
  const { root, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const initial = await service.list();
  const awal = initial.find((entry) => entry.name === 'awal.txt');
  assert.ok(awal);
  assert.equal(awal.type, 'file');

  const docs = await service.createFolder('root', 'Docs');
  const uploaded = await service.upload(docs.id, 'catatan.txt', 'text/plain', 'data:text/plain;base64,aGVsbG8=');
  assert.equal(uploaded.parentId, docs.id);

  const renamed = await service.rename(uploaded.id, 'catatan-final.txt');
  assert.equal(renamed.name, 'catatan-final.txt');
  await service.move([renamed.id], 'root');
  const copied = await service.copy([renamed.id], docs.id);
  assert.equal(copied.length, 1);
  assert.match(copied[0].name, /^catatan-final/);

  const matches = await service.search('final');
  assert.equal(matches.length, 2);
  const downloaded = await service.download(renamed.id);
  assert.equal(Buffer.from(downloaded.dataUrl.split(',')[1], 'base64').toString(), 'hello');
});

test('desktop Trash melakukan soft delete, restore, dan purge', async (t) => {
  const { root, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const awal = (await service.list()).find((entry) => entry.name === 'awal.txt');
  assert.equal(await service.remove([awal.id]), 1);
  let trashed = (await service.list()).find((entry) => entry.id === awal.id);
  assert.equal(trashed.deleted, true);
  await assert.rejects(() => fs.access(path.join(root, 'awal.txt')));

  assert.equal(await service.restore([awal.id]), 1);
  assert.equal(await fs.readFile(path.join(root, 'awal.txt'), 'utf8'), 'isi awal');

  assert.equal(await service.remove([awal.id]), 1);
  assert.equal(await service.purge([awal.id]), 1);
  assert.equal((await service.list()).some((entry) => entry.id === awal.id), false);
});

test('desktop service menyaring nama Windows berbahaya dan mencegah siklus folder', async (t) => {
  const { root, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const parent = await service.createFolder('root', '../Parent');
  const child = await service.createFolder(parent.id, 'Child');
  assert.equal(parent.name, 'Parent');
  await assert.rejects(() => service.move([parent.id], child.id), /folder tujuan berada di dalam sumber/);

  const reserved = await service.upload('root', 'CON.txt', 'text/plain', 'data:text/plain;base64,eA==');
  assert.equal(reserved.name, '_CON.txt');
});

test('desktop createFolder memakai syncKey agar pull cloud idempotent', async (t) => {
  const { root, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const first = await service.createFolder('root', 'Cloud Docs', 'cloud-folder-1');
  const second = await service.createFolder('root', 'Cloud Docs', 'cloud-folder-1');
  assert.equal(second.id, first.id);
  assert.equal(second.syncKey, 'cloud-folder-1');
  assert.equal((await service.list()).filter((entry) => entry.syncKey === 'cloud-folder-1').length, 1);
});
