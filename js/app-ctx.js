/* __ACTIONS_PART2__ marker */ /* context menu + aksi entri (dilanjutkan modul actions). */
(function () {
  'use strict';
  const MM = window.MM;
  const App = window.App;
  const $ = App.$;

  let clipboard = null;

  const CTX_MAIN = [
    { label: 'Open', act: (e) => App.openEntry(e) },
    { label: 'Preview', act: (e) => F.preview(e) },
    { label: 'Download', act: (e) => F.downloadOne(e) },
    { label: 'Rename', act: (e) => promptRename(e) },
    { label: 'Copy', act: (e) => { clipboard = { op: 'copy', ids: selIds(e) }; App.toast('Disalin ke clipboard'); } },
    { label: 'Cut', act: (e) => { clipboard = { op: 'cut', ids: selIds(e) }; App.toast('Siap dipindah (Cut)'); } },
  ];
  const CTX_TAIL = [
    { label: 'Move', act: (e) => App.pasteInto(e.type === 'folder' ? e.id : null) },
    { label: 'Favorite', act: async (e) => {
      const r = await App.apiCall('favorite', { id: e.id, on: !e.favorite });
      e.favorite = r.queued ? !e.favorite : r.data.favorite;
      App.render();
    } },
    { label: 'Share', act: (e) => openShare(e) },
    { label: 'Properties', act: (e) => showProperties(e) },
    { sep: true },
    { label: 'Delete', danger: true, act: (e) => confirmDelete(selIds(e)) },
  ];

  function selIds(e) {
    return App.state.selected.has(e.id) ? Array.from(App.state.selected) : [e.id];
  }

  App.copySelected = function () {
    const ids = Array.from(App.state.selected);
    if (!ids.length) return;
    clipboard = { op: 'copy', ids };
    App.toast(ids.length + ' item siap disalin. Buka folder tujuan lalu pilih Move/Paste.', 'success');
  };

  App.moveSelected = function () {
    const ids = Array.from(App.state.selected);
    if (!ids.length) return;
    const blocked = new Set(ids);
    const folders = App.state.entries.filter((entry) => !entry.deleted && entry.type === 'folder' && !blocked.has(entry.id));
    const options = '<option value="root">Workspace Root</option>' + folders.map((folder) =>
      '<option value="' + App.esc(folder.id) + '">' + App.esc(folder.name) + '</option>').join('');
    App.openDialog('Move ' + ids.length + ' item', '<select class="input" id="move-target">' + options + '</select>', async () => {
      const target = $('#move-target').value;
      const result = await App.apiCall('move', { ids, parentId: target });
      if (!result.queued) {
        ids.forEach((id) => { const entry = App.state.entries.find((item) => item.id === id); if (entry) entry.parentId = target; });
      }
      App.state.selected.clear(); App.render();
      App.toast(result.queued ? 'Move masuk Sync Queue' : ids.length + ' item dipindahkan', 'success');
    }, 'Move');
  };

  App.deleteSelected = function () {
    const ids = Array.from(App.state.selected);
    if (ids.length) confirmDelete(ids);
  };

  App.shareSelected = function () {
    const entries = App.state.entries.filter((entry) => App.state.selected.has(entry.id));
    if (!entries.length) return;
    if (entries.length === 1) { openShare(entries[0]); return; }
    App.openDialog('Share ' + entries.length + ' items',
      '<div class="share-wrap"><label class="share-opt"><input type="radio" name="bulk-share" value="private" checked> Private</label>' +
      '<label class="share-opt"><input type="radio" name="bulk-share" value="shared"> Shared (view-only)</label>' +
      '<label class="share-opt"><input type="radio" name="bulk-share" value="public"> Public Link</label>' +
      '<input class="input" id="bulk-share-emails" placeholder="email1@x.com, email2@x.com"></div>', async () => {
        const mode = (document.querySelector('input[name="bulk-share"]:checked') || {}).value || 'private';
        const emails = $('#bulk-share-emails').value;
        const links = [];
        for (const entry of entries) {
          const result = await App.apiCall('share', { id: entry.id, mode, emails });
          if (!result.queued && result.data && result.data.share) {
            entry.share = result.data.share;
            if (result.data.share.publicToken) links.push(location.origin + '/p/' + result.data.share.publicToken);
          }
        }
        if (links.length) {
          try { await navigator.clipboard.writeText(links.join('\n')); } catch {}
        }
        App.toast(entries.length + ' item sharing diperbarui' + (links.length ? '; link disalin' : ''), 'success');
      }, 'Apply');
  };

  App.openCtxMenu = function (x, y, e) {
    if (!App.state.selected.has(e.id)) {
      App.state.selected.clear();
      App.state.selected.add(e.id);
      App.render();
    }
    const menu = $('#ctx-menu');
    menu.innerHTML = '';
    const trashMode = App.state.filter === 'trash';
    const multi = App.state.selected.size > 1;
    let items;
    if (trashMode) {
      items = [
        { label: 'Restore', act: () => F.restore(selIds(e)) },
        { label: 'Delete Permanently', danger: true, act: () => F.purge(selIds(e)) },
      ];
    } else {
      items = CTX_MAIN.concat(
        (window.F && F.FCTX ? F.FCTX.filter((item) => !['Preview', 'Download'].includes(item.label)) : []),
        CTX_TAIL,
      );
      if (multi) items.unshift({ sep: true, label: App.state.selected.size + ' file terpilih' });
    }
    for (const it of items) {
      const li = document.createElement('li');
      if (it.sep) { li.className = 'sep'; menu.appendChild(li); continue; }
      li.textContent = it.label;
      if (it.danger) li.classList.add('danger');
      li.addEventListener('click', () => { closeCtxMenu(); it.act(e); });
      menu.appendChild(li);
    }
    menu.classList.remove('hidden');
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
  };

  /* Ctrl+A: pilih semua di tampilan aktif */
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      ev.preventDefault();
      App.state.selected = new Set(App.visibleList().map((e) => e.id));
      App.render();
      App.toast(App.state.selected.size + ' item dipilih');
    }
  });

  function closeCtxMenu() { $('#ctx-menu').classList.add('hidden'); }
  document.addEventListener('click', closeCtxMenu);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeCtxMenu(); });

  App.pasteInto = function (parentId) {
    if (!clipboard || !clipboard.ids.length) return;
    const target = parentId || App.state.cwd;
    (async () => {
      try {
        const res = await App.apiCall('move', { ids: clipboard.ids, parentId: target });
        if (!res.queued) {
          for (const id of clipboard.ids) {
            const e = App.state.entries.find((x) => x.id === id);
            if (e) e.parentId = target;
          }
        }
        if (clipboard.op === 'cut') clipboard = null;
        App.render();
        App.toast(res.queued ? 'Perubahan diantrikan (offline)' : res.data + ' entri dipindah');
      } catch (err) { App.toast('Gagal pindah: ' + err.message); }
    })();
  };

  function promptRename(e) {
    App.openDialog('Rename',
      '<input class="input" id="dlg-name" value="' + App.esc(e.name) + '">',
      async () => {
        const name = $('#dlg-name').value.trim();
        if (!name) return;
        const r = await App.apiCall('rename', { id: e.id, name });
        if (r.queued) e.name = name;
        else Object.assign(e, r.data);
        App.render();
        App.toast(r.queued ? 'File renamed — pending sync' : 'File renamed', 'success');
      });
  }

  /* ---------- #30 Share dialog: Private | Shared | Public Link ----------
     least privilege: default selalu Private; file TIDAK pernah public otomatis.
     Public Link memakai token acak dari server; tombol Copy Link menyalin URL. */
  const SHARE_MODES = [
    { v: 'private', label: 'Private — hanya saya' },
    { v: 'shared', label: 'Shared — user tertentu (view-only)' },
    { v: 'public', label: 'Public Link — siapa pun dengan link' },
  ];

  async function openShare(e) {
    let info = { mode: 'private', withUsers: [] };
    try {
      const r = await MM.api.call('shareInfo', { id: e.id });
      if (r && r.data && r.data.share) info = r.data.share;
    } catch (err) {
      App.toast('Info sharing tidak tersedia: ' + err.message, 'error');
      return;
    }
    const radios = SHARE_MODES.map((m) =>
      '<label class="share-opt"><input type="radio" name="share-mode" value="' + m.v + '"' +
      (info.mode === m.v ? ' checked' : '') + '><span>' + m.label + '</span></label>').join('');
    const usersHtml = (info.withUsers || []).map((w) => '<li>' + App.esc(w.email) + ' <em>(' + App.esc(w.role) + ')</em></li>').join('');
    App.openDialog('Share: ' + e.name,
      '<div class="share-wrap">' + radios +
      '<div class="share-users hidden" id="share-users"><input class="input" id="share-emails" placeholder="email1@x.com, email2@x.com">' +
      (usersHtml ? '<ul class="share-list">' + usersHtml + '</ul>' : '') + '</div>' +
      '<div class="share-link hidden" id="share-link"><input class="input" id="share-url" readonly>' +
      '<button type="button" class="btn" id="share-copy-link">Copy Link</button></div>' +
      '<p class="share-hint" id="share-hint"></p></div>',
    async () => {
      const mode = (document.querySelector('input[name="share-mode"]:checked') || {}).value || 'private';
      const emails = mode === 'shared' ? document.querySelector('#share-emails').value : '';
      const r = await App.apiCall('share', { id: e.id, mode: mode, emails: emails });
      if (r.queued) { App.toast('Perubahan sharing diantrikan (offline)', 'info'); return; }
      e.share = r.data.share;
      if (mode === 'public') {
        const url = location.origin + '/p/' + r.data.share.publicToken;
        // satu toast saja: elemen toast tunggal, toast kedua menimpa yang pertama
        let copied = false;
        try { await navigator.clipboard.writeText(url); copied = true; } catch {}
        App.toast(copied ? 'Link publik dibuat & disalin ke clipboard' : 'Link publik dibuat (clipboard gagal — salin manual)',
          copied ? 'success' : 'info');
      } else if (mode === 'shared') {
        App.toast(r.data.share.withUsers.length + ' user diberi akses (view-only)', 'success');
      } else {
        App.toast('Kembali ke Private', 'success');
      }
      App.render();
    }, 'Terapkan');

    const dlgBody = document.querySelector('#dialog-body');
    dlgBody.querySelector('#share-copy-link').addEventListener('click', async () => {
      const url = dlgBody.querySelector('#share-url').value;
      if (!url) { App.toast('Terapkan Public Link terlebih dahulu', 'info'); return; }
      try { await navigator.clipboard.writeText(url); App.toast('Link disalin', 'success'); }
      catch { App.toast('Clipboard tidak tersedia; salin link secara manual', 'error'); }
    });
    const syncUi = () => {
      const mode = (dlgBody.querySelector('input[name="share-mode"]:checked') || {}).value;
      dlgBody.querySelector('#share-users').classList.toggle('hidden', mode !== 'shared');
      const linkBox = dlgBody.querySelector('#share-link');
      linkBox.classList.toggle('hidden', mode !== 'public');
      if (mode === 'public' && e.share && e.share.publicToken) {
        linkBox.querySelector('#share-url').value = location.origin + '/p/' + e.share.publicToken;
      }
      dlgBody.querySelector('#share-hint').textContent = mode === 'private'
        ? 'File tidak dapat diakses siapa pun selain kamu.'
        : mode === 'shared' ? 'Hanya email terdaftar yang bisa melihat (read-only).'
        : 'Akhiri dengan Public lalu salin link. Bisa dicabut kapan saja (pilih Private).';
    };
    dlgBody.addEventListener('change', syncUi);
    syncUi();
  }

  function confirmDelete(ids) {
    App.openDialog('Hapus', '<p>Hapus ' + ids.length + ' entri?</p>', async () => {
      const r = await App.apiCall('delete', { ids });
      for (const id of ids) {
        const e = App.state.entries.find((x) => x.id === id);
        if (e) { e.deleted = true; e.deletedAt = new Date().toISOString(); }
      }
      App.state.selected.clear();
      App.render();
      App.toast(r.queued ? 'Hapus diantrikan (offline)' : 'Dihapus');
    });
  }

  function showProperties(e) {
    const pathParts = [];
    let cur = e.parentId;
    while (cur && cur !== 'root') {
      const p = App.state.entries.find((x) => x.id === cur);
      if (!p) break;
      pathParts.unshift(p.name);
      cur = p.parentId;
    }
    const pathStr = '/' + pathParts.join('/');
    const m = window.F ? F.metaOf(e, pathStr) : { fileId: e.id, extension: '', syncStatus: 'Synced' };
    App.openDialog('Properties',
      '<table class="props">' +
      '<tr><td>File Name</td><td>' + App.esc(e.name) + '</td></tr>' +
      '<tr><td>Type</td><td>' + (e.type === 'folder' ? 'Folder' : (e.mime || 'file')) + '</td></tr>' +
      '<tr><td>Location</td><td>' + App.esc(pathStr) + '</td></tr>' +
      '<tr><td>Size</td><td>' + (e.type === 'folder' ? '—' : MM.util.fmtSize(e.size)) + '</td></tr>' +
      '<tr><td>Created</td><td>' + MM.util.fmtDate(e.created || e.modified) + '</td></tr>' +
      '<tr><td>Modified</td><td>' + MM.util.fmtDate(e.modified) + '</td></tr>' +
      '<tr><td>Extension</td><td>' + (m.extension ? '.' + App.esc(m.extension) : '—') + '</td></tr>' +
      '<tr><td>File ID</td><td>' + App.esc(m.fileId) + '</td></tr>' +
      '<tr><td>Sync Status</td><td>' + App.esc(m.syncStatus) + '</td></tr>' +
      (window.gfmDesktop || e._local
        ? '<tr><td>Local Path</td><td>' + App.esc((window.App.desktopInfo ? App.desktopInfo.workspaceRoot : '') + pathStr + '/' + e.name) + '</td></tr>'
        : '<tr><td>Google Drive ID</td><td>' + App.esc(e.driveFileId || m.fileId) + '</td></tr>') +
      '</table>', null, 'Tutup');
  }
  window.App = App;
})();
