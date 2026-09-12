import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createFileService } from './file-service.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let service;
let mainWindow;
let cloudUrl = '';
let cloudConfigPath = '';

function normalizeResult(data, message = 'Berhasil') {
  return { ok: true, success: true, message, data };
}
function normalizeError(error) {
  return { ok: false, success: false, message: error?.message || 'Operasi gagal', error: error?.message || 'Operasi gagal', errorCode: 'DESKTOP_OPERATION_FAILED' };
}

async function dispatch(action, payload = {}) {
  try {
    const allowed = new Set(['list', 'createFolder', 'upload', 'rename', 'move', 'copy', 'delete', 'restore', 'purge', 'emptyTrash', 'favorite', 'download', 'openExternal', 'markOpened', 'search', 'quota', 'me']);
    if (!allowed.has(action)) throw new Error('Action desktop tidak diizinkan');
    let data;
    switch (action) {
      case 'list': data = await service.list(); break;
      case 'createFolder': data = await service.createFolder(payload.parentId, payload.name, payload.syncKey); break;
      case 'upload': data = await service.upload(payload.parentId, payload.name, payload.mime, payload.dataUrl, payload.syncKey); break;
      case 'rename': data = await service.rename(payload.id, payload.name); break;
      case 'move': data = await service.move(payload.ids || [payload.id], payload.parentId); break;
      case 'copy': data = await service.copy(payload.ids || [payload.id], payload.parentId); break;
      case 'delete': data = await service.remove(payload.ids || [payload.id]); break;
      case 'restore': data = await service.restore(payload.ids || [payload.id]); break;
      case 'purge': data = await service.purge(payload.ids || [payload.id]); break;
      case 'emptyTrash': data = await service.emptyTrash(); break;
      case 'favorite': data = await service.favorite(payload.id, payload.on); break;
      case 'download': data = await service.download(payload.id); break;
      case 'openExternal': {
        const target = await service.openPath(payload.id);
        const error = await shell.openPath(target);
        if (error) throw new Error(error);
        data = { opened: true };
        break;
      }
      case 'markOpened': data = await service.markOpened(payload.id); break;
      case 'search': data = await service.search(payload.query); break;
      case 'quota': data = await service.storageInfo(); break;
      case 'me': data = { user: { id: 'desktop-local', name: 'Pengguna Lokal', email: 'local@desktop' } }; break;
      default: throw new Error('Action desktop tidak dikenal: ' + action);
    }
    return normalizeResult(data);
  } catch (error) {
    return normalizeError(error);
  }
}

function validateCloudUrl(value) {
  const url = new URL(String(value || ''));
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('URL server harus HTTPS');
  return url.toString();
}

async function cloudDispatch(action, payload = {}) {
  try {
    if (!cloudUrl) throw new Error('Server Google Apps Script belum dikonfigurasi');
    const response = await fetch(cloudUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }), signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false || data?.success === false) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    return { ...data, ok: true, success: true };
  } catch (error) { return normalizeError(error); }
}

function registerIpc() {
  ipcMain.handle('gfm:call', (_event, action, payload) => dispatch(action, payload));
  ipcMain.handle('gfm:cloud-call', (_event, action, payload) => cloudDispatch(action, payload));
  ipcMain.handle('gfm:info', () => ({ desktop: true, workspaceRoot: service.root, cloudConfigured: !!cloudUrl, cloudUrl }));
  ipcMain.handle('gfm:set-cloud-url', async (_event, value) => {
    try {
      cloudUrl = value ? validateCloudUrl(value) : '';
      if (cloudConfigPath) await fs.writeFile(cloudConfigPath, JSON.stringify({ cloudUrl }, null, 2), 'utf8');
      return normalizeResult({ cloudUrl, cloudConfigured: !!cloudUrl }, 'Server cloud diperbarui');
    } catch (error) { return normalizeError(error); }
  });
  ipcMain.handle('gfm:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Pilih Workspace Root', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return normalizeResult(null, 'Pemilihan dibatalkan');
    service = await createFileService(result.filePaths[0]);
    return normalizeResult({ workspaceRoot: service.root }, 'Workspace Root diperbarui');
  });
  ipcMain.on('gfm:context-menu', (event, entry) => {
    const template = [
      { label: 'Buka', click: () => event.sender.send('gfm:context-action', 'open', entry?.id) },
      { label: 'Rename', click: () => event.sender.send('gfm:context-action', 'rename', entry?.id) },
      { label: 'Copy', click: () => event.sender.send('gfm:context-action', 'copy', entry?.id) },
      { label: 'Cut', click: () => event.sender.send('gfm:context-action', 'cut', entry?.id) },
      { type: 'separator' },
      { label: 'Hapus ke Trash', click: () => event.sender.send('gfm:context-action', 'delete', entry?.id) },
    ];
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(event.sender) });
  });
}

async function createWindow() {
  const savedRoot = app.commandLine.getSwitchValue('workspace-root');
  cloudConfigPath = path.join(app.getPath('userData'), 'cloud-config.json');
  let savedCloudUrl = '';
  try {
    const saved = JSON.parse(await fs.readFile(cloudConfigPath, 'utf8'));
    savedCloudUrl = saved.cloudUrl || '';
  } catch {}
  const requestedCloudUrl = app.commandLine.getSwitchValue('gas-url') || process.env.GFM_GAS_URL || savedCloudUrl;
  if (requestedCloudUrl) {
    cloudUrl = validateCloudUrl(requestedCloudUrl);
    try { await fs.mkdir(path.dirname(cloudConfigPath), { recursive: true }); await fs.writeFile(cloudConfigPath, JSON.stringify({ cloudUrl }, null, 2), 'utf8'); } catch {}
  }
  // Semua operasi dibatasi pada root ini. Lokasi lain hanya aktif setelah user
  // memilihnya secara eksplisit melalui dialog native "Pilih Workspace Root".
  // Nama folder lama dipertahankan agar pembaruan aplikasi tidak memutus data pengguna.
  const workspaceRoot = savedRoot || path.join(app.getPath('documents'), 'GFileManager');
  service = await createFileService(workspaceRoot);
  registerIpc();
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(APP_DIR, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self' data: blob:; connect-src 'self' https://script.google.com https://script.googleusercontent.com; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self' data: blob: https://drive.google.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"]
    } });
  });
  await mainWindow.loadFile(path.join(APP_DIR, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
