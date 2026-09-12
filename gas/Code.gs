/**
 * GFileManager — Backend Google Apps Script (deploy sebagai Web App).
 * Simpan metadata di PropertiesService (JSON), blob file di Google Drive.
 * API: ?action=list|upload|delete|createFolder|rename|move|favorite|download
 * Semua respons: {ok: bool, data?: any, error?: string}
 */
var PROPS = PropertiesService.getScriptProperties();

/* ---------- metadata ---------- */
function loadMeta_() {
  var raw = PROPS.getProperty(META_KEY);
  if (raw) return JSON.parse(raw);
  // Migrasi metadata versi lama yang masih disimpan sebagai satu property.
  var legacy = PROPS.getProperty('GFM_ENTRIES_V2');
  if (legacy) {
    try { return JSON.parse(legacy); } catch (_) {}
  }
  var count = Number(PROPS.getProperty(META_KEY + '_COUNT') || 0);
  if (count > 0) {
    var parts = [];
    for (var i = 0; i < count; i++) parts.push(PROPS.getProperty(META_KEY + '_' + i) || '');
    raw = parts.join('');
    if (raw) return JSON.parse(raw);
  }
  return { entries: [], seq: 1 };
}
function saveMeta_(db) {
  var raw = JSON.stringify(db);
  // Metadata dapat melewati batas satu property; simpan dalam chunk kecil.
  var oldCount = Number(PROPS.getProperty(META_KEY + '_COUNT') || 0);
  PROPS.deleteProperty(META_KEY);
  var count = Math.ceil(raw.length / META_CHUNK_SIZE);
  for (var i = 0; i < count; i++) {
    PROPS.setProperty(META_KEY + '_' + i, raw.slice(i * META_CHUNK_SIZE, (i + 1) * META_CHUNK_SIZE));
  }
  for (var j = count; j < oldCount; j++) PROPS.deleteProperty(META_KEY + '_' + j);
  PROPS.setProperty(META_KEY + '_COUNT', String(count));
}
function find_(db, id) {
  for (var i = 0; i < db.entries.length; i++) if (db.entries[i].id === id) return db.entries[i];
  return null;
}
function ownedFind_(db, id, userId) {
  var entry = find_(db, id);
  return entry && entry.owner === userId ? entry : null;
}
function canRead_(entry, user) {
  if (!entry || !user) return false;
  if (entry.owner === user.id) return true;
  var share = entry.share || {};
  if (share.mode !== 'shared') return false;
  return (share.withUsers || []).some(function (permission) {
    return permission.userId === user.id && permission.role === 'viewer';
  });
}
function uniqueName_(db, parentId, name) {
  var n = name, i = 1;
  var taken = db.entries.some(function (e) {
    return !e.deleted && e.parentId === parentId && e.name.toLowerCase() === String(n).toLowerCase();
  });
  while (taken) {
    var dot = name.lastIndexOf('.');
    n = dot > 0 ? name.slice(0, dot) + ' (' + i + ')' + name.slice(dot) : name + ' (' + i + ')';
    i++;
    taken = db.entries.some(function (e) {
      return !e.deleted && e.parentId === parentId && e.name.toLowerCase() === String(n).toLowerCase();
    });
  }
  return n;
}
/* least privilege (#30): mode share wajib eksplisit private|shared|public,
   tidak ada aksi yang otomatis me-public-kan file. */
var SHARE_MODES = { 'private': 1, 'shared': 1, 'public': 1 };

/* ---------- handler ---------- */
function handle_(action, p) {
  var db = loadMeta_();
  p = p || {};
  try {
    if (AUTH_ACTIONS[action]) return authHandle_(action, p);
    var writeLock = LockService.getScriptLock();
    writeLock.waitLock(30000);
    try {
    var currentUser = null;
    if (!PUBLIC_ACTIONS[action]) {
      currentUser = authRequireUser_(p.token);
      if (!currentUser) return apiError_('Unauthorized', 'AUTH');
      p._user = currentUser;
    }
    var validationError = validateRequest_(action, p, currentUser);
    if (validationError) return validationError;
    switch (action) {
      case 'list':
        return apiSuccess_(db.entries.filter(function (e) { return e.owner === currentUser.id; }).map(enrichMetadata_), 'Daftar file');
      case 'quota': {
        var fallbackUsed = db.entries.filter(function (e) { return e.owner === currentUser.id && !e.deleted && e.type === 'file'; })
          .reduce(function (sum, e) { return sum + Number(e.size || 0); }, 0);
        return apiSuccess_(driveQuota_(fallbackUsed), 'Quota storage');
      }
      case 'createFolder': {
        var pid = p.parentId || 'root';
        if (pid !== 'root' && (!ownedFind_(db, pid, currentUser.id) || ownedFind_(db, pid, currentUser.id).type !== 'folder'))
          return { ok: false, error: 'parentId tidak valid' };
        var e = {
          id: 'id-' + Utilities.getUuid(), name: uniqueName_(db, pid, sanitizeName_(p.name || 'Folder Baru')),
          type: 'folder', parentId: pid, size: 0, mime: '', deleted: false,
          version: 1, favorite: false, modified: new Date().toISOString(), owner: currentUser.id
        };
        db.entries.push(e); saveMeta_(db);
        driveCreateFolderForEntry_(e); // mirror folder di Drive
        return { ok: true, data: e };
      }
      case 'upload': {
        var pid = p.parentId || 'root';
        if (pid !== 'root' && (!ownedFind_(db, pid, currentUser.id) || ownedFind_(db, pid, currentUser.id).type !== 'folder'))
          return { ok: false, error: 'parentId tidak valid' };
        if (!p.name || !p.dataUrl) return { ok: false, error: 'name/dataUrl wajib' };
        var safeName = sanitizeName_(p.name); // #32: nama dari client tidak pernah dipercaya
        var blob = Utilities.newBlob(Utilities.base64Decode(String(p.dataUrl).split(',')[1]),
          p.mime || 'application/octet-stream', safeName);
        var existing = null;
        for (var i = 0; i < db.entries.length; i++) {
          var x = db.entries[i];
          if (x.owner === currentUser.id && !x.deleted && x.parentId === pid && x.name.toLowerCase() === String(safeName).toLowerCase() && x.type === 'file') { existing = x; break; }
        }
        var file = driveCreateOrReplaceFile_(existing || { parentId: pid, name: safeName }, blob);
        if (existing) {
          existing.size = blob.getBytes().length;
          existing.mime = blob.getContentType();
          existing.driveFileId = file.getId();
          existing.previewUrl = drivePreviewUrl_(file.getId());
          existing.hash = hexDigest_(blob.getBytes()); existing.syncStatus = 'Synced';
          touch_(existing); saveMeta_(db);
          return { ok: true, data: enrichMetadata_(existing) };
        }
        var nf = {
          id: 'id-' + Utilities.getUuid(), name: safeName, type: 'file', parentId: pid,
          size: blob.getBytes().length, mime: blob.getContentType(), deleted: false,
          version: 1, favorite: false, created: new Date().toISOString(), modified: new Date().toISOString(),
          hash: hexDigest_(blob.getBytes()), syncStatus: 'Synced', driveFileId: file.getId(),
          previewUrl: drivePreviewUrl_(file.getId()), owner: currentUser.id
        };
        db.entries.push(nf); saveMeta_(db);
        return { ok: true, data: enrichMetadata_(nf) };
      }
      case 'delete': {
        var ids = p.ids || (p.id ? [p.id] : []);
        var n = 0;
        ids.forEach(function (id) { if (ownedFind_(db, id, currentUser.id)) n += markDeleted_(db, id, currentUser.id); });
        saveMeta_(db);
        return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dihapus' };
      }
      case 'restore': {
        var ids = p.ids || (p.id ? [p.id] : []);
        var n = 0;
        ids.forEach(function (id) { if (ownedFind_(db, id, currentUser.id)) n += restore_(db, id, currentUser.id); });
        saveMeta_(db);
        return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dipulihkan' };
      }
      case 'purge': {
        var ids = p.ids || (p.id ? [p.id] : []);
        var n = 0;
        ids.forEach(function (id) { if (ownedFind_(db, id, currentUser.id)) n += purge_(db, id, currentUser.id); });
        saveMeta_(db);
        return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dihapus permanen' };
      }
      case 'emptyTrash': {
        var dead = db.entries.filter(function (e) { return e.owner === currentUser.id && e.deleted; }).map(function (e) { return e.id; });
        var n = 0;
        dead.forEach(function (id) { n += purge_(db, id, currentUser.id); });
        saveMeta_(db);
        return { ok: true, data: n };
      }
      case 'rename': {
        var e = ownedFind_(db, p.id, currentUser.id);
        if (!e || e.deleted) return { ok: false, error: 'tidak ditemukan' };
        var oldName = e.name;
        e.name = uniqueName_(db, e.parentId, sanitizeName_(p.name || e.name)); touch_(e); saveMeta_(db);
        driveRenameEntry_(e, oldName);
        return { ok: true, data: e };
      }
      case 'move': {
        var ids = p.ids || (p.id ? [p.id] : []);
        var pid = p.parentId || 'root';
        if (pid !== 'root' && (!ownedFind_(db, pid, currentUser.id) || ownedFind_(db, pid, currentUser.id).type !== 'folder'))
          return { ok: false, error: 'parentId tidak valid' };
        var n = 0;
        for (var i = 0; i < ids.length; i++) {
          var e = ownedFind_(db, ids[i], currentUser.id);
          if (!e || e.deleted || ids[i] === pid) continue;
          e.parentId = pid; e.name = uniqueName_(db, pid, e.name); touch_(e); n++;
        }
        saveMeta_(db);
        return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dipindah' };
      }
      case 'favorite': {
        var e = ownedFind_(db, p.id, currentUser.id);
        if (!e || e.deleted) return { ok: false, error: 'tidak ditemukan' };
        e.favorite = p.on !== false; touch_(e); saveMeta_(db);
        return { ok: true, data: e };
      }
      case 'download': {
        var e = find_(db, p.id);
        if (!e || !canRead_(e, currentUser) || e.deleted || e.type !== 'file') return apiError_('File tidak ditemukan', 'FILE_NOT_FOUND');
        var downloaded = driveDownloadData_(e);
        e.driveFileId = downloaded.file.getId();
        e.previewUrl = drivePreviewUrl_(downloaded.file.getId());
        saveMeta_(db);
        return { ok: true, data: { entry: enrichMetadata_(e), dataUrl: downloaded.dataUrl } };
      }
      /* ---------- #30 SHARING: Private | Shared | Public Link (paritas mock) ----------
         least privilege: mode wajib eksplisit, tidak ada aksi yang otomatis
         me-public-kan file. Public = token acak + Drive ANYONE_WITH_LINK VIEWER. */
      case 'share': {
        var e = ownedFind_(db, p.id, currentUser.id);
        if (!e || e.deleted) return { ok: false, error: 'tidak ditemukan' };
        var mode = p.mode;
        if (!SHARE_MODES[mode]) return { ok: false, error: 'mode harus private|shared|public' };
        e.share = { mode: mode, withUsers: [], updatedAt: new Date().toISOString() };
        if (mode === 'shared') {
          var emails = String(p.emails || '').split(',').map(function (s) { return s.trim().toLowerCase(); })
            .filter(function (s) { return s && s.indexOf('@') > 0; });
          if (!emails.length) return { ok: false, error: 'minimal satu email untuk mode shared' };
          var authUsers = authLoadJson_(AUTH_USERS_KEY, []);
          emails.forEach(function (em) {
            for (var ui = 0; ui < authUsers.length; ui++) {
              if (authUsers[ui].email === em && authUsers[ui].active !== false) {
                e.share.withUsers.push({ userId: authUsers[ui].id, email: em, role: 'viewer' });
                break;
              }
            }
          });
          if (e.share.withUsers.length !== emails.length) return apiError_('Satu atau lebih user tidak ditemukan', 'USER_NOT_FOUND');
        }
        if (mode === 'public') {
          e.share.publicToken = Utilities.getUuid().replace(/-/g, ''); // regenerate tiap di-public-kan
        } else {
          delete e.share.publicToken; // keluar dari public -> token mati
        }
        touch_(e); saveMeta_(db);
        // sinkronkan izin Drive bila blob-nya ada (best-effort, metadata tetap sumber kebenaran)
        var df = driveFile_(e);
        if (df) {
          try {
            applyDrivePermissions_(df, e.share);
          } catch (errShare) { /* file folder/tanpa izin: abaikan */ }
        }
        return { ok: true, data: { entry: e, share: e.share } };
      }
      case 'shareInfo': {
        var e = ownedFind_(db, p.id, currentUser.id);
        if (!e) return { ok: false, error: 'tidak ditemukan' };
        return { ok: true, data: { share: e.share || { mode: 'private' } } };
      }
      case 'sharedList': {
        var sharedEntries = db.entries.filter(function (entry) {
          return !entry.deleted && entry.owner !== currentUser.id && canRead_(entry, currentUser);
        }).map(function (entry) {
          var safe = enrichMetadata_(entry);
          safe._readOnly = true;
          return safe;
        });
        return apiSuccess_(sharedEntries, 'File yang dibagikan');
      }
      case 'publicGet': {
        // akses publik anonim: HANYA via token link, tanpa listing
        var link = String(p.link || '');
        if (!link) return { ok: false, error: 'link wajib' };
        var e = null;
        for (var pi = 0; pi < db.entries.length; pi++) {
          var x = db.entries[pi];
          if (x.share && x.share.mode === 'public' && x.share.publicToken === link && !x.deleted) { e = x; break; }
        }
        if (!e) return { ok: false, error: 'link tidak valid atau sudah dicabut' };
        var out = { name: e.name, type: e.type, size: e.size, mime: e.mime, modified: e.modified };
        if (e.type === 'file') {
          var pf = driveFile_(e);
          if (!pf) return { ok: false, error: 'blob tidak ditemukan di Drive' };
          out.dataUrl = 'data:' + (e.mime || 'application/octet-stream') + ';base64,' +
            Utilities.base64Encode(pf.getBlob().getBytes());
        }
        return { ok: true, data: out };
      }
      default:
        return { ok: false, error: 'action tidak dikenal: ' + action };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { writeLock.releaseLock(); } catch (_) {}
  }
  }
}

function markDeleted_(db, id, ownerId) {
  var e = find_(db, id);
  if (!e || e.owner !== ownerId || e.deleted) return 0;
  e.deleted = true; e.deletedAt = new Date().toISOString(); touch_(e);
  var n = 1;
  for (var i = 0; i < db.entries.length; i++) {
    if (db.entries[i].parentId === id) n += markDeleted_(db, db.entries[i].id, ownerId);
  }
  return n;
}

function restore_(db, id, ownerId) {
  var e = find_(db, id);
  if (!e || e.owner !== ownerId || !e.deleted) return 0;
  e.deleted = false; delete e.deletedAt; touch_(e);
  var n = 1;
  for (var i = 0; i < db.entries.length; i++) {
    if (db.entries[i].parentId === id) n += restore_(db, db.entries[i].id, ownerId);
  }
  return n;
}

function purge_(db, id, ownerId) {
  var e = find_(db, id);
  if (!e || e.owner !== ownerId) return 0;
  var n = 0;
  for (var i = 0; i < db.entries.length; i++) {
    if (db.entries[i].parentId === id) n += purge_(db, db.entries[i].id, ownerId);
  }
  var idx = db.entries.indexOf(e);
  if (idx >= 0) { db.entries.splice(idx, 1); n++; }
  try {
    driveTrashEntry_(e);
  } catch (err) { /* blob mungkin sudah tidak ada */ }
  return n;
}
