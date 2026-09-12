/* conflict.js — Pusat konflik Kastriva-DriveVault.
   Konflik DITAHAN untuk review: tidak ada file yang ditimpa sampai user memilih.
   Persist di IndexedDB (gfm-offline v2, store: conflicts).
   Namespace: window.MMConflicts */
(function () {
  'use strict';
  const S_CONF = 'conflicts';
  let dbP = null;

  function db() {
    if (!dbP) {
      dbP = new Promise((resolve, reject) => {
        const req = indexedDB.open('gfm-offline', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries');
          if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue');
          if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
          if (!d.objectStoreNames.contains(S_CONF)) d.createObjectStore(S_CONF);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbP;
  }
  const tx = (mode) => db().then((d) => d.transaction(S_CONF, mode).objectStore(S_CONF));
  const idbPut = (key, val) => tx('readwrite').then((s) => new Promise((res, rej) => { const r = s.put(val, key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));
  const idbGetAll = () => tx('readonly').then((s) => new Promise((res, rej) => { const r = s.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }));
  const idbDel = (key) => tx('readwrite').then((s) => new Promise((res, rej) => { const r = s.delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));

  /*
   * Catat konflik: lokal & cloud sama-sama berubah. Tidak ada yang ditimpa di sini.
   * le/ce: entri lokal & cloud (bisa null bila sisi tak punya).
   */
  async function record(entryId, le, ce) {
    const e = le || ce;
    const rec = {
      entryId,
      type: e.type,
      mime: e.mime || '',
      name: (le && le.name) || e.name,
      cloudName: (ce && ce.name) || e.name,
      parentId: (le && le.parentId) || e.parentId,
      cloudParentId: (ce && ce.parentId) || e.parentId,
      local: le ? { modified: le.modifiedTime || le.modified, size: le.size, version: le.version, hash: le.hash || '' } : null,
      cloud: ce ? { modified: ce.modifiedTime || ce.modified, size: ce.size, version: ce.version, hash: ce.hash || '' } : null,
      ts: new Date().toISOString(),
    };
    await idbPut(entryId, rec);
    return rec;
  }

  async function list() {
    const all = await idbGetAll();
    return all.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }

  async function get(entryId) {
    const all = await idbGetAll();
    return all.find((x) => x.entryId === entryId) || null;
  }

  async function remove(entryId) { await idbDel(entryId); }
  async function count() { return (await idbGetAll()).length; }

  window.MMConflicts = { record, list, get, remove, count };
})();
