const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gfmDesktop', Object.freeze({
  call: (action, payload) => ipcRenderer.invoke('gfm:call', action, payload || {}),
  cloudCall: (action, payload) => ipcRenderer.invoke('gfm:cloud-call', action, payload || {}),
  info: () => ipcRenderer.invoke('gfm:info'),
  setCloudUrl: (url) => ipcRenderer.invoke('gfm:set-cloud-url', url),
  chooseWorkspace: () => ipcRenderer.invoke('gfm:choose-workspace'),
  showContextMenu: (entry) => ipcRenderer.send('gfm:context-menu', entry || null),
  onContextAction: (callback) => {
    const listener = (_event, action, id) => callback(action, id);
    ipcRenderer.on('gfm:context-action', listener);
    return () => ipcRenderer.removeListener('gfm:context-action', listener);
  },
}));
