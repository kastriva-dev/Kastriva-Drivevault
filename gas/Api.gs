/**
 * HTTP API entrypoint GFileManager.
 * Parsing request dan serialisasi response dipisahkan dari domain service.
 */
function parseApiRequest_(e) {
  var payload = {};
  if (e && e.postData && e.postData.contents) {
    try { payload = JSON.parse(e.postData.contents); }
    catch (jsonError) { payload = e.parameter || {}; }
  } else if (e && e.parameter) {
    payload = e.parameter;
  }
  return payload || {};
}

function respond_(output) {
  var normalized = output || apiError_('Respons backend tidak tersedia', 'EMPTY_RESPONSE');
  if (typeof normalized.success !== 'boolean') normalized.success = normalized.ok !== false;
  if (typeof normalized.ok !== 'boolean') normalized.ok = normalized.success !== false;
  if (!normalized.message) normalized.message = normalized.ok ? 'Berhasil' : (normalized.error || 'Operasi gagal');
  if (!normalized.ok && !normalized.error) normalized.error = normalized.message;
  return ContentService.createTextOutput(JSON.stringify(normalized))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var payload = parseApiRequest_(e);
  return respond_(handle_(payload.action, payload));
}

function doPost(e) {
  var payload = parseApiRequest_(e);
  return respond_(handle_(payload.action, payload));
}
