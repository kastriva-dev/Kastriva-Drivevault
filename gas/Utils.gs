/** Utility murni backend GFileManager. */
function sanitizeName_(raw) {
  var name = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '.')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .replace(/^\s+|\s+$/g, '');
  if (name.length > 200) name = name.slice(0, 200);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = '_' + name;
  return name || 'tanpa-nama';
}

function hexDigest_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function enrichMetadata_(entry) {
  var dot = String(entry.name || '').lastIndexOf('.');
  var output = {};
  Object.keys(entry).forEach(function (key) { output[key] = entry[key]; });
  output.fileId = entry.id;
  output.path = entry.path || '';
  output.extension = entry.type === 'file' && dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '';
  output.modifiedTime = entry.modified;
  output.createdTime = entry.created || entry.modified;
  output.hash = entry.hash || '';
  output.syncStatus = entry.syncStatus || 'Synced';
  return output;
}

function touch_(entry) {
  entry.version = (entry.version || 1) + 1;
  entry.modified = new Date().toISOString();
}
