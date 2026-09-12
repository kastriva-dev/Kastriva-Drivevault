/* Mock backend GAS untuk Kastriva-DriveVault — meniru backend/Code.gs tapi disimpan di disk.
   - Static file server untuk PWA dev
   - POST/GET /api/gas  {action: list|upload|delete|createFolder|rename|move|favorite|download|_reset}
   Data: dev/.data/fs.json (entries) + dev/.data/files/<id> (blob biner) */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* GFM_DATA_DIR: isolasi data per-instance (test paralelspawn pakai dir temp sendiri)
   supaya tidak saling timpa dengan dev server / instance test lain. */
const DATA_DIR = process.env.GFM_DATA_DIR ? path.resolve(process.env.GFM_DATA_DIR) : path.join(ROOT, 'dev', '.data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'fs.json');
const PORT = process.env.PORT || 8177;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function ensureDirs() { fs.mkdirSync(FILES_DIR, { recursive: true }); }

/* ---------- AUTH: users, sessions, hash ---------- */
const DEMO_SALT = 'gfm-demo-salt-v1';
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}
function ensureUsers(db) {
  if (!db.users) {
    db.users = [{
      id: 'user-demo', email: 'uji@gfm.app', name: 'Penguji',
      salt: DEMO_SALT, passHash: hashPassword('password123', DEMO_SALT),
      created: new Date().toISOString(),
    }];
    db.sessions = {};
  }
  if (!db.sessions) db.sessions = {};
}
function publicUser(u) { return { id: u.id, email: u.email, name: u.name, created: u.created }; }
function authUser(db, p) {
  if (!p || !p.token) return null;
  const s = db.sessions[p.token];
  if (!s) return null;
  if (s.exp && Date.parse(s.exp) < Date.now()) { delete db.sessions[p.token]; saveDb(db); return null; }
  return db.users.find((u) => u.id === s.userId) || null;
}
const PUBLIC_ACTIONS = new Set(['register', 'login', '_reset', 'publicGet']);

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { return null; }
}
function saveDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

export function resetData(seed = true) {
  ensureDirs();
  for (const f of fs.readdirSync(FILES_DIR)) fs.rmSync(path.join(FILES_DIR, f), { force: true });
  const now = new Date().toISOString();
  const db = { entries: [], seq: 1 };
  ensureUsers(db);
  const demo = db.users[0];
  if (seed) {
    const mk = (e) => { const id = 'seed-' + (db.seq++); return { id, deleted: false, version: 1, favorite: false, size: 0, mime: '', parentId: 'root', owner: demo.id, created: now, modified: now, ...e }; };
    db.entries.push(mk({ name: 'Projects', type: 'folder' }));
    for (const [name, mime, text] of [
      ['laporan.pdf', 'application/pdf', '%PDF-1.4 laporan contoh'],
      ['data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX data contoh'],
      ['foto.jpg', 'image/jpeg', 'JPG foto contoh'],
    ]) {
      const e = mk({ name, type: 'file', mime, size: Buffer.byteLength(text) });
      fs.writeFileSync(path.join(FILES_DIR, e.id), Buffer.from(text));
      db.entries.push(e);
    }
  }
  saveDb(db);
  return db;
}

function find(db, id) { return db.entries.find(e => e.id === id); }

/* ---------- #31/#32 SECURITY: sanitasi nama file ----------
   Nama dari client TIDAK pernah dipercaya: strip separator path, karakter
   terlarang Windows, control char, titik di awal/akhir (traversal & DOS device),
   dan nama perangkat bawaan Windows. Blob disimpan di FILES_DIR dengan key id
   buatan server (crypto.randomUUID), jadi traversal via nama tidak bisa
   menyentuh filesystem di luar workspace ROOT — validasi ini lapisan kedua. */
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export function sanitizeName(raw) {
  let n = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f]/g, '')            // control chars
    .replace(/[\\/:*?"<>|]/g, '')               // pemisah path & karakter terlarang Windows
    .replace(/\.\./g, '.')                      // '..' kapan pun -> '.'
    .replace(/^\.+/, '')                        // dot di awal (hidden / '../' sisa)
    .replace(/[. ]+$/, '')                      // dot/spasi di akhir (Windows)
    .trim()
    .slice(0, 200);
  if (RESERVED_WIN.test(n)) n = '_' + n;
  if (!n) n = 'tanpa-nama';
  return n;
}
function uniqueName(db, parentId, name) {
  let n = name, i = 1;
  while (db.entries.some(e => !e.deleted && e.parentId === parentId && e.name.toLowerCase() === n.toLowerCase())) {
    const dot = name.lastIndexOf('.');
    n = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
    i++;
  }
  return n;
}
function touch(e) { e.version = (e.version || 1) + 1; e.modified = new Date().toISOString(); }

function enrichMetadata(e) {
  return {
    ...e, fileId: e.id, path: e.path || '',
    extension: e.type === 'file' ? path.extname(e.name).slice(1).toLowerCase() : '',
    modifiedTime: e.modified, createdTime: e.created || e.modified,
    hash: e.hash || '', syncStatus: e.syncStatus || 'Synced',
  };
}

function writeFileBlob(db, entry, buf) {
  fs.writeFileSync(path.join(FILES_DIR, entry.id), buf);
  entry.size = buf.length;
}

function handleApi(action, p = {}) {
  const db = loadDb() || resetData(true);
  ensureDirs();
  ensureUsers(db);
  // auth gate: semua action kecuali PUBLIC_ACTIONS wajib session token
  if (!PUBLIC_ACTIONS.has(action)) {
    const u = authUser(db, p);
    if (!u) return { ok: false, error: 'unauthorized', code: 'AUTH' };
    p._user = u;
  }
  switch (action) {
    case '_reset': {
      const keepUsers = db.users;
      const keepSessions = db.sessions; // reset data tidak meng-log-out sesi aktif
      const r = resetData(p.seed !== false);
      r.users = keepUsers; r.sessions = keepSessions; saveDb(r);
      return { ok: true, data: r.entries.length };
    }
    case 'register': {
      const email = String(p.email || '').trim().toLowerCase();
      const name = String(p.name || '').trim() || email.split('@')[0];
      if (!email || !email.includes('@')) return { ok: false, error: 'email tidak valid' };
      if (!p.password || String(p.password).length < 8) return { ok: false, error: 'password minimal 8 karakter' };
      if (db.users.some((u) => u.email === email)) return { ok: false, error: 'email sudah terdaftar' };
      const salt = crypto.randomBytes(16).toString('hex');
      const user = { id: 'user-' + crypto.randomUUID(), email, name, salt, passHash: hashPassword(p.password, salt), created: new Date().toISOString() };
      db.users.push(user);
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = { userId: user.id, exp: new Date(Date.now() + 7 * 864e5).toISOString() };
      saveDb(db);
      return { ok: true, data: { user: publicUser(user), token } };
    }
    case 'login': {
      const email = String(p.email || '').trim().toLowerCase();
      const u = db.users.find((x) => x.email === email);
      if (!u || hashPassword(p.password || '', u.salt) !== u.passHash) return { ok: false, error: 'email atau password salah' };
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = { userId: u.id, exp: new Date(Date.now() + 7 * 864e5).toISOString() };
      saveDb(db);
      return { ok: true, data: { user: publicUser(u), token } };
    }
    case 'logout': {
      if (p.token && db.sessions[p.token]) { delete db.sessions[p.token]; saveDb(db); }
      return { ok: true, data: 1 };
    }
    case 'me': {
      return { ok: true, data: { user: publicUser(p._user) } };
    }
      case 'quota': {
      const own = db.entries.filter((e) => e.owner === p._user.id && !e.deleted && e.type === 'file');
      const used = own.reduce((s, e) => s + (e.size || 0), 0);
      return { ok: true, data: { used, limit: 15 * 1024 * 1024 * 1024, drive: false } };
    }
    /* ---------- #30 SHARING: Private | Shared | Public Link ----------
       least privilege: tidak ada aksi yang otomatis me-public-kan file.
       share.public hanya di-set true oleh action 'share' dengan mode 'public' EKSPLISIT. */
    case 'share': {
      const e = find(db, p.id);
      if (!e || e.deleted || e.owner !== p._user.id) return { ok: false, error: 'tidak ditemukan' };
      const mode = p.mode; // 'private' | 'shared' | 'public' — wajib eksplisit
      if (!['private', 'shared', 'public'].includes(mode)) return { ok: false, error: 'mode harus private|shared|public' };
      e.share = { mode: mode, withUsers: [], updatedAt: new Date().toISOString() };
      // shared: hanya user email eksplisit yang terdaftar
      if (mode === 'shared') {
        const emails = String(p.emails || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        for (const em of emails) {
          const target = db.users.find((u) => u.email === em);
          if (!target) return { ok: false, error: 'user tidak ditemukan: ' + em };
          e.share.withUsers.push({ userId: target.id, email: target.email, role: 'viewer' }); // least privilege: default viewer
        }
        if (!e.share.withUsers.length) return { ok: false, error: 'minimal satu email untuk mode shared' };
      }
      // public: buat token link acak; TIDAK pernah otomatis
      if (mode === 'public') {
        e.share.publicToken = crypto.randomBytes(16).toString('hex'); // regenerate tiap kali di-public-kan
      } else {
        delete e.share.publicToken; // keluar dari mode public -> token dimatikan
      }
      touch(e); saveDb(db);
      return { ok: true, data: { entry: e, share: e.share } };
    }
    case 'shareInfo': {
      const e = find(db, p.id);
      if (!e || e.owner !== p._user.id) return { ok: false, error: 'tidak ditemukan' };
      return { ok: true, data: { share: e.share || { mode: 'private' } } };
    }
    case 'sharedList': {
      // file milik user lain yang di-share ke saya (mode shared) — read-only
      const mine = db.entries.filter((e) => e.share && e.share.mode === 'shared' &&
        e.share.withUsers.some((w) => w.userId === p._user.id) && !e.deleted);
      return { ok: true, data: mine.map((e) => ({ ...e, _readOnly: true })) };
    }
    case 'publicGet': {
      // akses publik terbatas: HANYA unduh metadata+isi via token; tanpa listing
      const e = db.entries.find((x) => x.share && x.share.mode === 'public' && x.share.publicToken === p.link && !x.deleted);
      if (!e) return { ok: false, error: 'link tidak valid atau sudah dicabut' };
      let buf = null;
      if (e.type === 'file') { try { buf = fs.readFileSync(path.join(FILES_DIR, e.id)); } catch {} }
      return {
        ok: true,
        data: {
          name: e.name, type: e.type, size: e.size, mime: e.mime, modified: e.modified,
          dataUrl: buf ? `data:${e.mime || 'application/octet-stream'};base64,${buf.toString('base64')}` : undefined,
        },
      };
    }
    case 'list': {
      return { ok: true, data: db.entries.filter((e) => e.owner === p._user.id).map(enrichMetadata) };
    }
    case 'createFolder': {
      const parentId = p.parentId || 'root';
      if (parentId !== 'root' && (!find(db, parentId) || find(db, parentId).type !== 'folder')) return { ok: false, error: 'parentId tidak valid' };
      const e = { id: 'id-' + crypto.randomUUID(), name: uniqueName(db, parentId, sanitizeName(p.name || 'Folder Baru')), type: 'folder', parentId, size: 0, mime: '', deleted: false, version: 1, favorite: false, owner: p._user.id, created: new Date().toISOString(), modified: new Date().toISOString() };
      db.entries.push(e); saveDb(db);
      return { ok: true, data: e };
    }
    case 'upload': {
      const parentId = p.parentId || 'root';
      if (parentId !== 'root' && (!find(db, parentId) || find(db, parentId).type !== 'folder')) return { ok: false, error: 'parentId tidak valid' };
      if (!p.name || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:')) return { ok: false, error: 'name/dataUrl wajib' };
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(p.dataUrl);
      if (!m) return { ok: false, error: 'dataUrl tidak valid' };
      const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      const safeName = sanitizeName(p.name); // #32: nama dari client tidak pernah dipercaya
      let e = db.entries.find(x => !x.deleted && x.parentId === parentId && x.name.toLowerCase() === safeName.toLowerCase());
      if (e) { /* replace content = version bump, bukan duplikat */ }
      else {
        e = { id: 'id-' + crypto.randomUUID(), name: safeName, type: 'file', parentId, deleted: false, version: 1, favorite: false, owner: p._user.id, created: new Date().toISOString(), mime: p.mime || m[1] || 'application/octet-stream', size: 0, modified: new Date().toISOString() };
        db.entries.push(e);
      }
      e.mime = p.mime || m[1] || e.mime || 'application/octet-stream';
      e.hash = crypto.createHash('sha256').update(buf).digest('hex');
      e.syncStatus = 'Synced';
      writeFileBlob(db, e, buf); touch(e); saveDb(db);
      return { ok: true, data: enrichMetadata(e) };
    }
    case 'delete': {
      const ids = Array.isArray(p.ids) ? p.ids : (p.id ? [p.id] : []);
      let n = 0;
      const mark = (id) => { const e = find(db, id); if (e && !e.deleted) { e.deleted = true; e.deletedAt = new Date().toISOString(); touch(e); n++; db.entries.filter(x => x.parentId === id).forEach(x => mark(x.id)); } };
      ids.forEach(mark);
      saveDb(db);
      return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dihapus' };
    }
    case 'restore': {
      const ids = Array.isArray(p.ids) ? p.ids : (p.id ? [p.id] : []);
      let n = 0;
      const unmark = (id) => { const e = find(db, id); if (e && e.deleted && e.owner === p._user.id) { e.deleted = false; delete e.deletedAt; touch(e); n++; db.entries.filter(x => x.parentId === id && x.owner === p._user.id).forEach(x => unmark(x.id)); } };
      ids.forEach(unmark);
      saveDb(db);
      return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dipulihkan' };
    }
    case 'purge': {
      const ids = Array.isArray(p.ids) ? p.ids : (p.id ? [p.id] : []);
      const kill = (id) => {
        db.entries.filter(x => x.parentId === id).forEach(x => kill(x.id));
        const i = db.entries.findIndex(x => x.id === id);
        if (i >= 0) { if (db.entries[i].owner !== p._user.id) return; try { fs.rmSync(path.join(FILES_DIR, id), { force: true }); } catch {} db.entries.splice(i, 1); return 1; }
        return 0;
      };
      let n = 0; ids.forEach((id) => { n += kill(id); });
      saveDb(db);
      return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dihapus permanen' };
    }
    case 'emptyTrash': {
      const dead = db.entries.filter(e => e.deleted && e.owner === p._user.id).map(e => e.id);
      const kill = (id) => {
        db.entries.filter(x => x.parentId === id).forEach(x => kill(x.id));
        const i = db.entries.findIndex(x => x.id === id);
        if (i >= 0) { try { fs.rmSync(path.join(FILES_DIR, id), { force: true }); } catch {} db.entries.splice(i, 1); }
      };
      dead.forEach(kill);
      saveDb(db);
      return { ok: true, data: dead.length };
    }
    case 'rename': {
      const e = find(db, p.id); if (!e || e.deleted || e.owner !== p._user.id) return { ok: false, error: 'tidak ditemukan' };
      e.name = uniqueName(db, e.parentId, sanitizeName(p.name || e.name)); touch(e); saveDb(db);
      return { ok: true, data: e };
    }
    case 'move': {
      const ids = Array.isArray(p.ids) ? p.ids : (p.id ? [p.id] : []);
      const parentId = p.parentId || 'root';
      if (parentId !== 'root' && (!find(db, parentId) || find(db, parentId).type !== 'folder' || find(db, parentId).owner !== p._user.id)) return { ok: false, error: 'parentId tidak valid' };
      let n = 0;
      for (const id of ids) {
        const e = find(db, id);
        if (!e || e.deleted || e.owner !== p._user.id || id === parentId) continue;
        // cegah folder masuk ke dalam dirinya sendiri
        let anc = parentId, cyc = false;
        while (anc !== 'root') { if (anc === id) { cyc = true; break; } const a = find(db, anc); anc = a ? a.parentId : 'root'; }
        if (cyc) continue;
        e.parentId = parentId; e.name = uniqueName(db, parentId, e.name); touch(e); n++;
      }
      saveDb(db);
      return n ? { ok: true, data: n } : { ok: false, error: 'tidak ada yang dipindah' };
    }
    case 'favorite': {
      const e = find(db, p.id); if (!e || e.deleted || e.owner !== p._user.id) return { ok: false, error: 'tidak ditemukan' };
      e.favorite = p.on !== false; touch(e); saveDb(db);
      return { ok: true, data: e };
    }
    case 'download': {
      const e = find(db, p.id); if (!e || e.deleted || e.type !== 'file' || e.owner !== p._user.id) return { ok: false, error: 'tidak ditemukan' };
      let buf; try { buf = fs.readFileSync(path.join(FILES_DIR, e.id)); } catch { return { ok: false, error: 'blob hilang' }; }
      return { ok: true, data: { entry: e, dataUrl: `data:${e.mime || 'application/octet-stream'};base64,${buf.toString('base64')}` } };
    }
    default: return { ok: false, error: `action tidak dikenal: ${action}` };
  }
}

/* parser multipart/form-data sederhana (untuk XHR upload dengan progress) */
function readMultipart(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const out = {};
      const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(req.headers['content-type'] || ''));
      if (!m) return resolve(out);
      const boundary = Buffer.from('--' + (m[1] || m[2]));
      let start = buf.indexOf(boundary);
      while (start !== -1) {
        const next = buf.indexOf(boundary, start + boundary.length);
        if (next === -1) break;
        const part = buf.slice(start + boundary.length + 2, next - 2); // lewati \r\n
        const headEnd = part.indexOf('\r\n\r\n');
        if (headEnd !== -1) {
          const head = part.slice(0, headEnd).toString('utf8');
          const body = part.slice(headEnd + 4);
          const nm = /name="([^"]*)"/.exec(head);
          if (nm) out[nm[1]] = body.toString('latin1'); // binary-safe: dataUrl base64 murni ASCII
        }
        start = next;
      }
      resolve(out);
    });
    req.on('error', () => resolve({}));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 25 * 1024 * 1024) { req.destroy(); resolve({}); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch {
        // fallback: form-encoded (action=upload&...)
        const q = new URLSearchParams(raw); resolve(Object.fromEntries(q));
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/gas' || u.pathname === '/api/gas/') {
    let payload = {};
    if (req.method === 'POST') {
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('multipart/form-data')) payload = await readMultipart(req);
      else payload = await readBody(req);
    }
    if (req.method === 'GET' && !payload.action && u.searchParams.get('link')) {
      payload = { link: u.searchParams.get('link') }; // public link: /api/gas?action=publicGet&link=...
    }
    const action = payload.action || u.searchParams.get('action');
    const out = action ? handleApi(action, payload) : { ok: false, error: 'action kosong' };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out));
    return;
  }
  // static — #32: path traversal guard (harus tetap di dalam ROOT, termasuk boundary separator)
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { res.writeHead(400); res.end('bad path'); return; }
  if (p === '/') p = '/index.html';
  // /p/<token> -> halaman link publik (SPA-style fallback; token dibaca client dari pathname)
  if (p === '/p' || p.startsWith('/p/')) p = '/p/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 ' + p); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

export function start(port = PORT) {
  ensureDirs();
  if (!loadDb()) resetData(true);
  return new Promise(r => { const s = server.listen(port, () => r(s)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureDirs();
  if (!loadDb()) { resetData(true); console.log('[mock] data seed dibuat di', DATA_DIR); }
  server.listen(PORT, () => console.log(`[mock] Kastriva-DriveVault mock backend: http://localhost:${PORT} (API: /api/gas)`));
}
