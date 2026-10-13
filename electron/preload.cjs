const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const listener = (_event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('electronAPI', {
  loginWithGoogle: () => ipcRenderer.invoke('auth:google'),
  cancelGoogleLogin: () => ipcRenderer.send('auth:cancel'),
  openTimerPopup: (data) => ipcRenderer.send('timer:open', data),
  closeTimerPopup: () => ipcRenderer.send('timer:close'),
  stopTimerFromPopup: () => ipcRenderer.send('timer:stop-from-popup'),
  onTimerStopped: (cb) => listen('timer:stopped', cb),
  onTimerData: (cb) => listen('timer:data', cb),
  minimizeMain: () => ipcRenderer.send('window:minimize-main'),
});
