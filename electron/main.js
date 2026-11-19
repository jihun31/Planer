const { app, BrowserWindow, shell, ipcMain, screen, Notification, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { readDesktopConfig, startGoogleLogin } = require('./google-auth.cjs');

const isDev = !app.isPackaged;
const mainUrl = isDev ? 'http://localhost:5173/' : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const timerUrl = pathToFileURL(path.join(__dirname, 'timer-popup.html')).href;
let mainWindow = null, timerWindow = null, loginSession = null;
let timerStopPending = false;
let timerMode = 'elapsed';
let timerState = null;
let clearRestReminder = () => {};

function revealMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function sendRestCommand(type, key) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rest:command', { type, key });
}

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
require('./note-image-store.cjs').registerNoteImages(ipcMain, fromMain, () => path.join(app.getPath('userData'), 'note-images'));

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
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const zoomModifier = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type !== 'keyDown' || !zoomModifier || input.alt) return;
    if (input.key !== '=' && input.key !== '+' && input.code !== 'NumpadAdd') return;

    event.preventDefault();
    // Match Electron's built-in zoom menu step.
    mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5);
  });
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
    clearRestReminder();
    if (timerWindow && !timerWindow.isDestroyed()) timerWindow.close();
  });
}

function createTimerWindow(data) {
  if (!data || typeof data.actName !== 'string' || data.actName.length > 500 ||
      !Number.isFinite(data.startTs) || typeof data.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(data.color)) return false;
  const isRest = data.mode === 'rest';
  if (isRest && (!Number.isSafeInteger(data.startTs) || !Number.isSafeInteger(data.endTs) ||
      data.endTs < data.startTs)) return false;
  if (timerWindow && !timerWindow.isDestroyed() && isRest !== (timerMode === 'rest')) return false;
  timerMode = isRest ? 'rest' : 'elapsed';
  const safeData = {
    ...(isRest ? { mode: 'rest', endTs: data.endTs, key: data.startTs + ':' + data.endTs } : {}),
    actName: data.actName, startTs: data.startTs, color: data.color,
    startLabel: typeof data.startLabel === 'string' ? data.startLabel.slice(0, 30) : '',
  };
  timerState = safeData;
  if (timerWindow && !timerWindow.isDestroyed()) {
    if (!isRest) timerWindow.focus();
    else if (data.reveal && !timerWindow.webContents.isLoading()) timerWindow.show();
    timerWindow.webContents.send('timer:data', safeData);
    return true;
  }
  const win = new BrowserWindow({
    width: 176, height: isRest ? 112 : 128, resizable: false, show: !isRest,
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
    if (!win.isDestroyed()) win.webContents.send('timer:data', timerState);
  });
  if (isRest) win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
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
  const position = data.position === 'left' ? 'left' : 'right';
  const [popupWidth, popupHeight] = win.getSize();
  // Keep the center fixed by trimming both sides of each popup equally.
  const previousWidth = isRest ? 184 : 200;
  const sideMargin = 16 + (previousWidth - popupWidth) / 2;
  win.setPosition(position === 'left' ? x + sideMargin : x + width - popupWidth - sideMargin, y + height - popupHeight - 16);
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
ipcMain.handle('rest:open-popup', (event, data) => {
  if (!fromMain(event)) return { ok: false };
  return { ok: createTimerWindow({ ...data, mode: 'rest' }) };
});
ipcMain.on('rest:close-popup', (event, restore) => {
  if (!fromMain(event)) return;
  if (restore === true) revealMain();
  if (timerMode === 'rest' && timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.destroy();
    timerWindow = null;
  }
});
ipcMain.on('rest:popup-command', (event, command) => {
  if (!fromTimer(event) || timerMode !== 'rest' || !timerState || command?.key !== timerState.key) return;
  const { type, key } = command;
  if (type === 'hide') { timerWindow.hide(); return; }
  if (type === 'end' || (type === 'expire' && timerState.endTs <= Date.now())) sendRestCommand(type, key);
});
ipcMain.on('timer:stop-from-popup', event => {
  if (!fromTimer(event) || timerMode === 'rest') return;
  timerStopPending = true;
  timerWindow.close();
});
app.whenReady().then(() => {
  const { registerRestReminder } = require('./rest-reminder.cjs');
  if (process.platform === 'win32') app.setAppUserModelId('com.planer.app');
  clearRestReminder = registerRestReminder({
    ipcMain, powerMonitor, Notification, fromMain, revealMain,
    onElapsed: key => sendRestCommand('expire', key),
  });
  createMainWindow();
  // 설치본에서만 자동 업데이트 (개발 중에는 끔)
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      require('./auto-update.cjs').setupAutoUpdate({ autoUpdater, ipcMain, isAllowed: fromMain, getWindow: () => mainWindow });
    } catch (error) { console.warn('[auto-update] 시작 실패', error?.message || error); }
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { loginSession?.cancel(); });
app.on('activate', () => { if (!mainWindow) createMainWindow(); });
