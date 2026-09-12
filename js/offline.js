/* offline.js — Offline Mode Kastriva-DriveVault.
   - IndexedDB (store: entries, blobs, queue) = local cache + antrian offline changes
   - Deteksi online/offline + banner indikator
   - Queue offline changes -> flush otomatis saat koneksi kembali (FIFO, retry 3x)
   Namespace: window.MMOffline */
(function () {
  'use strict';
  const MM = window.MM;

  const DB = 'gfm-offline';
  const DB_VER = 2;
  const S_ENTRIES = 'entries';
  const S_QUEUE = 'queue';
  const S_BLOBS = 'blobs';

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, DB_VER);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(S_ENTRIES)) d.createObjectStore(S_ENTRIES);
          if (!d.objectStoreNames.contains(S_QUEUE)) d.createObjectStore(S_QUEUE);
          if (!d.objectStoreNames.contains(S_BLOBS)) d.createObjectStore(S_BLOBS);
          if (!d.objectStoreNames.contains('conflicts')) d.createObjectStore('conflicts');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  function tx(store, mode) { return db().then((d) => d.transaction(store, mode).objectStore(store)); }
  const idbPut = (store, key, val) => tx(store, 'readwrite').then((s) => new Promise((res, rej) => { const r = s.put(val, key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));
  const idbGetAll = (store) => tx(store, 'readonly').then((s) => new Promise((res, rej) => { const r = s.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }));
  const idbGetAllKeys = (store) => tx(store, 'readonly').then((s) => new Promise((res, rej) => { const r = s.getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }));
  const idbDel = (store, key) => tx(store, 'readwrite').then((s) => new Promise((res, rej) => { const r = s.delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));
  const idbClear = (store) => tx(store, 'readwrite').then((s) => new Promise((res, rej) => { const r = s.clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));

  /* ---------- cache entries ---------- */
  async function cacheEntries(entries) {
    await idbPut(S_ENTRIES, 'all', entries);
  }
  async function getCachedEntries() {
    try { return (await idbGetAll(S_ENTRIES))[0] || null; } catch { return null; }
  }

  /* ---------- antrian offline changes ---------- */
  /* item: { id: "<ts>-<rand>", op, payload, tries, ts } op: createFolder|upload|delete|rename|move|favorite */
  async function enqueue(op, payload) {
    const item = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      op, payload, tries: 0,
      ts: new Date().toISOString(),
    };
    await idbPut(S_QUEUE, item.id, item);
    updateBadge();
    return item;
  }
  async function queueSize() {
    try { return (await idbGetAllKeys(S_QUEUE)).length; } catch { return 0; }
  }
  async function peekQueue() {
    try {
      const items = await idbGetAll(S_QUEUE);
      return items.sort((a, b) => String(a.id).localeCompare(String(b.id))); // FIFO by id ts
    } catch { return []; }
  }
  async function dequeue(id) { await idbDel(S_QUEUE, id); }

  /* ---------- flush saat online kembali ---------- */
  let flushing = false;
  async function flushQueue() {
    if (flushing || !navigator.onLine) return { flushed: 0, failed: 0 };
    flushing = true;
    let flushed = 0, failed = 0;
    try {
      const items = await peekQueue();
      for (const it of items) {
        try {
          await MM.api.call(it.op, it.payload);
          await dequeue(it.id);
          flushed++;
        } catch (err) {
          it.tries = (it.tries || 0) + 1;
          if (it.tries >= 3) { await dequeue(it.id); failed++; }
          else { await idbPut(S_QUEUE, it.id, it); }
        }
      }
    } finally {
      flushing = false;
      updateBadge();
    }
    return { flushed, failed };
  }

  /* ---------- status & badge ---------- */
  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit(state) { listeners.forEach((f) => f(state)); }

  function updateBadge() {
    queueSize().then((n) => {
      document.querySelectorAll('.offline-badge').forEach((el) => {
        el.textContent = n ? ('⏳ ' + n + ' perubahan offline') : '';
        el.classList.toggle('hidden', !n);
      });
      document.dispatchEvent(new CustomEvent('gfm:queue', { detail: n }));
    });
  }

  function wire() {
    const emitState = () => {
      const online = navigator.onLine;
      emit({ online });
      document.documentElement.dataset.net = online ? 'online' : 'offline';
      const status = document.querySelector('#net-status');
      if (status) {
        status.classList.toggle('off', !online);
        status.title = online ? 'Online' : 'Offline';
      }
      if (online) flushQueue().then((r) => {
        if (r.flushed) MM && window.App && App.toast(r.flushed + ' perubahan offline tersinkron');
      });
    };
    window.addEventListener('online', emitState);
    window.addEventListener('offline', emitState);
    emitState();
    updateBadge();
  }
  /* ---------- daftar antrian utk panel Sync Queue ---------- */
  const OP_LABEL = {
    createFolder: '📁 Folder baru', upload: '⬆ Upload file', delete: '🗑 Hapus',
    rename: '✏️ Rename', move: '📦 Move', favorite: '⭐ Favorite',
  };
  async function renderQueue() {
    const items = await peekQueue();
    return items.map((it) => ({
      id: it.id,
      label: OP_LABEL[it.op] || it.op,
      detail: it.payload && (it.payload.name || (Array.isArray(it.payload.ids) ? it.payload.ids.length + ' entri' : '')) || '',
      ts: it.ts,
      tries: it.tries || 0,
    }));
  }

  window.MMOffline = {
    cacheEntries, getCachedEntries,
    enqueue, queueSize, peekQueue, flushQueue,
    renderQueue, onChange, wire, updateBadge,
  };
})();
