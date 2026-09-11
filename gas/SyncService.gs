/** Sinkronisasi metadata Local ↔ Cloud untuk backend GAS. */
function syncNormalizeEntry_(entry) {
  return enrichMetadata_(entry);
}

function syncMarkStatus_(entry, status) {
  entry.syncStatus = status;
  touch_(entry);
  return entry;
}

function syncConflictRecord_(localEntry, cloudEntry) {
  return {
    fileId: (localEntry || cloudEntry).id,
    name: (localEntry || cloudEntry).name,
    local: localEntry ? {
      modifiedTime: localEntry.modifiedTime || localEntry.modified,
      size: localEntry.size,
      hash: localEntry.hash || '',
      version: localEntry.version || 1
    } : null,
    cloud: cloudEntry ? {
      modifiedTime: cloudEntry.modifiedTime || cloudEntry.modified,
      size: cloudEntry.size,
      hash: cloudEntry.hash || '',
      version: cloudEntry.version || 1
    } : null,
    status: 'Conflict',
    createdAt: new Date().toISOString()
  };
}

function syncSameContent_(left, right) {
  if (!left || !right) return false;
  if (left.hash && right.hash) return left.hash === right.hash;
  return Number(left.size || 0) === Number(right.size || 0) &&
    String(left.modifiedTime || left.modified || '') === String(right.modifiedTime || right.modified || '');
}

function syncIsNewer_(left, right) {
  var leftTime = Date.parse(left.modifiedTime || left.modified || 0) || 0;
  var rightTime = Date.parse(right.modifiedTime || right.modified || 0) || 0;
  if (leftTime !== rightTime) return leftTime > rightTime;
  return Number(left.version || 0) > Number(right.version || 0);
}

function syncLocalCopyName_(name, timestamp) {
  var dot = String(name || '').lastIndexOf('.');
  var base = dot > 0 ? name.slice(0, dot) : name;
  var extension = dot > 0 ? name.slice(dot) : '';
  return base + ' (Local Copy' + (timestamp ? ' ' + timestamp : '') + ')' + extension;
}
