/* app-sync.js — sync UI, PWA (install prompt, offline), init GFileManager. */
(function () {
  'use strict';
  const MM = window.MM;
  const App = window.App;
  const $ = App.$;
  const $$ = App.$$;

  /* ---------- status Online/Offline + Sync Queue UI ---------- */
  App.renderQueueUI = async function () {
    if (!window.MMOffline) return;
    const items = await MMOffline.renderQueue();
    const ul = $('#queue-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'queue-empty';
      li.textContent = 'Antrian kosong — semua perubahan tersinkron ke Google Drive.';
      ul.appendChild(li);
      return;
    }
    for (const it of items) {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + it.label + '</span><span class="q-detail">' + App.esc(it.detail) + '</span>' +
        (it.tries ? '<span class="q-tries">gagal ' + it.tries + '×</span>' : '');
      li.title = 'Diantrikan: ' + it.ts;
      ul.appendChild(li);
    }
  };

  App.wireNet = function () {
    if (!window.MMOffline) return;
    const pill = $('#net-status');
    const badge = $('#offline-badge');
    MMOffline.onChange(({ online }) => {
      pill.textContent = online ? '● Online' : '● Offline';
      pill.classList.toggle('off', !online);
      document.body.classList.toggle('is-offline', !online);
    });
    MMOffline.wire();
    document.addEventListener('gfm:queue', (ev) => {
      badge.textContent = ev.detail ? '⏳ ' + ev.detail + ' perubahan offline' : '';
      badge.classList.toggle('hidden', !ev.detail);
    });
    MMOffline.updateBadge();
    const target = $('#sync-target-mode');
    if (target && !window.gfmDesktop) target.textContent = window.GFM_GAS_URL ? '(GAS aktif)' : '(proxy /api/gas)';
  };

  /* ---------- Conflict handling UI ---------- */
  App.renderConflictsUI = async function () {
    if (!window.MMConflicts) return;
    const items = await MMConflicts.list();
    const ul = $('#conflict-list');
    const cnt = $('#conflict-count');
    if (!ul) return;
    if (cnt) cnt.textContent = String(items.length);
    ul.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'queue-empty';
      li.textContent = 'Tidak ada konflik — semua versi selaras.';
      ul.appendChild(li);
      return;
    }
    for (const c of items) {
      const li = document.createElement('li');
      li.className = 'conflict-item';
      const meta = (s) => s ? `Modified ${MM.util.fmtDate(s.modified)} • ${MM.util.fmtSize(s.size)} • v${s.version || 1}` : 'tidak ada';
      li.innerHTML =
        '<span><b>File:</b> ' + App.esc(c.name) + '</span>' +
        '<span class="q-tries">' + c.ts.slice(0, 16).replace('T', ' ') + '</span>' +
        '<span class="q-meta"><b>Local:</b> ' + meta(c.local) + '<br><b>Cloud:</b> ' + meta(c.cloud) + '</span>' +
        '<span class="res-btns">' +
        '<button class="btn" data-res="local">Keep Local</button>' +
        '<button class="btn" data-res="cloud">Keep Cloud</button>' +
        '<button class="btn" data-res="both">Keep Both</button>' +
        '<button class="btn" data-res="compare">Compare</button>' +
        '</span>';
      li.querySelectorAll('.res-btns .btn').forEach((b) => {
        b.addEventListener('click', () => b.dataset.res === 'compare' ? App.compareConflict(c) : App.resolveConflict(c, b.dataset.res, li));
      });
      ul.appendChild(li);
    }
  };

  App.resolveConflict = async function (c, choice, li) {
    const buttons = li.querySelectorAll('.res-btns .btn');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      if (choice === 'local') {
        // dorong versi lokal ke cloud (timpa cloud SETELAH user memilih)
        const fresh = (App.state.entries.find((x) => x.id === c.entryId)) || null;
        const le = fresh || { id: c.entryId, name: c.name, parentId: c.parentId, type: c.type, mime: c.mime };
        if (le.type === 'folder') {
          await App.apiCall('createFolder', { parentId: le.parentId, name: le.name });
        } else {
          const blob = await MM.blobStore.get(le.id);
          await App.apiCall('upload', {
            parentId: le.parentId, name: le.name, mime: le.mime,
            size: blob ? blob.size : (c.local && c.local.size) || 0,
            dataUrl: blob ? await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }) : undefined,
          });
        }
      } else if (choice === 'cloud') {
        // tarik versi cloud ke lokal
        const cloudEntries = (await MM.api.list()).data;
        const ce = cloudEntries.find((x) => x.id === c.entryId);
        if (ce && ce.type !== 'folder') {
          const d = await MM.api.download(ce.id);
          const blob = await (await fetch(d.dataUrl)).blob();
          await MM.blobStore.put(ce.id, blob);
          App.localUpsert(d.entry);
        } else if (ce) {
          App.localUpsert(ce);
        }
      } else { // both: simpan salinan lokal tanpa menghapus versi cloud
        const cloudEntries = (await MM.api.list()).data;
        const ce = cloudEntries.find((x) => x.id === c.entryId);
        const newName = MM.sync.localCopyName(c.name);
        if (ce && ce.type !== 'folder') {
          const d = await MM.api.download(ce.id);
          const blob = await (await fetch(d.dataUrl)).blob();
          const r = await App.apiCall('upload', { parentId: c.cloudParentId || c.parentId, name: newName, mime: c.mime, size: blob.size, dataUrl: d.dataUrl });
          if (!r.queued) App.localUpsert(r.data);
        } else if (ce) {
          const r = await App.apiCall('createFolder', { parentId: c.cloudParentId || c.parentId, name: newName });
          if (!r.queued) App.localUpsert(r.data);
        }
      }
      await MMConflicts.remove(c.entryId);
      if (window.F) F.setStatus(c.entryId, F.STATUS.SYNCED);
      App.toast('Konflik "' + c.name + '" diselesaikan: ' +
        (choice === 'local' ? 'Keep Local' : choice === 'cloud' ? 'Keep Cloud' : 'Keep Both — Local Copy dibuat'));
    } catch (err) {
      App.toast('Gagal menyelesaikan konflik: ' + err.message);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
      await App.loadEntries();
      App.render();
      App.renderConflictsUI();
    }
  };

  App.compareConflict = function (c) {
    const row = (label, local, cloud) => '<tr><td>' + label + '</td><td>' + App.esc(local == null ? '—' : local) + '</td><td>' + App.esc(cloud == null ? '—' : cloud) + '</td></tr>';
    App.openDialog('Compare — ' + c.name,
      '<table class="props conflict-compare"><thead><tr><th>Metadata</th><th>Local</th><th>Cloud</th></tr></thead><tbody>' +
      row('Modified', c.local && MM.util.fmtDate(c.local.modified), c.cloud && MM.util.fmtDate(c.cloud.modified)) +
      row('Size', c.local && MM.util.fmtSize(c.local.size), c.cloud && MM.util.fmtSize(c.cloud.size)) +
      row('Version', c.local && c.local.version, c.cloud && c.cloud.version) +
      row('Hash', c.local && c.local.hash, c.cloud && c.cloud.hash) +
      '</tbody></table><p class="share-hint">Tidak ada file yang diubah saat membandingkan.</p>', null, 'Tutup');
  };

  App.renderSyncState = function () {
    const logs = MM.store.loadSyncLog();
    const logEl = $('#sync-log');
    if (logEl) logEl.textContent = logs.length ? logs.join('\n') : 'Belum ada sync.';
    const side = $('#side-sync-state');
    if (side) side.textContent = logs.length ? logs[logs.length - 1] : 'belum pernah';
  };

  App.runSync = async function (mode) {
    const btns = $$('.sync-mode');
    btns.forEach((b) => { b.disabled = true; });
    const logEl = $('#sync-log');
    logEl.textContent = 'Menjalankan sync (' + mode + ')…';
    try {
      const res = await MM.sync.run({
        mode: mode,
        getLocal: async () => MM.store.load().filter((e) => !e.deleted),
        getCloud: async () => (await MM.cloudApi.list()).data.filter((e) => e.parentId !== undefined),
        pushEntry: async (e) => {
          if (e.type === 'folder') { await MM.cloudApi.createFolder(e.parentId, e.name, e.syncKey || e.id); return; }
          let blob = await MM.blobStore.get(e.id);
          if (!blob && window.gfmDesktop) {
            const local = await MM.api.download(e.id);
            blob = await (await fetch(local.dataUrl)).blob();
          }
          await MM.cloudApi.upload(e.parentId, e.name, e.mime, blob || new Blob(['']), e.syncKey || e.id);
        },
        pullEntry: async (e) => {
          if (e.type === 'folder') { App.localUpsert(e); return; }
          const d = await MM.cloudApi.download(e.id);
          const blob = await (await fetch(d.dataUrl)).blob();
          if (window.gfmDesktop) {
            await MM.api.call('upload', { parentId: e.parentId, name: e.name, mime: e.mime, dataUrl: d.dataUrl, syncKey: e.syncKey || e.id });
          } else {
            await MM.blobStore.put(e.id, blob);
            App.localUpsert(d.entry);
          }
        },
        copyEntry: async (e, newName) => {
          if (e.type === 'folder') {
            const r = await MM.api.createFolder(e.parentId, newName);
            App.localUpsert(r.data);
            return;
          }
          const d = await MM.cloudApi.download(e.id);
          const blob = await (await fetch(d.dataUrl)).blob();
          const r = await MM.cloudApi.upload(e.parentId, newName, e.mime, blob, 'conflict-' + Date.now());
          App.localUpsert(r.data);
        },
        deleteLocal: async (ids) => {
          const all = MM.store.load();
          for (const id of ids) {
            const e = all.find((x) => x.id === id);
            if (e) { e.deleted = true; e.deletedAt = new Date().toISOString(); }
          }
          MM.store.save(all);
        },
        deleteCloud: async (ids) => { await MM.cloudApi.del(ids); },
        onLog: (line) => { logEl.textContent += line + '\n'; },
      });
      const all = MM.store.loadSyncLog().concat(res.log);
      MM.store.saveSyncLog(all);
      App.renderSyncState();
      await App.loadEntries();
      App.render();
      App.renderConflictsUI();
      App.toast(res.conflicts
        ? ('Sync conflict — ' + res.conflicts + ' item menunggu keputusan')
        : ('Sync completed — ' + res.pushed + ' push, ' + res.pulled + ' pull'),
      res.conflicts ? 'error' : 'success');
    } catch (err) {
      logEl.textContent += '\nSYNC GAGAL: ' + err.message;
      App.toast('Sync gagal: ' + err.message);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  };

  App.localUpsert = function (entry) {
    const all = MM.store.load();
    const i = all.findIndex((x) => x.id === entry.id);
    if (i >= 0) all[i] = entry; else all.push(entry);
    MM.store.save(all);
  };

  /* ---------- PWA ---------- */
  App.wirePwa = function () {
    const updateNet = () => {}; // digantikan App.wireNet (MMOffline)
    window.addEventListener('online', () => { updateNet(); App.toast('Kembali online'); });
    window.addEventListener('offline', () => { updateNet(); App.toast('Anda offline — mode lokal aktif'); });
    updateNet();

    let deferredPrompt = null;
    const btn = $('#btn-install');
    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      deferredPrompt = ev;
      btn.classList.remove('hidden');
    });
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) { App.toast('Install manual: menu browser → Install'); return; }
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        btn.classList.add('hidden');
        App.toast('Terima kasih sudah menginstall!');
      }
      deferredPrompt = null;
    });
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {});
      });
    }
  };

  /* ---------- init ---------- */
  async function init() {
    if (window.MMAuth) MMAuth.wire(); // #29: gate sesi sebelum data dimuat
    if (window.MMAuth && !MMAuth.isAuth()) return; // overlay login tampil; muat data setelah login
    App.wireToolbar();
    App.wireDnd();
    App.wireDesktopContextMenu();
    App.wireNet();
    App.wirePwa();
    await App.loadEntries();
    App.render();
    App.renderSyncState();
    App.renderQueueUI();
    App.renderConflictsUI();
    document.addEventListener('gfm:queue', () => App.renderQueueUI());
    window.addEventListener('error', () => App.toast('Terjadi kesalahan aplikasi. Silakan coba lagi.', 'error'));
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      App.toast(App.friendlyError(event.reason), 'error');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.App = App;
})();
