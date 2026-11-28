const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const listener = (_event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  onTimerData: (cb) => listen('timer:data', cb),
  stopTimerFromPopup: () => ipcRenderer.send('timer:stop-from-popup'),
  sendRestPopupCommand: (command) => ipcRenderer.send('rest:popup-command', command),
});
