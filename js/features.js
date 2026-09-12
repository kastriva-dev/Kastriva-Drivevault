/* features.js — fitur Kastriva-DriveVault #13-28:
   metadata+syncStatus, trash, upload manager (progress/cancel/retry), download ZIP,
   search filter, sort, preview. Namespace: window.F */
(function () {
  'use strict';
  const MM = window.MM;
  const F = {};

  /* ================= METADATA & SYNC STATUS ================= */
  /* syncStatus: Synced | Pending | Uploading | Downloading | Conflict | Error */
  F.STATUS = { SYNCED: 'Synced', PENDING: 'Pending', UPLOADING: 'Uploading', DOWNLOADING: 'Downloading', CONFLICT: 'Conflict', ERROR: 'Error' };
  const STATUS_KEY = 'gfm.syncstatus.v1';
  F.statusMap = (() => { try { return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}'); } catch { return {}; } })();
  F.saveStatus = function () { try { localStorage.setItem(STATUS_KEY, JSON.stringify(F.statusMap)); } catch {} };
  F.statusOf = function (entry) {
    if (entry._local) return F.STATUS.PENDING;
    return F.statusMap[entry.id] || entry.syncStatus || F.STATUS.SYNCED;
  };
  F.setStatus = function (id, st) { F.statusMap[id] = st; F.saveStatus(); F.applyStatusBadges(); };

  F.metaOf = function (entry, pathStr) {
    return {
      fileId: entry.fileId || entry.id, name: entry.name, path: entry.path || pathStr || '',
      extension: entry.extension || MM.util.ext(entry.name), size: entry.size || 0,
      modifiedTime: entry.modifiedTime || entry.modified, createdTime: entry.createdTime || entry.created || entry.modified,
      hash: entry.hash || '', version: entry.version || 1,
      parentId: entry.parentId, syncStatus: F.statusOf(entry),
    };
  };

  F.applyStatusBadges = function () {
    document.querySelectorAll('[data-status-for]').forEach((el) => {
      const st = F.statusMap[el.dataset.statusFor] || 'Synced';
      el.dataset.status = st;
      el.textContent = st;
    });
  };

  /* ================= TRASH ================= */
  F.trashList = function () { return App.state.entries.filter((e) => e.deleted); };
  F.restore = async function (ids) {
    await App.apiCall('restore', { ids });
    for (const id of ids) { const e = App.state.entries.find((x) => x.id === id); if (e) { e.deleted = false; delete e.deletedAt; } }
    App.render(); App.toast('Dipulihkan');
  };
  F.purge = async function (ids) {
    App.openDialog('Hapus Permanen', '<p>Hapus permanen ' + ids.length + ' entri? Tidak bisa dikembalikan.</p>', async () => {
      await App.apiCall('purge', { ids });
      App.state.entries = App.state.entries.filter((e) => !ids.includes(e.id) && !ids.includes(e.parentId));
      App.state.selected.clear(); App.render(); App.toast('Dihapus permanen');
    });
  };
  F.emptyTrash = function () {
    App.openDialog('Kosongkan Trash', '<p>Hapus permanen SEMUA isi Trash?</p>', async () => {
      await App.apiCall('emptyTrash', {});
      App.state.entries = App.state.entries.filter((e) => !e.deleted);
      App.render(); App.toast('Trash dikosongkan');
    });
  };

  /* ================= UPLOAD MANAGER ================= */
  /* F.uploads: { id, name, size, loaded, progress, xhr, status, _file, _parentId } */
  F.uploads = [];
  F.uploadWithProgress = function (file, parentId, onProgress, task) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const upload = task || {
        id: 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: file.name, size: file.size, loaded: 0, progress: 0,
        status: 'Uploading', _file: file, _parentId: parentId,
      };
      if (!task) F.uploads.push(upload);
      upload.xhr = xhr;
      upload.status = 'Uploading';
      if (window.gfmDesktop) {
        const reader = new FileReader();
        upload.reader = reader;
        reader.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          upload.loaded = ev.loaded;
          upload.progress = Math.min(90, Math.round((ev.loaded / ev.total) * 90));
          onProgress(upload.progress);
        };
        reader.onload = async () => {
          if (upload.status === 'Canceled') return;
          try {
            upload.progress = 95; onProgress(95);
            const result = await MM.api.call('upload', { parentId, name: file.name, mime: file.type, size: file.size, dataUrl: reader.result });
            upload.status = 'Done'; upload.progress = 100; upload.loaded = file.size;
            onProgress(100); resolve(result);
          } catch (error) { upload.status = 'Error'; reject(error); }
        };
        reader.onerror = () => { upload.status = 'Error'; reject(reader.error || new Error('gagal membaca file')); };
        reader.onabort = () => { upload.status = 'Canceled'; reject(new Error('dibatalkan')); };
        reader.readAsDataURL(file);
        return;
      }
      const fd = new FormData();
      fd.append('action', 'upload');
      // jalur XHR bypass MM.api.call (#29) -> token wajib ikut di body
      if (window.MMAuth && MMAuth.token) fd.append('token', MMAuth.token);
      fd.append('parentId', parentId);
      fd.append('name', file.name);
      fd.append('mime', file.type);
      fd.append('size', String(file.size));
      fd.append('dataUrl', ''); // diisi di bawah
      const fr = new FileReader();
      fr.onload = () => {
        fd.set('dataUrl', fr.result);
        xhr.open('POST', '/api/gas');
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            upload.loaded = Math.min(file.size, Math.round((ev.loaded / ev.total) * file.size));
            upload.progress = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
            upload.status = 'Uploading';
            onProgress(upload.progress);
          }
        };
        xhr.onload = () => {
          try {
            const j = JSON.parse(xhr.responseText);
            if (j.ok) {
              upload.status = 'Done'; upload.progress = 100; upload.loaded = file.size;
              onProgress(100); resolve(j);
            } else { upload.status = 'Error'; reject(new Error(j.error || 'upload gagal')); }
          } catch { upload.status = 'Error'; reject(new Error('respons tidak valid')); }
        };
        xhr.onerror = () => { upload.status = 'Error'; reject(new Error('jaringan')); };
        xhr.onabort = () => { upload.status = 'Canceled'; reject(new Error('dibatalkan')); };
        xhr.send(fd);
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  };
  F.cancelUpload = function (id) {
    const u = F.uploads.find((x) => x.id === id);
    if (!u || u.status !== 'Uploading') return;
    if (u.reader && u.reader.readyState === FileReader.LOADING) u.reader.abort();
    else if (u.xhr) u.xhr.abort();
  };

  /* ================= DOWNLOAD PROGRESS ================= */
  F.downloads = [];
  F.renderDownloadPanel = function () {
    const panel = document.querySelector('#download-panel');
    if (!panel) return;
    const items = F.downloads.slice(-6);
    if (!items.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="up-head"><b>Downloading...</b><button class="btn icon" data-close-download>✕</button></div>' +
      items.map((item) => '<div class="up-row"><span class="up-name">' + App.esc(item.name) + '</span>' +
        '<div class="up-bar"><div class="up-fill" style="width:' + item.progress + '%"></div></div>' +
        '<span class="up-pct">' + item.progress + '%</span></div>').join('');
    panel.querySelector('[data-close-download]').onclick = () => panel.classList.add('hidden');
  };
  F.startDownload = function (name) {
    const task = { id: 'down-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name, progress: 0 };
    F.downloads.push(task); F.renderDownloadPanel();
    return task;
  };
  F.updateDownload = function (task, progress) {
    task.progress = Math.max(0, Math.min(100, Math.round(progress)));
    F.renderDownloadPanel();
  };

  /* ================= DOWNLOAD ZIP ================= */
  /* ZIP store-only (tanpa kompresi) — cukup untuk bundling; CRC32 dihitung manual. */
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
  }
  F.makeZip = async function (entries, onProgress) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const files = [];
    async function collect(list) {
      for (const e of list) {
        if (e.type === 'folder') {
          await collect(App.state.entries.filter((x) => !x.deleted && x.parentId === e.id));
        } else {
          try {
            const d = await MM.api.download(e.id);
            files.push({ name: e.name, data: new Uint8Array(await (await fetch(d.dataUrl)).arrayBuffer()) });
          } catch { /* lewati yang gagal */ }
        }
        if (onProgress) onProgress(files.length);
      }
    }
    await collect(entries);
    const enc = new TextEncoder();
    files.forEach((f, i) => {
      if (onProgress) onProgress(i + 1, files.length);
      const nameB = enc.encode(f.name);
      const crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
      lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), nameB, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
      ch.setUint16(28, nameB.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + f.data.length;
    });
    let centralSize = 0;
    central.forEach((c) => { centralSize += c.length; });
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true); eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
  };
  F.downloadBlob = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  /* ================= SEARCH + FILTER + SORT ================= */
  F.filters = { type: '', ext: '', size: '', date: '', location: '' };
  F.sortKey = localStorage.getItem('gfm.sort') || 'name';
  F.sortDir = localStorage.getItem('gfm.sortdir') || 'asc';
  F.setSort = function (key, dir) {
    F.sortKey = key; F.sortDir = dir || (F.sortKey === key && F.sortDir === 'asc' ? 'desc' : 'asc');
    localStorage.setItem('gfm.sort', F.sortKey);
    localStorage.setItem('gfm.sortdir', F.sortDir);
  };
  F.applySort = function (list) {
    const dir = F.sortDir === 'desc' ? -1 : 1;
    const k = F.sortKey;
    return list.sort((a, b) => {
      let r = 0;
      if (k === 'name') r = a.name.localeCompare(b.name);
      else if (k === 'modified') r = Date.parse(a.modified || 0) - Date.parse(b.modified || 0);
      else if (k === 'created') r = Date.parse(a.created || a.modified || 0) - Date.parse(b.created || b.modified || 0);
      else if (k === 'size') r = (a.size || 0) - (b.size || 0);
      else if (k === 'type') r = (MM.util.ext(a.name) || '').localeCompare(MM.util.ext(b.name) || '');
      return r * dir;
    });
  };
  F.categoryOf = function (e) {
    const ext = MM.util.ext(e.name);
    if (e.type === 'folder') return 'folder';
    if (String(e.mime || '').startsWith('image/')) return 'gambar image foto';
    if (String(e.mime || '').startsWith('video/')) return 'video';
    if (String(e.mime || '').startsWith('audio/')) return 'audio musik';
    if (ext === 'pdf') return 'pdf dokumen';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet sheet excel';
    if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'dokumen document';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'arsip archive';
    if (['js', 'ts', 'html', 'css', 'json', 'xml', 'php', 'py', 'java', 'c'].includes(ext)) return 'developer kode code';
    return 'lainnya other file';
  };
  /* Search global: nama, ekstensi, kategori, folder/path, dan metadata. */
  F.matchesSearch = function (entry, query, entries) {
    const tokens = String(query || '').toLocaleLowerCase('id-ID').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const pathParts = [];
    const seen = new Set();
    let parentId = entry.parentId;
    while (parentId && parentId !== 'root' && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = (entries || []).find((candidate) => candidate.id === parentId);
      if (!parent) break;
      pathParts.unshift(parent.name);
      parentId = parent.parentId;
    }
    const metadata = [
      entry.name, MM.util.ext(entry.name), F.categoryOf(entry), entry.type, entry.mime,
      entry.fileId || entry.id, entry.path, pathParts.join('/'), entry.size,
      entry.modifiedTime || entry.modified, entry.createdTime || entry.created,
      entry.hash, entry.version, entry.parentId, entry.syncStatus || F.statusOf(entry),
    ].filter((value) => value !== undefined && value !== null).join(' ').toLocaleLowerCase('id-ID');
    return tokens.every((token) => metadata.includes(token));
  };
  F.matchFilters = function (e) {
    const ext = MM.util.ext(e.name);
    if (F.filters.type) {
      const t = F.filters.type;
      const cat = e.type === 'folder' ? 'folder'
        : String(e.mime || '').startsWith('image/') ? 'image'
        : String(e.mime || '').startsWith('video/') ? 'video'
        : String(e.mime || '').startsWith('audio/') ? 'audio'
        : ['pdf'].includes(ext) ? 'pdf'
        : ['xlsx', 'xls', 'csv'].includes(ext) ? 'sheet'
        : ['doc', 'docx', 'txt', 'md'].includes(ext) ? 'doc' : 'other';
      if (cat !== t) return false;
    }
    if (F.filters.ext && ext !== F.filters.ext.toLowerCase()) return false;
    if (F.filters.location && e.parentId !== F.filters.location) return false;
    if (F.filters.size) {
      const s = e.size || 0;
      if (F.filters.size === 'small' && s >= 1024 * 100) return false;
      if (F.filters.size === 'medium' && (s < 1024 * 100 || s > 1024 * 1024 * 10)) return false;
      if (F.filters.size === 'large' && s <= 1024 * 1024 * 10) return false;
    }
    if (F.filters.date) {
      const days = (Date.now() - Date.parse(e.modified || 0)) / 86400000;
      if (F.filters.date === 'today' && days >= 1) return false;
      if (F.filters.date === 'week' && days >= 7) return false;
      if (F.filters.date === 'month' && days >= 31) return false;
    }
    return true;
  };

  /* ================= PREVIEW ================= */
  F.previewable = function (e) {
    const ext = MM.util.ext(e.name);
    const mime = String(e.mime || '');
    if (e.type === 'folder') return false;
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return true;
    if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf') return true;
    if (['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'wav', 'ogg'].includes(ext)) return true;
    if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'rtf', 'json', 'js', 'ts', 'css', 'html', 'xml', 'php', 'py', 'java', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'toml', 'sql'].includes(ext)) return true;
    return false;
  };
  F.previewUnavailable = function (e, detail) {
    App.openDialog('Preview — ' + e.name,
      '<div class="preview-unavailable"><b>Preview unavailable</b>' +
      (detail ? '<p>' + App.esc(detail) + '</p>' : '') +
      '<div class="preview-fallback-actions"><button type="button" class="btn" data-preview-open>Open</button>' +
      '<button type="button" class="btn primary" data-preview-download>Download</button></div></div>', null, 'Tutup');
    const body = document.querySelector('#dialog-body');
    body.querySelector('[data-preview-open]').onclick = () => App.openEntry(e);
    body.querySelector('[data-preview-download]').onclick = () => F.downloadOne(e);
  };
  F.highlightCode = function (source, ext) {
    const codeExtensions = ['json', 'js', 'ts', 'css', 'html', 'xml', 'php', 'py', 'java', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'toml', 'sql'];
    if (!codeExtensions.includes(ext)) return App.esc(source);
    const tokens = [];
    const stash = (html) => `\uE000${tokens.push(html) - 1}\uE001`;
    let value = App.esc(source);
    value = value.replace(/(&quot;|&#39;|`)(?:\\.|(?!\1).)*?\1/g, (match) => stash('<span class="syn-string">' + match + '</span>'));
    value = value.replace(/(\/\/.*$|#(?![0-9a-fA-F]{3,8}\b).*$|\/\*.*?\*\/|&lt;!--.*?--&gt;)/g, (match) => stash('<span class="syn-comment">' + match + '</span>'));
    value = value.replace(/\b(0x[\da-f]+|\d+(?:\.\d+)?)\b/gi, '<span class="syn-number">$1</span>');
    value = value.replace(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|new|import|export|from|async|await|try|catch|throw|true|false|null|undefined|def|lambda|yield|with|as|pass|raise|public|private|protected|static|final|void|int|float|double|char|boolean|SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|CREATE|TABLE|AND|OR|NOT)\b/gi, '<span class="syn-keyword">$1</span>');
    value = value.replace(/\uE000(\d+)\uE001/g, (_match, index) => tokens[Number(index)]);
    return value;
  };
  F.preview = async function (e) {
    const ext = MM.util.ext(e.name);
    const mime = String(e.mime || '');
    if (!F.previewable(e)) {
      F.previewUnavailable(e, 'Format ini tidak didukung oleh preview aplikasi.');
      return;
    }
    if (window.App && App.markOpened) App.markOpened(e);
    App.toast('Memuat preview…');
    const d = await MM.api.download(e.id);
    const url = d.dataUrl;
    const office = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
    let body = '';
    if (office && d.entry && d.entry.previewUrl) body =
      '<iframe src="' + App.esc(d.entry.previewUrl) + '" title="Office preview" class="preview-office" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>';
    else if (office) {
      F.previewUnavailable(e, 'Sinkronkan file ke Google Drive untuk mencoba preview Office.');
      return;
    }
    else if (mime.startsWith('image/')) body = '<img src="' + url + '" style="max-width:100%;max-height:60vh;border-radius:10px">';
    else if (mime === 'application/pdf' || ext === 'pdf') body = '<iframe src="' + url + '" title="PDF preview" style="width:100%;height:60vh;border:0;border-radius:10px"></iframe>';
    else if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) body =
      '<video src="' + url + '" controls preload="metadata" playsinline class="preview-video">' +
      'Browser tidak mendukung pemutar video ini.</video>';
    else if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext)) body =
      '<audio src="' + url + '" controls preload="metadata" class="preview-audio">' +
      'Browser tidak mendukung pemutar audio ini.</audio>';
    else {
      const text = await (await fetch(url)).text();
      const limited = text.slice(0, 200000);
      const lines = limited.split('\n');
      body = '<div class="preview-code-toolbar"><span>.' + App.esc(ext || 'txt') + '</span><span>' + lines.length + ' lines' +
        (text.length > limited.length ? ' • preview dipotong' : '') + '</span></div>' +
        '<pre class="preview-code" tabindex="0">' + lines.map((line, index) =>
          '<span class="code-line"><span class="line-no">' + (index + 1) + '</span><code>' + F.highlightCode(line, ext) + '</code></span>').join('\n') + '</pre>';
    }
    App.openDialog('Preview — ' + e.name, body, null, 'Tutup');
    const media = document.querySelector('#dialog-body video, #dialog-body audio, #dialog-body img');
    if (media) media.addEventListener('error', () => F.previewUnavailable(e, 'Codec atau format media tidak didukung.'), { once: true });
  };

  /* refresh tampilan dari mana saja (dipanggil setelah filter/sort berubah) */
  F.refreshDir = function () { if (window.App && App.render) App.render(); };

  /* ---------- context menu: item fitur + aksi multi-select ---------- */
  const FCTX = [
    { label: 'Preview', act: (e) => F.preview(e) },
    { label: 'Download', act: (e) => F.downloadOne(e) },
    { label: 'Download ZIP', when: (e) => e.type === 'folder' || App.state.selected.size > 1, act: () => F.downloadZip() },
  ];

  async function downloadOne(e) {
    if (e.type === 'folder') return F.downloadZip();
    const task = F.startDownload(e.name);
    F.setStatus(e.id, F.STATUS.DOWNLOADING);
    try {
      F.updateDownload(task, 10);
      const d = await MM.api.download(e.id);
      F.updateDownload(task, 85);
      F.downloadBlob(await (await fetch(d.dataUrl)).blob(), e.name);
      F.updateDownload(task, 100);
      F.setStatus(e.id, F.STATUS.SYNCED);
    } catch (err) {
      F.setStatus(e.id, F.STATUS.ERROR);
      App.toast('Gagal unduh: ' + err.message);
    }
  }

  async function downloadZip() {
    const targets = App.state.selected.size > 1
      ? App.state.entries.filter((e) => App.state.selected.has(e.id))
      : App.state.entries.filter((e) => !e.deleted && e.parentId === App.state.cwd);
    if (!targets.length) { App.toast('Tidak ada item untuk di-ZIP'); return; }
    const rootName = App.state.cwd === 'root' ? 'Kastriva-DriveVault'
      : (App.state.entries.find((e) => e.id === App.state.cwd) || {}).name || 'files';
    const task = F.startDownload(rootName + '.zip');
    App.toast('Membuat ZIP…');
    const blob = await F.makeZip(targets, (done, total) => {
      if (total) F.updateDownload(task, Math.min(95, (done / total) * 90));
    });
    F.downloadBlob(blob, rootName + '.zip');
    F.updateDownload(task, 100);
    App.toast('ZIP siap diunduh');
  }
  F.downloadZip = downloadZip;
  F.downloadOne = downloadOne;
  F.FCTX = FCTX; // diekspos untuk app-ctx.js

  window.F = F;
})();
