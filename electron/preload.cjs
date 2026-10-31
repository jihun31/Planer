const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const listener = (_event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('electronAPI', {
  loginWithGoogle: () => ipcRenderer.invoke('auth:google'),
  cancelGoogleLogin: () => ipcRenderer.send('auth:cancel'),
  getYouTubeTitle: id => ipcRenderer.invoke('notes:youtube-title',id),
  getLinkPreview: url => ipcRenderer.invoke('notes:link-preview',url),
  readUiText: () => ipcRenderer.invoke('ui-text:read'),
  saveUiText: (section,items) => ipcRenderer.invoke('ui-text:save',section,items),
  showUiTextFile: () => ipcRenderer.invoke('ui-text:show-file'),
  openTimerPopup: (data) => ipcRenderer.send('timer:open', data),
  startTimerPopup: (data) => ipcRenderer.invoke('timer:start', data),
  closeTimerPopup: () => ipcRenderer.send('timer:close'),
  stopTimerFromPopup: () => ipcRenderer.send('timer:stop-from-popup'),
  onTimerStopped: (cb) => listen('timer:stopped', cb),
  onTimerData: (cb) => listen('timer:data', cb),
  minimizeMain: () => ipcRenderer.send('window:minimize-main'),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  onUpdateStatus: (cb) => listen('update:status', cb),
  installUpdate: () => ipcRenderer.send('update:install'),
});
