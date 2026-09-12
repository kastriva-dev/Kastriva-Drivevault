/** Konfigurasi dan response contract bersama backend GFileManager. */
var ROOT_FOLDER_NAME = 'GFileManager';
var META_KEY = 'GFM_ENTRIES_V3';
var META_CHUNK_SIZE = 7000; // di bawah batas aman nilai PropertiesService (~9 KB)
var AUTH_ACTIONS = { register: 1, login: 1, logout: 1, me: 1 };
var PUBLIC_ACTIONS = { register: 1, login: 1, publicGet: 1 };

function apiSuccess_(data, message) {
  return { ok: true, success: true, message: message || 'Berhasil', data: data == null ? null : data };
}
function apiError_(message, errorCode) {
  return { ok: false, success: false, message: message || 'Operasi gagal', error: message || 'Operasi gagal', errorCode: errorCode || 'OPERATION_FAILED' };
}
