/** Google Drive adapter. Semua akses Drive harus melalui service ini. */
function driveRoot_() {
  var iterator = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return iterator.hasNext() ? iterator.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function driveChild_(parent, name) {
  var iterator = parent.getFoldersByName(name);
  return iterator.hasNext() ? iterator.next() : parent.createFolder(name);
}

function driveDirectoryForParent_(parentId) {
  var root = driveRoot_();
  return driveChild_(root, parentId === 'root' ? '_root' : parentId);
}

function driveFile_(entry) {
  if (entry.driveFileId) {
    try { return DriveApp.getFileById(entry.driveFileId); }
    catch (missingById) { /* fallback nama untuk migrasi metadata lama */ }
  }
  var directory = driveDirectoryForParent_(entry.parentId || 'root');
  var iterator = directory.getFilesByName(entry.name);
  return iterator.hasNext() ? iterator.next() : null;
}

function driveCreateOrReplaceFile_(entry, blob) {
  var file = driveFile_(entry);
  if (file) file.setBlob(blob);
  else file = driveDirectoryForParent_(entry.parentId || 'root').createFile(blob);
  return file;
}

function driveCreateFolderForEntry_(entry) {
  return driveChild_(driveRoot_(), entry.id);
}

function drivePreviewUrl_(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/preview';
}

function driveDownloadData_(entry) {
  var file = driveFile_(entry);
  if (!file) throw new Error('Blob tidak ditemukan di Drive');
  var blob = file.getBlob();
  return {
    file: file,
    blob: blob,
    dataUrl: 'data:' + (entry.mime || blob.getContentType() || 'application/octet-stream') + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}

function driveTrashEntry_(entry) {
  var file = driveFile_(entry);
  if (file) file.setTrashed(true);
}

function driveRenameEntry_(entry, oldName) {
  var file = driveFile_({ driveFileId: entry.driveFileId, parentId: entry.parentId, name: oldName });
  if (file) file.setName(entry.name);
}

function driveQuota_(fallbackUsed) {
  try {
    var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      var quota = JSON.parse(response.getContentText()).storageQuota || {};
      var used = Number(quota.usage || fallbackUsed || 0);
      var limit = Number(quota.limit || 0);
      return { used: used, free: limit ? Math.max(0, limit - used) : null, limit: limit, drive: true, source: 'Google Drive API' };
    }
  } catch (quotaError) { /* fallback aman di bawah */ }
  return { used: Number(fallbackUsed || 0), free: null, limit: 0, drive: false, source: 'metadata' };
}
