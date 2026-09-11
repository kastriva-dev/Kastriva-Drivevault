/* app-main.js — inti UI: state, render grid/list, breadcrumb, navigasi (window.App). */
(function () {
  'use strict';
  const MM = window.MM;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const App = {
    state: {
      entries: [],
      cwd: 'root',
      view: 'grid',
      filter: 'all',
      search: '',
      selected: new Set(),
      lastClickedIndex: -1,
      orderedIds: [],
    },
    clipboard: null,
    $: $,
    $$: $$,
  };
  App.desktopInfo = null;

  App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  };

  let toastTimer = null;
  App.friendlyError = function (error, fallback) {
    const raw = String(error && error.message ? error.message : error || '').trim();
    if (!raw || /^(undefined|null)$/i.test(raw)) return fallback || 'Operasi tidak dapat diselesaikan.';
    if (/unauthorized|\bauth\b|session|sesi/i.test(raw)) return 'Sesi berakhir. Silakan login kembali.';
    if (/network|fetch|jaringan|internet|ECONN|timeout|timed out/i.test(raw)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
    if (/permission|forbidden|access denied|akses ditolak/i.test(raw)) return 'Permission tidak mencukupi untuk operasi ini.';
    if (/too large|ukuran|payload|413/i.test(raw)) return 'Ukuran file melebihi batas yang diizinkan.';
    if (/TypeError|ReferenceError|SyntaxError|\bat\s+\w|stack|<html/i.test(raw)) return fallback || 'Terjadi kesalahan aplikasi. Silakan coba lagi.';
    return raw.slice(0, 180);
  };
  /* #33 NOTIFICATION SYSTEM: toast dengan varian sukses/error/info (default info) */
  App.toast = function (msg, kind) {
    const t = $('#toast');
    t.textContent = kind === 'error' ? App.friendlyError(msg) : String(msg || 'Informasi diperbarui.');
    t.classList.remove('hidden', 'toast-success', 'toast-error', 'toast-info');
    t.classList.add('toast-' + (kind === 'success' || kind === 'error' ? kind : 'info'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 4200 : 2600);
  };

  App.setLoading = function (loading) {
    const state = $('#loading-state');
    if (state) state.classList.toggle('hidden', !loading);
  };
  App.showLoadError = function (error) {
    const box = $('#load-error');
    const detail = $('#load-error-detail');
    if (detail) detail.textContent = App.friendlyError(error, 'Periksa koneksi internet lalu coba lagi.');
    if (box) box.classList.remove('hidden');
  };
  App.hideLoadError = function () {
    const box = $('#load-error');
    if (box) box.classList.add('hidden');
  };

  App.openDialog = function (title, bodyHtml, onOk, okLabel) {
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = bodyHtml;
    $('#dialog-ok').textContent = okLabel || 'OK';
    const dlg = $('#dialog');
    $('#dialog-ok').onclick = async (ev) => {
      ev.preventDefault();
      try { if (onOk) await onOk(); dlg.close(); }
      catch (err) { App.toast('Error: ' + err.message); }
    };
    $('#dialog-cancel').onclick = () => dlg.close();
    dlg.showModal();
  };

  App.loadEntries = async function () {
    App.setLoading(true);
    App.hideLoadError();
    try {
      const r = await MM.api.list();
      App.state.entries = r.data;
      MM.store.save(r.data.filter((e) => !e.deleted));
      if (window.MMOffline) MMOffline.cacheEntries(r.data); // simpan cache IndexedDB utk offline
      // Kuota: desktop membaca disk lokal; cloud membaca Google Drive melalui GAS.
      try {
        const q = await MM.api.call('quota');
        if (window.gfmDesktop) App.localQuota = q.data;
        else {
          App.cloudUsed = q.data.used;
          App.CLOUD_QUOTA = q.data.limit || App.CLOUD_QUOTA;
          App.cloudSource = q.data.source || (q.data.drive ? 'Drive API' : 'server');
        }
      } catch { /* browser tetap dapat memakai Storage API */ }
      if (window.gfmDesktop && App.desktopInfo && App.desktopInfo.cloudConfigured) {
        try {
          const cq = await MM.cloudApi.call('quota');
          App.cloudUsed = cq.data.used;
          App.CLOUD_QUOTA = cq.data.limit || App.CLOUD_QUOTA;
          App.cloudSource = cq.data.source || 'Google Drive';
        } catch { /* tampilkan metadata file sebagai fallback */ }
      }
      return true;
    } catch (err) {
      // offline: pakai cache IndexedDB, fallback localStorage
      let cached = null;
      if (window.MMOffline) cached = await MMOffline.getCachedEntries();
      App.state.entries = cached || MM.store.load();
      if (App.state.entries.length) App.toast('Offline — menampilkan data lokal', 'info');
      else App.showLoadError(err);
      return App.state.entries.length > 0;
    } finally {
      App.setLoading(false);
    }
  };

  /* pembungkus API offline-aware: gagal jaringan -> masuk antrian offline changes */
  App.apiCall = async function (op, payload) {
    try {
      return await MM.api.call(op, payload);
    } catch (err) {
      const offlineLike = !navigator.onLine || /fetch|network|Failed/i.test(String(err.message));
      if (!offlineLike || !window.MMOffline) throw err;
      await MMOffline.enqueue(op, payload);
      App.toast('Offline — perubahan disimpan di antrian (' + op + ')');
      return { ok: true, queued: true };
    }
  };

  App.markOpened = async function (entry) {
    if (!entry || entry.type !== 'file') return;
    entry.lastOpened = new Date().toISOString();
    MM.store.save(App.state.entries);
    if (window.gfmDesktop) {
      try { await MM.api.call('markOpened', { id: entry.id }); } catch { /* riwayat lokal tetap tersimpan */ }
    }
  };

  App.visibleList = function () {
    const st = App.state;
    let out;
    if (st.search) {
      out = st.entries.filter((e) => !e.deleted && F.matchesSearch(e, st.search, st.entries));
    } else {
      out = st.entries.filter((e) => !e.deleted && e.parentId === st.cwd);
      if (st.filter === 'favorites') out = st.entries.filter((e) => !e.deleted && e.favorite);
      if (st.filter === 'photos') out = st.entries.filter((e) => MM.util.isImage(e));
      if (st.filter === 'trash') out = F.trashList();
      if (st.filter === 'recent') {
        out = st.entries.filter((e) => !e.deleted && e.type === 'file')
          .sort((a, b) => Date.parse(b.lastOpened || b.modifiedTime || b.modified || 0) - Date.parse(a.lastOpened || a.modifiedTime || a.modified || 0))
          .slice(0, 20);
      }
    }
    out = out.filter((e) => F.matchFilters(e));
    const sorted = F.applySort([...out]);
    // folder selalu di atas (kecuali sort eksplisit diminta), lalu arah sort
    if (F.sortKey === 'name' && !st.search) {
      sorted.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1) || a.name.localeCompare(b.name) * (F.sortDir === 'desc' ? -1 : 1));
    }
    return sorted;
  };

  App.render = function () {
    const st = App.state;
    const list = App.visibleList();
    st.orderedIds = list.map((e) => e.id);
    const grid = $('#grid');
    const listEl = $('#list');
    grid.innerHTML = '';
    listEl.querySelectorAll('.list-row:not(.list-head)').forEach((r) => r.remove());
    $('#empty-state').classList.toggle('hidden', list.length > 0);
    $('#btn-back').disabled = st.cwd === 'root';
    App.renderBreadcrumb();
    App.renderSelectionInfo();
    list.forEach((e, idx) => {
      const el = st.view === 'grid' ? cardEl(e, idx) : rowEl(e, idx);
      (st.view === 'grid' ? grid : listEl).appendChild(el);
    });
    App.renderStorage();
  };
  App.renderBreadcrumb = function () {
    const bc = $('#breadcrumb');
    bc.innerHTML = '';
    const mk = (label, id) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => App.openFolder(id));
      return b;
    };
    bc.appendChild(mk(App.desktopInfo ? '🖥️ Workspace Root' : '🏠 Root', 'root'));
    const path = [];
    let cur = App.state.cwd;
    while (cur && cur !== 'root') {
      const e = App.state.entries.find((x) => x.id === cur);
      if (!e) break;
      path.unshift(e);
      cur = e.parentId;
    }
    for (const e of path) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      bc.appendChild(sep);
      bc.appendChild(mk(e.name, e.id));
    }
  };

  /* Storage Dashboard: Local (Storage API) + Cloud (total ukuran file server) — Used/Free/Total */
  App.CLOUD_QUOTA = 15 * 1024 * 1024 * 1024; // dasar Google Drive gratis; hanya utk persentase bar
  App.renderStorage = async function () {
    const files = App.state.entries.filter((e) => !e.deleted && e.type === 'file');
    const cloudTotal = App.cloudUsed != null ? App.cloudUsed
      : files.reduce((s, e) => s + (e.size || 0), 0);
    const cloudLimit = App.CLOUD_QUOTA || 0;
    const cloudPercent = cloudLimit ? Math.min(100, (cloudTotal / cloudLimit) * 100) : 0;
    const cloudFill = $('#storage-cloud-fill');
    const cloudFree = $('#storage-cloud-free');
    const cloudPct = $('#storage-cloud-percent');
    const text = $('#storage-text');
    if (cloudFill) cloudFill.style.width = cloudPercent.toFixed(2) + '%';
    if (cloudPct) cloudPct.textContent = cloudLimit ? Math.round(cloudPercent) + '%' : '—';
    if (cloudFree) cloudFree.innerHTML =
      '<span>Used: ' + MM.util.fmtSize(cloudTotal) + '</span>' +
      '<span>Free: ' + (cloudLimit ? MM.util.fmtSize(Math.max(0, cloudLimit - cloudTotal)) : '—') + '</span>' +
      '<span>Total: ' + (cloudLimit ? MM.util.fmtSize(cloudLimit) : 'Quota API unavailable') + '</span>';
    if (text) text.textContent = files.length + ' file • cloud ' + MM.util.fmtSize(cloudTotal);
    // local via Storage API (asinkron, diperbarui saat datanya siap)
    try {
      if (window.gfmDesktop && App.localQuota) {
        const used = App.localQuota.used || 0;
        const quota = App.localQuota.limit || 0;
        const free = App.localQuota.free == null ? Math.max(0, quota - used) : App.localQuota.free;
        const percent = quota ? Math.min(100, (used / quota) * 100) : 0;
        $('#storage-local-fill').style.width = percent.toFixed(2) + '%';
        $('#storage-local-percent').textContent = Math.round(percent) + '%';
        $('#storage-local-free').innerHTML = '<span>Used: ' + MM.util.fmtSize(used) + '</span><span>Free: ' + MM.util.fmtSize(free) + '</span><span>Total: ' + MM.util.fmtSize(quota) + '</span>';
        return;
      }
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const used = est.usage || 0;
        const quota = est.quota || 0;
        const lf = $('#storage-local-fill');
        const lfree = $('#storage-local-free');
        if (lf && quota) lf.style.width = Math.min(100, (used / quota) * 100).toFixed(2) + '%';
        const lpct = $('#storage-local-percent');
        if (lpct) lpct.textContent = quota ? Math.round(Math.min(100, (used / quota) * 100)) + '%' : '—';
        if (lfree && quota) lfree.innerHTML = '<span>Used: ' + MM.util.fmtSize(used) + '</span><span>Free: ' + MM.util.fmtSize(Math.max(0, quota - used)) + '</span><span>Total: ' + MM.util.fmtSize(quota) + '</span>';
      } else {
        const lfree = $('#storage-local-free');
        if (lfree) lfree.textContent = 'Storage API tidak tersedia';
      }
    } catch { /* abaikan */ }
  };

  App.renderSelectionInfo = function () {
    const el = $('#selection-info');
    const actions = $('#selection-actions');
    if (!App.state.selected.size) {
      el.classList.add('hidden');
      if (actions) actions.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (actions) actions.classList.toggle('hidden', App.state.selected.size < 2);
    el.textContent = App.state.selected.size + (App.state.selected.size === 1 ? ' file selected' : ' files selected');
  };
  function cardEl(e, idx) {
    const div = document.createElement('div');
    div.className = 'card' + (App.state.selected.has(e.id) ? ' selected' : '');
    div.dataset.id = e.id;
    div.dataset.idx = idx;
    div.innerHTML =
      '<div class="thumb">' + MM.util.iconFor(e) + '</div>' +
      '<div class="name" title="' + App.esc(e.name) + '">' + App.esc(e.name) + '</div>' +
      '<div class="meta">' + (e.type === 'folder' ? 'Folder' : MM.util.fmtSize(e.size)) + '</div>' +
      (e.favorite ? '<span class="fav">⭐</span>' : '');
    wireItem(div, e, idx);
    return div;
  }

  function rowEl(e, idx) {
    const div = document.createElement('div');
    div.className = 'list-row' + (App.state.selected.has(e.id) ? ' selected' : '');
    div.dataset.id = e.id;
    div.dataset.idx = idx;
    div.innerHTML =
      '<span class="c-name"><span>' + MM.util.iconFor(e) + '</span>' +
      '<span class="nm" title="' + App.esc(e.name) + '">' + App.esc(e.name) + '</span></span>' +
      '<span class="c-type">' + MM.util.typeLabel(e) + '</span>' +
      '<span class="c-size">' + (e.type === 'folder' ? '—' : MM.util.fmtSize(e.size)) + '</span>' +
      '<span class="c-modified">' + MM.util.fmtRelativeDate(e.modifiedTime || e.modified) + '</span>';
    wireItem(div, e, idx);
    return div;
  }

  function wireItem(el, e, idx) {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); App.handleClick(ev, e, idx); });
    el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); App.openEntry(e); });
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      App.openCtxMenu(ev.clientX, ev.clientY, e);
    });
  }
  window.App = App;
})();
