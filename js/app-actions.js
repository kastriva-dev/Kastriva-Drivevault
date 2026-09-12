/* app-actions.js — seleksi, navigasi, upload DnD, context menu, aksi entri. */
(function () {
  'use strict';
  const MM = window.MM;
  const App = window.App;
  const $ = App.$;
  const $$ = App.$$;

  /* ---------- seleksi & open ---------- */
  App.handleClick = function (ev, e, idx) {
    const st = App.state;
    if (ev.ctrlKey || ev.metaKey) {
      if (st.selected.has(e.id)) st.selected.delete(e.id); else st.selected.add(e.id);
      st.lastClickedIndex = idx;
    } else if (ev.shiftKey && st.lastClickedIndex >= 0) {
      const a = Math.min(st.lastClickedIndex, idx);
      const b = Math.max(st.lastClickedIndex, idx);
      for (let i = a; i <= b; i++) st.selected.add(st.orderedIds[i]);
    } else {
      st.selected.clear();
      st.selected.add(e.id);
      st.lastClickedIndex = idx;
    }
    App.render();
  };

  App.openEntry = function (e) {
    if (e.type === 'folder') { App.openFolder(e.id); return; }
    App.markOpened(e);
    if (window.gfmDesktop) {
      MM.api.call('openExternal', { id: e.id }).catch((err) => App.toast('Gagal membuka: ' + err.message, 'error'));
      return;
    }
    MM.api.download(e.id).then((d) => {
      const a = document.createElement('a');
      a.href = d.dataUrl;
      a.download = e.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }).catch((err) => App.toast('Gagal unduh: ' + err.message));
  };

  App.openFolder = function (id) {
    App.state.cwd = id;
    App.state.selected.clear();
    App.state.lastClickedIndex = -1;
    App.state.search = '';
    $('#search').value = '';
    App.render();
  };

  /* ---------- toolbar ---------- */
  App.wireToolbar = function () {
    if (window.gfmDesktop) {
      window.gfmDesktop.info().then((info) => {
        App.desktopInfo = info;
        if (App.scheduleAutoSync) App.scheduleAutoSync();
        App.renderBreadcrumb();
        const localPath = $('#sync-local-path');
        const mode = $('#sync-target-mode');
        const config = $('#btn-cloud-config');
        if (localPath) localPath.textContent = info.workspaceRoot;
        if (mode) mode.textContent = info.cloudConfigured ? '(GAS aktif)' : '(belum dikonfigurasi)';
        if (config) config.classList.remove('hidden');
        $('#btn-workspace').classList.remove('hidden');
      });
    }
    $('#btn-back').addEventListener('click', () => {
      if (App.state.cwd === 'root') return;
      const cur = App.state.entries.find((e) => e.id === App.state.cwd);
      App.openFolder(cur ? cur.parentId : 'root');
    });
    $('#btn-load-retry').addEventListener('click', async () => {
      const button = $('#btn-load-retry');
      button.disabled = true;
      try { await App.loadEntries(); App.render(); }
      finally { button.disabled = false; }
    });
    $('#view-grid').addEventListener('click', () => App.setView('grid'));
    $('#view-list').addEventListener('click', () => App.setView('list'));
    $('#search').addEventListener('input', MM.util.debounce((ev) => {
      App.state.search = ev.target.value.trim();
      App.render();
    }, 150));
    $$('.side-item').forEach((b) => b.addEventListener('click', () => {
      App.setFilter(b.dataset.view);
      App.closeDrawer(); // setelah pilih, tutup drawer (mobile/tablet)
    }));
    $$('.bn-item').forEach((b) => b.addEventListener('click', () => App.setFilter(b.dataset.view)));

    /* drawer: hamburger buka/tutup, backdrop & Escape menutup */
    $('#btn-menu').addEventListener('click', () => App.toggleDrawer());
    $('#drawer-backdrop').addEventListener('click', () => App.closeDrawer());
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') App.closeDrawer(); });
    $('#btn-upload').addEventListener('click', () => $('#file-input').click());
    $('#dir-input').addEventListener('change', (ev) => {
      const files = Array.from(ev.target.files || []);
      App.renderUploadPanel();
      (async () => {
        for (const f of files) {
          const rel = f.webkitRelativePath || f.name;
          const parts = rel.split('/');
          parts.pop();
          let pid = App.state.cwd;
          for (const seg of parts) {
            let fold = App.state.entries.find((x) => !x.deleted && x.parentId === pid && x.type === 'folder' && x.name === seg);
            if (!fold) {
              const r = await App.apiCall('createFolder', { parentId: pid, name: seg });
              fold = r.queued ? { id: 'local-' + Date.now() + Math.random(), name: seg, type: 'folder', parentId: pid, _local: true } : r.data;
              App.state.entries.push(fold);
            }
            pid = fold.id;
          }
          await App.uploadOne(f, pid);
        }
        App.render();
      })();
      ev.target.value = '';
    });
    $('#btn-upload-dir').addEventListener('click', () => $('#dir-input').click());
    $('#file-input').addEventListener('change', (ev) => {
      App.uploadFiles(ev.target.files, App.state.cwd);
      ev.target.value = '';
    });
    /* adv bar: sort & filter */
    $('#btn-adv').addEventListener('click', () => $('#adv-bar').classList.toggle('hidden'));
    $('#sort-key').value = F.sortKey;
    $('#sort-key').addEventListener('change', (ev) => { F.setSort(ev.target.value); F.refreshDir(); });
    $('#sort-dir').addEventListener('click', () => {
      F.setSort(F.sortKey, F.sortDir === 'asc' ? 'desc' : 'asc');
      $('#sort-dir').textContent = F.sortDir === 'asc' ? '↑' : '↓';
      F.refreshDir();
    });
    $('#sort-dir').textContent = F.sortDir === 'asc' ? '↑' : '↓';
    const wireFilter = (id, key) => $(id).addEventListener('change', (ev) => { F.filters[key] = ev.target.value; F.refreshDir(); });
    wireFilter('#filter-type', 'type');
    wireFilter('#filter-size', 'size');
    wireFilter('#filter-date', 'date');
    wireFilter('#filter-location', 'location');
    wireFilter('#filter-ext', 'ext');
    $('#btn-filter-reset').addEventListener('click', () => {
      F.filters = { type: '', ext: '', size: '', date: '', location: '' };
      ['#filter-type', '#filter-size', '#filter-date', '#filter-location', '#filter-ext'].forEach((id) => { $(id).value = ''; });
      F.refreshDir();
    });
    $('#btn-empty-trash').addEventListener('click', F.emptyTrash);
    $('#selected-download').addEventListener('click', () => F.downloadZip());
    $('#selected-copy').addEventListener('click', () => App.copySelected());
    $('#selected-move').addEventListener('click', () => App.moveSelected());
    $('#selected-delete').addEventListener('click', () => App.deleteSelected());
    $('#selected-share').addEventListener('click', () => App.shareSelected());
    /* isi dropdown ekstensi dari data */
    const exts = [...new Set(App.state.entries.filter((e) => e.type === 'file').map((e) => MM.util.ext(e.name)).filter(Boolean))].sort();
    $('#filter-ext').innerHTML = '<option value="">Ext: Semua</option>' + exts.map((x) => '<option value="' + App.esc(x) + '">.' + App.esc(x) + '</option>').join('');
    const folders = App.state.entries.filter((e) => !e.deleted && e.type === 'folder').sort((a, b) => a.name.localeCompare(b.name));
    $('#filter-location').innerHTML = '<option value="">Location: Semua</option><option value="root">Workspace Root</option>' +
      folders.map((folder) => '<option value="' + App.esc(folder.id) + '">' + App.esc(folder.name) + '</option>').join('');
    $('#btn-newfolder').addEventListener('click', App.promptFolderName);
    $('#btn-workspace').addEventListener('click', async () => {
      if (!window.gfmDesktop) return;
      const result = await window.gfmDesktop.chooseWorkspace();
      if (!result.ok) { App.toast(result.error || result.message, 'error'); return; }
      if (!result.data) return;
      App.desktopInfo = { ...App.desktopInfo, ...result.data };
      $('#sync-local-path').textContent = result.data.workspaceRoot;
      await App.loadEntries();
      App.state.cwd = 'root';
      App.state.selected.clear();
      App.render();
      App.toast('Workspace changed', 'success');
    });
    const cloudConfig = $('#btn-cloud-config');
    cloudConfig.addEventListener('click', () => {
      if (!window.gfmDesktop) return;
      const current = App.desktopInfo?.cloudUrl || '';
      App.openDialog('Server Google Apps Script',
        '<input class="input" id="dlg-cloud-url" placeholder="https://script.google.com/macros/s/.../exec" value="' + App.esc(current) + '">' +
        '<p class="share-hint">URL Web App GAS digunakan oleh Sync Engine untuk Google Drive.</p>',
        async () => {
          const result = await window.gfmDesktop.setCloudUrl($('#dlg-cloud-url').value.trim());
          if (!result.ok) throw new Error(result.error || result.message);
          App.desktopInfo = { ...App.desktopInfo, ...result.data };
          $('#sync-target-mode').textContent = result.data.cloudConfigured ? '(GAS aktif)' : '(belum dikonfigurasi)';
          if (result.data.cloudConfigured && window.MMAuth) {
            await MMAuth.enableCloudAuth();
          }
          App.toast('Server cloud diperbarui', 'success');
        }, 'Simpan');
    });
    $('#sync-close').addEventListener('click', () => $('#sync-panel').classList.add('hidden'));
    $('#btn-sync').addEventListener('click', () => {
      $('#sync-panel').classList.toggle('hidden');
      App.renderSyncState();
      App.renderQueueUI();
      App.renderConflictsUI();
    });
    $$('.sync-mode').forEach((b) => b.addEventListener('click', () => App.runSync(b.dataset.mode)));
    const flushBtn = $('#btn-flush');
    if (flushBtn) flushBtn.addEventListener('click', async () => {
      flushBtn.disabled = true;
      try {
        const r = await MMOffline.flushQueue();
        App.toast(r.flushed ? (r.flushed + ' perubahan terkirim ke ' + ($('#sync-target-name').textContent || 'server')) : 'Antrian kosong / server belum siap');
        if (r.failed) App.toast(r.failed + ' perubahan gagal dikirim (dihapus dari antrian setelah 3 percobaan)');
      } finally {
        flushBtn.disabled = false;
        App.renderQueueUI();
      }
    });
  };

  App.setView = function (v) {
    App.state.view = v;
    $('#grid').classList.toggle('hidden', v !== 'grid');
    $('#list').classList.toggle('hidden', v !== 'list');
    $('#view-grid').classList.toggle('active', v === 'grid');
    $('#view-list').classList.toggle('active', v === 'list');
    App.render();
  };

  /* filter + sinkronisasi status aktif sidebar & bottom-nav */
  App.setFilter = function (f) {
    App.state.filter = f;
    $$('.side-item').forEach((x) => x.classList.toggle('active', x.dataset.view === f));
    $$('.bn-item').forEach((x) => x.classList.toggle('active', x.dataset.view === f));
    App.render();
  };

  /* drawer sidebar (tablet & mobile) */
  App.toggleDrawer = function () {
    const sb = $('#sidebar');
    const open = !sb.classList.contains('drawer-open');
    App.setDrawer(open);
  };
  App.setDrawer = function (open) {
    const sb = $('#sidebar');
    const bd = $('#drawer-backdrop');
    sb.classList.toggle('drawer-open', open);
    bd.classList.toggle('visible', open);
  };
  App.closeDrawer = function () { App.setDrawer(false); };
  App.openDrawer = function () { App.setDrawer(true); };

  App.promptFolderName = function () {
    App.openDialog('Folder Baru',
      '<input class="input" id="dlg-name" placeholder="Nama folder" value="Folder Baru">',
      async () => {
        const name = $('#dlg-name').value.trim() || 'Folder Baru';
        const r = await App.apiCall('createFolder', { parentId: App.state.cwd, name });
        if (r.queued) {
          // entri lokal sementara (akan disinkronkan lewat antrian/sync engine)
          App.state.entries.push({
            id: 'local-' + Date.now(), name, type: 'folder', parentId: App.state.cwd,
            size: 0, mime: '', deleted: false, version: 1, favorite: false,
            modified: new Date().toISOString(), _local: true,
          });
        } else {
          App.state.entries.push(r.data);
        }
        App.render();
        App.toast(r.queued ? 'Folder created — pending sync' : 'Folder created', 'success');
      });
  };

  /* ---------- upload dengan progress panel ---------- */
  App.renderUploadPanel = function () {
    const panel = $('#upload-panel');
    if (!panel) return;
    const ups = F.uploads.slice(-6);
    if (!ups.length) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="up-head"><b>Uploading…</b><button id="up-close" class="btn icon">✕</button></div>' +
      ups.map((u) => {
        const pct = Number.isFinite(u.progress) ? u.progress
          : (u.size ? Math.round((u.loaded / u.size) * 100) : (u.status === 'Done' ? 100 : 0));
        return '<div class="up-row" data-up="' + u.id + '">' +
          '<span class="up-name">' + App.esc(u.name) + '</span>' +
          '<div class="up-bar"><div class="up-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="up-pct">' + pct + '%</span>' +
          (u.status === 'Uploading' ? '<button class="btn icon" data-cancel="' + u.id + '" title="Batalkan">✕</button>' : '') +
          (u.status === 'Error' ? '<button class="btn icon" data-retry="' + u.id + '" title="Retry">↻</button>' +
            '<button class="btn icon" data-dismiss-upload="' + u.id + '" title="Cancel">✕</button>' : '') +
          '</div>';
      }).join('');
    panel.querySelector('#up-close').onclick = () => panel.classList.add('hidden');
    panel.querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = () => F.cancelUpload(b.dataset.cancel); });
    panel.querySelectorAll('[data-retry]').forEach((b) => {
      b.onclick = () => {
        const u = F.uploads.find((x) => x.id === b.dataset.retry);
        if (u && u._file) App.uploadOne(u._file, u._parentId);
      };
    });
    panel.querySelectorAll('[data-dismiss-upload]').forEach((b) => {
      b.onclick = () => {
        F.uploads = F.uploads.filter((upload) => upload.id !== b.dataset.dismissUpload);
        App.renderUploadPanel();
      };
    });
  };

  App.uploadOne = async function (file, parentId) {
    const id0 = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const u = { id: id0, name: file.name, size: file.size, loaded: 0, progress: 0, status: 'Uploading', _file: file, _parentId: parentId };
    F.uploads.push(u);
    App.renderUploadPanel();
    try {
      const r = await F.uploadWithProgress(file, parentId, () => App.renderUploadPanel(), u);
      u.status = 'Done'; u.loaded = u.size; u.progress = 100;
      const entry = r.data;
      const i = App.state.entries.findIndex((x) => x.id === entry.id);
      if (i >= 0) App.state.entries[i] = entry; else App.state.entries.push(entry);
      F.setStatus(entry.id, F.STATUS.SYNCED);
      App.toast('File uploaded', 'success'); // #33
    } catch (err) {
      const isCancel = String(err.message).includes('dibatalkan');
      const isNet = String(err.message).includes('jaringan');
      if (isNet && window.MMOffline) {
        await MMOffline.enqueue('upload', { parentId, name: file.name, mime: file.type, size: file.size, dataUrl: await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); }) });
        u.status = 'Pending'; App.toast('Offline — upload diantrikan', 'info');
      } else if (!isCancel) {
        u.status = 'Error';
        u.error = App.friendlyError(err, 'File gagal diupload. Periksa koneksi, ukuran file, permission, atau server.');
        App.toast(u.error, 'error');
      }
    }
    App.renderUploadPanel();
    App.render();
  };

  /* ---------- upload & drag&drop ---------- */
  App.uploadFiles = async function (fileList, parentId) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const f of files) await App.uploadOne(f, parentId);
    const failed = files.filter((file) => F.uploads.some((u) => u._file === file && u.status === 'Error')).length;
    App.toast(failed ? ('Upload selesai dengan ' + failed + ' kegagalan') : 'Semua upload selesai', failed ? 'error' : 'success');
  };

  async function readDirectoryEntries(reader) {
    const all = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) return all;
      all.push(...batch);
    }
  }

  async function collectDropEntry(entry, prefix, output) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      output.push({ file, relativePath: prefix + file.name });
      return;
    }
    if (!entry.isDirectory) return;
    const folderPrefix = prefix + entry.name + '/';
    const children = await readDirectoryEntries(entry.createReader());
    for (const child of children) await collectDropEntry(child, folderPrefix, output);
  }

  App.uploadDroppedItems = async function (dataTransfer, parentId) {
    const collected = [];
    const items = Array.from(dataTransfer.items || []);
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) await collectDropEntry(entry, '', collected);
    }
    if (!collected.length) {
      for (const file of Array.from(dataTransfer.files || [])) collected.push({ file, relativePath: file.name });
    }
    if (!collected.length) return;

    const folderCache = new Map([['', parentId]]);
    App.renderUploadPanel();
    for (const item of collected) {
      const parts = item.relativePath.split('/').filter(Boolean);
      parts.pop();
      let currentId = parentId;
      let currentPath = '';
      for (const segment of parts) {
        currentPath += (currentPath ? '/' : '') + segment;
        if (folderCache.has(currentPath)) { currentId = folderCache.get(currentPath); continue; }
        let folder = App.state.entries.find((entry) => !entry.deleted && entry.parentId === currentId && entry.type === 'folder' && entry.name === segment);
        if (!folder) {
          const result = await App.apiCall('createFolder', { parentId: currentId, name: segment });
          folder = result.queued
            ? { id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2), name: segment, type: 'folder', parentId: currentId, _local: true }
            : result.data;
          App.state.entries.push(folder);
        }
        currentId = folder.id;
        folderCache.set(currentPath, currentId);
      }
      await App.uploadOne(item.file, currentId);
    }
    App.render();
    App.toast(collected.length + ' file dari Windows Explorer diproses', 'success');
  };

  App.wireDnd = function () {
    let depth = 0;
    const hint = $('#dropzone-hint');
    document.body.addEventListener('dragenter', (ev) => {
      ev.preventDefault(); depth++; hint.classList.remove('hidden');
    });
    document.body.addEventListener('dragover', (ev) => ev.preventDefault());
    document.body.addEventListener('dragleave', () => {
      if (--depth <= 0) { depth = 0; hint.classList.add('hidden'); }
    });
    document.body.addEventListener('drop', (ev) => {
      ev.preventDefault(); depth = 0; hint.classList.add('hidden');
      if (ev.dataTransfer) App.uploadDroppedItems(ev.dataTransfer, App.state.cwd)
        .catch((error) => App.toast('Drag & drop gagal: ' + error.message, 'error'));
    });
  };
  App.wireDesktopContextMenu = function () {
    if (!window.gfmDesktop) return;
    document.addEventListener('contextmenu', (ev) => {
      const item = ev.target.closest('[data-id]');
      if (!item) return;
      const entry = App.state.entries.find((candidate) => candidate.id === item.dataset.id);
      if (entry) window.gfmDesktop.showContextMenu(entry);
    }, true);
    window.gfmDesktop.onContextAction((action, id) => {
      const entry = App.state.entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      if (action === 'open') App.openEntry(entry);
      else if (action === 'rename' || action === 'copy' || action === 'cut') App.openCtxMenu(16, 72, entry);
      else if (action === 'delete') App.apiCall('delete', { ids: [id] }).then(() => App.loadEntries()).then(() => App.render());
    });
  };
  window.App = App;
})();
/* __ACTIONS_PART2__ */
