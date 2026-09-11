/* core.js — util + store lokal (localStorage untuk metadata, IndexedDB untuk blob) + API client.
   Namespace global: window.MM */
(function () {
  'use strict';
  const MM = {};

  /* ---------- util ---------- */
  MM.util = {};
  MM.util.fmtSize = function (n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };
  MM.util.fmtDate = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  MM.util.fmtRelativeDate = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const now = new Date();
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return MM.util.fmtDate(iso);
  };
  MM.util.ext = function (name) { const i = String(name || '').lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
  MM.util.isImage = function (e) { return e && e.type === 'file' && String(e.mime || '').startsWith('image/'); };
  MM.util.uid = function () { return 'id-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)); };
  MM.util.debounce = function (fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
  MM.util.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ikon per tipe/ekstensi (emoji ringan, tanpa asset tambahan) */
  const ICONS = {
    folder: '📁', pdf: '📕', xlsx: '📊', xls: '📊', csv: '📊',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
    mp4: '🎬', mov: '🎬', mkv: '🎬', avi: '🎬',
    mp3: '🎵', wav: '🎵', ogg: '🎵',
    zip: '🗜️', rar: '🗜️', '7z': '🗜️',
    doc: '📄', docx: '📄', txt: '📄', md: '📄',
    exe: '⚙️', msi: '⚙️', apk: '🤖',
  };
  MM.util.iconFor = function (e) {
    if (!e) return '❓';
    if (e.type === 'folder') return '📁';
    const ext = MM.util.ext(e.name);
    if (ICONS[ext]) return ICONS[ext];
    if (String(e.mime || '').startsWith('image/')) return '🖼️';
    if (String(e.mime || '').startsWith('video/')) return '🎬';
    if (String(e.mime || '').startsWith('audio/')) return '🎵';
    return '📄';
  };
  MM.util.typeLabel = function (e) {
    if (!e || e.type === 'folder') return 'Folder';
    const ext = MM.util.ext(e.name);
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Excel';
    if (['doc', 'docx', 'rtf'].includes(ext)) return 'Word';
    if (['ppt', 'pptx'].includes(ext)) return 'PowerPoint';
    if (ext === 'pdf') return 'PDF';
    if (String(e.mime || '').startsWith('image/')) return 'Image';
    if (String(e.mime || '').startsWith('video/')) return 'Video';
    if (String(e.mime || '').startsWith('audio/')) return 'Audio';
    return (ext || 'File').toUpperCase();
  };

  /* ---------- store lokal (metadata di localStorage, blob di IndexedDB) ---------- */
  const LS_KEY = 'gfm.entries.v1';
  const SYNC_KEY = 'gfm.synclog.v1';

  MM.store = {
    load() {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
    },
    save(entries) { localStorage.setItem(LS_KEY, JSON.stringify(entries || [])); },
    loadSyncLog() {
      try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '[]'); } catch { return []; }
    },
    saveSyncLog(log) { localStorage.setItem(SYNC_KEY, JSON.stringify((log || []).slice(-200))); },
  };

  /* IndexedDB untuk blob file */
  let dbPromise = null;
  function idb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('gfm', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  MM.blobStore = {
    async put(id, blob) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
    async get(id) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('blobs', 'readonly'); const r = tx.objectStore('blobs').get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); },
    async del(id) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
  };

  /* ---------- API client ---------- */
  const API_URL = '/api/gas'; // dev: mock server; produksi: proxy Vercel -> Apps Script

  MM.api = {
    async call(action, payload = {}) {
      if (window.gfmDesktop) {
        const json = await window.gfmDesktop.call(action, payload);
        if (!json || json.ok === false) throw new Error((json && (json.error || json.message)) || 'Operasi desktop gagal');
        return json;
      }
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'respons tidak valid' }));
      if (!json || json.ok === false) throw new Error((json && json.error) || ('HTTP ' + res.status));
      return json;
    },
    list() { return this.call('list'); },
    createFolder(parentId, name) { return this.call('createFolder', { parentId, name }); },
    del(ids) { return this.call('delete', { ids }); },
    rename(id, name) { return this.call('rename', { id, name }); },
    move(ids, parentId) { return this.call('move', { ids, parentId }); },
    favorite(id, on) { return this.call('favorite', { id, on }); },
    async download(id) { const r = await this.call('download', { id }); return r.data; },
    async upload(parentId, name, mime, blob) {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      return this.call('upload', { parentId, name, mime, size: blob.size, dataUrl });
    },
    /* #30 sharing + #29 auth — pembungkus tipis di atas call() (token disisipkan MMAuth) */
    share(id, mode, emails) { return this.call('share', { id, mode, emails: emails || '' }); },
    shareInfo(id) { return this.call('shareInfo', { id }); },
    sharedList() { return this.call('sharedList', {}); },
    publicGet(link) { return this.call('publicGet', { link }); }, // anonim: tanpa token
  };

  /* Cloud terpisah pada Electron; versi web memakai API GAS yang sama. */
  MM.cloudApi = {
    async call(action, payload = {}) {
      if (window.gfmDesktop) {
        const json = await window.gfmDesktop.cloudCall(action, payload);
        if (!json || json.ok === false) throw new Error((json && (json.error || json.message)) || 'Operasi cloud gagal');
        return json;
      }
      return MM.api.call(action, payload);
    },
    list() { return this.call('list'); },
    createFolder(parentId, name, syncKey) { return this.call('createFolder', { parentId, name, syncKey }); },
    del(ids) { return this.call('delete', { ids }); },
    download(id) { return this.call('download', { id }).then((result) => result.data); },
    async upload(parentId, name, mime, blobOrDataUrl, syncKey) {
      let dataUrl = blobOrDataUrl;
      if (typeof dataUrl !== 'string') {
        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blobOrDataUrl);
        });
      }
      return this.call('upload', { parentId, name, mime, dataUrl, syncKey });
    },
  };

  window.MM = MM;
})();
