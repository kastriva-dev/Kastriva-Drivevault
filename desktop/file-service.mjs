import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const META_DIR = '.gfilemanager';
const META_FILE = 'metadata.json';
const TRASH_DIR = 'trash';
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeName(raw) {
  let value = String(raw ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '.')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 200);
  if (RESERVED_WIN.test(value)) value = '_' + value;
  return value || 'tanpa-nama';
}

function mimeFor(name) {
  const ext = path.extname(name).toLowerCase();
  return ({
    '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html',
    '.css': 'text/css', '.js': 'text/javascript', '.pdf': 'application/pdf', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  })[ext] || 'application/octet-stream';
}

async function hashFile(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

export async function createFileService(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const metaDir = path.join(root, META_DIR);
  const trashRoot = path.join(metaDir, TRASH_DIR);
  const metaPath = path.join(metaDir, META_FILE);
  await fs.mkdir(trashRoot, { recursive: true });

  let db = { entries: [] };
  try { db = JSON.parse(await fs.readFile(metaPath, 'utf8')); } catch {}
  if (!Array.isArray(db.entries)) db.entries = [];

  const save = () => fs.writeFile(metaPath, JSON.stringify(db, null, 2));
  const find = (id) => db.entries.find((entry) => entry.id === id);
  const id = () => 'local-' + crypto.randomUUID();

  async function resolveUserPath(userPath = '.') {
    const candidate = path.resolve(root, String(userPath));
    if (!inside(root, candidate)) throw new Error('Path di luar Workspace Root ditolak');
    return candidate;
  }

  function relativeOf(entry) {
    if (!entry) return '';
    const names = [entry.name];
    let parentId = entry.parentId;
    const seen = new Set([entry.id]);
    while (parentId && parentId !== 'root') {
      if (seen.has(parentId)) throw new Error('Metadata folder membentuk siklus');
      seen.add(parentId);
      const parent = find(parentId);
      if (!parent) throw new Error('Parent metadata tidak ditemukan');
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return path.join(...names);
  }

  async function diskPath(entry) {
    return resolveUserPath(relativeOf(entry));
  }

  async function uniqueName(parentId, requested, ignoreId) {
    const clean = sanitizeName(requested);
    const dot = clean.lastIndexOf('.');
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let candidate = clean;
    let n = 1;
    while (db.entries.some((entry) => !entry.deleted && entry.id !== ignoreId && entry.parentId === parentId && entry.name.toLowerCase() === candidate.toLowerCase())) {
      candidate = `${base} (${n++})${ext}`;
    }
    return candidate;
  }

  function validateParent(parentId) {
    if (parentId === 'root') return;
    const parent = find(parentId);
    if (!parent || parent.deleted || parent.type !== 'folder') throw new Error('Folder tujuan tidak ditemukan');
  }

  async function scan() {
    const knownByPath = new Map(db.entries.filter((entry) => !entry.deleted).map((entry) => [relativeOf(entry).toLowerCase(), entry]));
    async function walk(dir, parentId) {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (dir === root && dirent.name === META_DIR) continue;
        const absolute = path.join(dir, dirent.name);
        const relative = path.relative(root, absolute);
        let entry = knownByPath.get(relative.toLowerCase());
        const stat = await fs.stat(absolute);
        if (!entry) {
          entry = {
            id: id(), name: dirent.name, type: dirent.isDirectory() ? 'folder' : 'file', parentId,
            size: dirent.isDirectory() ? 0 : stat.size, mime: dirent.isDirectory() ? '' : mimeFor(dirent.name),
            deleted: false, favorite: false, version: 1, created: stat.birthtime.toISOString(), modified: stat.mtime.toISOString(),
            hash: dirent.isDirectory() ? '' : await hashFile(absolute), syncStatus: 'Pending',
          };
          db.entries.push(entry);
        } else {
          entry.parentId = parentId;
          entry.size = dirent.isDirectory() ? 0 : stat.size;
          entry.modified = stat.mtime.toISOString();
          if (!dirent.isDirectory() && !entry.hash) entry.hash = await hashFile(absolute);
        }
        if (dirent.isDirectory()) await walk(absolute, entry.id);
      }
    }
    await walk(root, 'root');
    await save();
  }

  await scan();

  async function createFolder(parentId = 'root', name = 'Folder Baru') {
    validateParent(parentId);
    const entry = {
      id: id(), name: await uniqueName(parentId, name), type: 'folder', parentId, size: 0, mime: '',
      deleted: false, favorite: false, version: 1, created: new Date().toISOString(), modified: new Date().toISOString(),
    };
    await fs.mkdir(await diskPath(entry));
    db.entries.push(entry);
    await save();
    return entry;
  }

  async function upload(parentId, name, mime, dataUrl, syncKey) {
    validateParent(parentId);
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
    if (!match) throw new Error('dataUrl tidak valid');
    const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
    const existing = syncKey ? db.entries.find((entry) => !entry.deleted && entry.syncKey === syncKey && entry.type === 'file') : null;
    if (existing) {
      await fs.writeFile(await diskPath(existing), buffer);
      existing.size = buffer.length;
      existing.hash = crypto.createHash('sha256').update(buffer).digest('hex');
      existing.syncStatus = 'Pending';
      existing.mime = mime || match[1] || existing.mime;
      existing.version += 1;
      existing.modified = new Date().toISOString();
      await save();
      return existing;
    }
    const finalName = await uniqueName(parentId, name);
    const now = new Date().toISOString();
    const entry = { id: id(), syncKey: syncKey || undefined, name: finalName, type: 'file', parentId, size: buffer.length, mime: mime || match[1] || mimeFor(finalName), hash: crypto.createHash('sha256').update(buffer).digest('hex'), syncStatus: 'Pending', deleted: false, favorite: false, version: 1, created: now, modified: now };
    await fs.writeFile(await diskPath(entry), buffer, { flag: 'wx' });
    db.entries.push(entry);
    await save();
    return entry;
  }

  async function rename(entryId, name) {
    const entry = find(entryId);
    if (!entry || entry.deleted) throw new Error('ID tidak valid atau tidak ditemukan');
    const oldPath = await diskPath(entry);
    entry.name = await uniqueName(entry.parentId, name, entry.id);
    await fs.rename(oldPath, await diskPath(entry));
    entry.version += 1;
    entry.modified = new Date().toISOString();
    await save();
    return entry;
  }

  function isDescendant(folderId, possibleChildId) {
    let current = possibleChildId;
    while (current && current !== 'root') {
      if (current === folderId) return true;
      current = find(current)?.parentId;
    }
    return false;
  }

  async function move(ids, parentId = 'root') {
    validateParent(parentId);
    let count = 0;
    for (const entryId of ids) {
      const entry = find(entryId);
      if (!entry || entry.deleted) continue;
      if (entry.type === 'folder' && isDescendant(entry.id, parentId)) throw new Error('folder tujuan berada di dalam sumber');
      const oldPath = await diskPath(entry);
      entry.name = await uniqueName(parentId, entry.name, entry.id);
      entry.parentId = parentId;
      await fs.rename(oldPath, await diskPath(entry));
      entry.version += 1;
      entry.modified = new Date().toISOString();
      count += 1;
    }
    await save();
    return count;
  }

  async function copy(ids, parentId = 'root') {
    validateParent(parentId);
    const created = [];
    async function copyOne(source, targetParentId) {
      const name = await uniqueName(targetParentId, source.name);
      const now = new Date().toISOString();
      const clone = { ...source, id: id(), name, parentId: targetParentId, deleted: false, favorite: false, version: 1, created: now, modified: now };
      await fs.cp(await diskPath(source), await diskPath(clone), { recursive: true, errorOnExist: true });
      db.entries.push(clone);
      created.push(clone);
      if (source.type === 'folder') {
        const children = db.entries.filter((entry) => !entry.deleted && entry.parentId === source.id && entry.id !== clone.id);
        for (const child of children) await copyOne(child, clone.id);
      }
    }
    for (const entryId of ids) {
      const source = find(entryId);
      if (source && !source.deleted) await copyOne(source, parentId);
    }
    await save();
    return created.filter((entry) => ids.some((sourceId) => find(sourceId)?.name === entry.name || entry.parentId === parentId));
  }

  async function remove(ids) {
    let count = 0;
    for (const entryId of ids) {
      const entry = find(entryId);
      if (!entry || entry.deleted) continue;
      const source = await diskPath(entry);
      await fs.rename(source, path.join(trashRoot, entry.id));
      const mark = (targetId) => {
        const target = find(targetId);
        if (!target || target.deleted) return;
        target.deleted = true;
        target.deletedAt = new Date().toISOString();
        count += 1;
        db.entries.filter((child) => child.parentId === targetId).forEach((child) => mark(child.id));
      };
      mark(entry.id);
    }
    await save();
    return count;
  }

  async function restore(ids) {
    let count = 0;
    for (const entryId of ids) {
      const entry = find(entryId);
      if (!entry || !entry.deleted) continue;
      if (entry.parentId !== 'root' && find(entry.parentId)?.deleted) entry.parentId = 'root';
      entry.name = await uniqueName(entry.parentId, entry.name, entry.id);
      await fs.rename(path.join(trashRoot, entry.id), await diskPath(entry));
      const unmark = (targetId) => {
        const target = find(targetId);
        if (!target?.deleted) return;
        target.deleted = false;
        delete target.deletedAt;
        count += 1;
        db.entries.filter((child) => child.parentId === targetId).forEach((child) => unmark(child.id));
      };
      unmark(entry.id);
    }
    await save();
    return count;
  }

  async function purge(ids) {
    const doomed = new Set();
    const collect = (entryId) => {
      if (doomed.has(entryId)) return;
      doomed.add(entryId);
      db.entries.filter((entry) => entry.parentId === entryId).forEach((entry) => collect(entry.id));
    };
    ids.forEach(collect);
    for (const entryId of ids) await fs.rm(path.join(trashRoot, entryId), { recursive: true, force: true });
    db.entries = db.entries.filter((entry) => !doomed.has(entry.id));
    await save();
    return doomed.size;
  }

  async function download(entryId) {
    const entry = find(entryId);
    if (!entry || entry.deleted || entry.type !== 'file') throw new Error('File tidak ditemukan');
    const data = await fs.readFile(await diskPath(entry));
    return { entry, dataUrl: `data:${entry.mime || mimeFor(entry.name)};base64,${data.toString('base64')}` };
  }

  async function openPath(entryId) {
    const entry = find(entryId);
    if (!entry || entry.deleted) throw new Error('File tidak ditemukan');
    return diskPath(entry);
  }

  async function markOpened(entryId) {
    const entry = find(entryId);
    if (!entry || entry.deleted || entry.type !== 'file') throw new Error('File tidak ditemukan');
    entry.lastOpened = new Date().toISOString();
    await save();
    return withMetadata(entry);
  }

  async function storageInfo() {
    const stats = await fs.statfs(root);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return { used: Math.max(0, total - free), free, limit: total, source: 'filesystem' };
  }

  async function search(query) {
    const needle = String(query || '').toLowerCase();
    return db.entries.filter((entry) => !entry.deleted && entry.name.toLowerCase().includes(needle));
  }

  function withMetadata(entry) {
    const relative = relativeOf(entry);
    return {
      ...structuredClone(entry), fileId: entry.id, path: relative ? path.dirname(relative) : '',
      extension: entry.type === 'file' ? path.extname(entry.name).slice(1).toLowerCase() : '',
      modifiedTime: entry.modified, createdTime: entry.created || entry.modified,
      hash: entry.hash || '', syncStatus: entry.syncStatus || 'Synced',
    };
  }

  return {
    root, resolveUserPath, list: async () => db.entries.map(withMetadata), search: async (query) => (await search(query)).map(withMetadata), createFolder, upload,
    rename, move, copy, remove, restore, purge, download, openPath, markOpened, storageInfo,
    favorite: async (entryId, on) => { const entry = find(entryId); if (!entry || entry.deleted) throw new Error('ID tidak valid'); entry.favorite = on !== false; await save(); return entry; },
    emptyTrash: async () => purge(db.entries.filter((entry) => entry.deleted && (!entry.parentId || !find(entry.parentId)?.deleted)).map((entry) => entry.id)),
  };
}

export function defaultWorkspaceRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace');
}
