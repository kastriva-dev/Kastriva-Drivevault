/** Validasi keamanan terpusat sebelum operasi metadata/Google Drive. */
var ALLOWED_ACTIONS = {
  register: 1, login: 1, logout: 1, me: 1,
  list: 1, quota: 1, createFolder: 1, upload: 1, delete: 1,
  restore: 1, purge: 1, emptyTrash: 1, rename: 1, move: 1,
  favorite: 1, download: 1, share: 1, shareInfo: 1,
  sharedList: 1, publicGet: 1
};
var WRITE_ACTIONS = {
  createFolder: 1, upload: 1, delete: 1, restore: 1, purge: 1,
  emptyTrash: 1, rename: 1, move: 1, favorite: 1, share: 1
};

function validateAction_(action) {
  return typeof action === 'string' && !!ALLOWED_ACTIONS[action];
}
function validateEntityId_(value, allowRoot) {
  if (allowRoot && value === 'root') return true;
  return typeof value === 'string' && /^id-[0-9a-f-]{20,64}$/i.test(value);
}
function validateIds_(payload) {
  var ids = payload.ids || (payload.id ? [payload.id] : []);
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) return false;
  for (var i = 0; i < ids.length; i++) if (!validateEntityId_(ids[i], false)) return false;
  return true;
}
function validatePermissionPayload_(payload) {
  if (!SHARE_MODES[payload.mode]) return false;
  if (payload.mode !== 'shared') return true;
  var emails = String(payload.emails || '').split(',').map(function (email) {
    return email.trim().toLowerCase();
  }).filter(Boolean);
  if (!emails.length || emails.length > 100) return false;
  for (var i = 0; i < emails.length; i++) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emails[i])) return false;
  }
  return true;
}
function validateRequest_(action, payload, user) {
  payload = payload || {};
  if (!validateAction_(action)) return apiError_('Action tidak diizinkan', 'INVALID_ACTION');
  if (!PUBLIC_ACTIONS[action] && !user) return apiError_('Unauthorized', 'AUTH');

  if (['rename', 'favorite', 'download', 'share', 'shareInfo'].indexOf(action) >= 0 && !validateEntityId_(payload.id, false)) {
    return apiError_('fileId tidak valid', 'INVALID_FILE_ID');
  }
  if (['delete', 'restore', 'purge', 'move'].indexOf(action) >= 0 && !validateIds_(payload)) {
    return apiError_('fileId tidak valid', 'INVALID_FILE_ID');
  }
  if (['createFolder', 'upload', 'move'].indexOf(action) >= 0 && !validateEntityId_(payload.parentId || 'root', true)) {
    return apiError_('folderId tidak valid', 'INVALID_FOLDER_ID');
  }
  if (action === 'share' && !validatePermissionPayload_(payload)) {
    return apiError_('Permission sharing tidak valid', 'INVALID_PERMISSION');
  }
  if (action === 'publicGet' && !/^[0-9a-f]{32}$/i.test(String(payload.link || ''))) {
    return apiError_('Public link tidak valid', 'INVALID_PUBLIC_TOKEN');
  }
  if (action === 'upload' && (!payload.name || typeof payload.dataUrl !== 'string' || !/^data:[^,]*,/.test(payload.dataUrl))) {
    return apiError_('Payload upload tidak valid', 'INVALID_UPLOAD');
  }
  return null;
}

function requireOwnedEntry_(db, id, user, expectedType) {
  var entry = ownedFind_(db, id, user.id);
  if (!entry || entry.deleted || (expectedType && entry.type !== expectedType)) {
    throw new Error('Resource tidak ditemukan atau akses ditolak');
  }
  return entry;
}

/** Sinkronkan izin Drive secara eksplisit. Private adalah default. */
function applyDrivePermissions_(file, share) {
  share = share || { mode: 'private', withUsers: [] };
  try { file.setSharing(DriveApp.Access.RESTRICTED, DriveApp.Permission.NONE); } catch (ignored) {}
  try {
    file.getViewers().forEach(function (viewer) { file.removeViewer(viewer); });
    file.getEditors().forEach(function (editor) { file.removeEditor(editor); });
  } catch (ignoredMembers) {}
  if (share.mode === 'public') {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEWER);
  } else if (share.mode === 'shared') {
    (share.withUsers || []).forEach(function (permission) {
      if (permission.role === 'viewer') file.addViewer(permission.email);
    });
  }
}
