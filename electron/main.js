const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { readDesktopConfig, startGoogleLogin } = require('./google-auth.cjs');

const isDev = !app.isPackaged;
const mainUrl = isDev ? 'http://localhost:5173/' : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const timerUrl = pathToFileURL(path.join(__dirname, 'timer-popup.html')).href;
let mainWindow = null, timerWindow = null, loginSession = null;
let timerStopPending = false;

function fromWindow(event, win, expectedUrl) {
  let samePage = false;
  try {
    const actual = new URL(event.senderFrame.url);
    const expected = new URL(expectedUrl);
    samePage = actual.protocol === expected.protocol && actual.host === expected.host
      && actual.pathname === expected.pathname;
  } catch { /* Reject malformed sender URLs. */ }
  return !!win && !win.isDestroyed() && event.sender === win.webContents
    && event.senderFrame === win.webContents.mainFrame
    && samePage;
}
const fromMain = event => fromWindow(event, mainWindow, mainUrl);
const fromTimer = event => fromWindow(event, timerWindow, timerUrl);

let uiTextStore;
const uiTextPath = () => isDev ? path.join(__dirname,'../local-data/ui-text-edits.json')
  : path.join(app.getPath('userData'),'ui-text-edits.json');
function getUiTextStore() {
  return uiTextStore ||= require('./ui-text-store.cjs').createUiTextStore(uiTextPath());
}
ipcMain.handle('ui-text:read',async event => {
  if (!fromMain(event)) return {ok:false,code:'desktop/forbidden'};
  try {return {ok:true,data:await getUiTextStore().read(),path:uiTextPath()};}
  catch {return {ok:false,code:'text/read-failed'};}
});
ipcMain.handle('ui-text:save',async (event,section,items) => {
  if (!fromMain(event)) return {ok:false,code:'desktop/forbidden'};
  try {return {ok:true,data:await getUiTextStore().save(section,items),path:uiTextPath()};}
  catch {return {ok:false,code:'text/save-failed'};}
});
ipcMain.handle('ui-text:show-file',async event => {
  if (!fromMain(event)) return {ok:false,code:'desktop/forbidden'};
  try {await fs.promises.access(uiTextPath());shell.showItemInFolder(uiTextPath());return {ok:true};}
  catch {return {ok:false,code:'text/file-not-found'};}
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    title: 'Planer', autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.loadURL(mainUrl);
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainUrl) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        shell.openExternal(target.href).catch(() => {});
      }
    } catch { /* Ignore malformed external links. */ }
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    loginSession?.cancel();
    mainWindow = null;
    timerStopPending = false;
    if (timerWindow && !timerWindow.isDestroyed()) timerWindow.close();
  });
}

function createTimerWindow(data) {
  if (!data || typeof data.actName !== 'string' || data.actName.length > 500 ||
      !Number.isFinite(data.startTs) || typeof data.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(data.color)) return false;
  const safeData = {
    actName: data.actName, startTs: data.startTs, color: data.color,
    startLabel: typeof data.startLabel === 'string' ? data.startLabel.slice(0, 30) : '',
  };
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.focus();
    timerWindow.webContents.send('timer:data', safeData);
    return true;
  }
  const win = new BrowserWindow({
    width: 200, height: 128, resizable: false,
    alwaysOnTop: true, frame: false, backgroundColor: '#ffffff', skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  timerWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('timer:data', safeData);
  });
  win.loadURL(timerUrl);
  win.on('close', () => {
    if (timerStopPending && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('timer:stopped');
    }
    timerStopPending = false;
  });
  win.on('closed', () => { if (timerWindow === win) timerWindow = null; });
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  win.setPosition(data.position === 'left' ? x + 16 : x + width - 216, y + height - 144);
  return true;
}

ipcMain.handle('auth:google', async event => {
  if (!fromMain(event)) return { ok: false, code: 'desktop/forbidden' };
  if (loginSession) return { ok: false, code: 'desktop/busy' };
  let config;
  try {
    config = readDesktopConfig(JSON.parse(fs.readFileSync(path.join(__dirname, 'google-oauth.json'), 'utf8')));
  } catch { return { ok: false, code: 'desktop/config-missing' }; }
  const session = startGoogleLogin({ config, openExternal: url => shell.openExternal(url) });
  loginSession = session;
  try {
    const credential = await session.result;
    if (!fromMain(event)) return { ok: false, code: 'desktop/cancelled' };
    mainWindow.restore();
    mainWindow.focus();
    return { ok: true, ...credential };
  } catch (error) {
    return { ok: false, code: error.code || 'desktop/login-failed' };
  } finally { if (loginSession === session) loginSession = null; }
});
ipcMain.on('auth:cancel', event => { if (fromMain(event)) loginSession?.cancel(); });
ipcMain.handle('notes:link-preview',async (event,url) => {
  if (!fromMain(event)) return {ok:false,code:'desktop/forbidden'};
  if (typeof url !== 'string' || url.length > 4096) return {ok:false};
  try {
    const data = await require('./link-preview.cjs').loadLinkPreview(url);
    return fromMain(event) ? {ok:true,...data} : {ok:false};
  } catch {return {ok:false};}
});
ipcMain.handle('notes:youtube-title', async (event,id) => {
  if (!fromMain(event)) return {ok:false,code:'desktop/forbidden'};
  if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return {ok:false};
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
      {credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok || !fromMain(event)) return {ok:false};
    const {title,author_name:author} = await response.json();
    return typeof title === 'string' && title.trim() && title.length <= 500
      ? {ok:true,title:title.trim(),author:typeof author === 'string' ? author.slice(0,200) : ''} : {ok:false};
  } catch { return {ok:false}; }
});
ipcMain.on('window:minimize-main', event => { if (fromMain(event)) mainWindow.minimize(); });
ipcMain.on('timer:open', (event, data) => { if (fromMain(event)) createTimerWindow(data); });
ipcMain.handle('timer:start', (event, data) => {
  if (!fromMain(event)) return { ok: false, code: 'desktop/forbidden' };
  if (!createTimerWindow(data)) return { ok: false, code: 'desktop/invalid-timer' };
  mainWindow.minimize();
  return { ok: true };
});
ipcMain.on('timer:close', event => {
  if (!fromMain(event)) return;
  timerStopPending = false;
  if (timerWindow && !timerWindow.isDestroyed()) timerWindow.close();
});
ipcMain.on('timer:stop-from-popup', event => {
  if (!fromTimer(event)) return;
  timerStopPending = true;
  timerWindow.close();
});
app.whenReady().then(createMainWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { loginSession?.cancel(); });
app.on('activate', () => { if (!mainWindow) createMainWindow(); });
