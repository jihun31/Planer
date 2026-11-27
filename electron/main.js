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

// Planner는 한 번만 실행한다. 두 번째 실행은 이미 떠 있는 창을 앞으로 가져오고 끝난다.
// 둘이 함께 돌면 휴식 알림과 타이머 팝업이 두 개씩 생긴다.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  if (isDev) console.warn('[planer] 이미 실행 중인 Planner가 있어 그 창을 앞으로 가져오고 종료합니다.');
  app.quit();
}

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

const windowStatePath = () => isDev ? path.join(__dirname, '../local-data/window-state.json')
  : path.join(app.getPath('userData'), 'window-state.json');

function createMainWindow() {
  const { loadWindowState, trackWindowState } = require('./window-state.cjs');
  const minWidth = 800, minHeight = 600;
  const workAreas = screen.getAllDisplays().map(display => display.workArea);
  const { bounds, maximized } = loadWindowState(windowStatePath(), { workAreas, minWidth, minHeight });
  mainWindow = new BrowserWindow({
    ...bounds, minWidth, minHeight, show: false,
    title: 'Planner', autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (maximized) mainWindow.maximize();
  mainWindow.show();
  trackWindowState(mainWindow, windowStatePath());
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

function placeTimerWindow(win, isRest, isCompact, position) {
  // 메인 창이 있는 모니터에 띄운다. 최소화된 창은 getBounds가 화면 밖 좌표라 복원 시 크기를 쓴다.
  const mainAlive = mainWindow && !mainWindow.isDestroyed();
  const display = mainAlive ? screen.getDisplayMatching(mainWindow.getNormalBounds()) : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const popupWidth = isCompact ? 136 : 176;
  const popupHeight = isCompact ? 66 : (isRest ? 112 : 128);
  // Keep the center fixed by trimming both sides of each popup equally.
  const previousWidth = isRest ? 184 : 200;
  const sideMargin = isCompact ? 16 : 16 + (previousWidth - popupWidth) / 2;
  win.setResizable(true);
  win.setSize(popupWidth, popupHeight);
  win.setResizable(false);
  win.setPosition(position === 'left' ? x + sideMargin : x + width - popupWidth - sideMargin, y + height - popupHeight - 16);
}

function createTimerWindow(data) {
  if (!data || typeof data.actName !== 'string' || data.actName.length > 500 ||
      !Number.isFinite(data.startTs) || typeof data.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(data.color)) return false;
  const isRest = data.mode === 'rest';
  const isCompact = data.compact === true;
  const position = data.position === 'left' ? 'left' : 'right';
  if (isRest && (!Number.isSafeInteger(data.startTs) || (data.endTs !== null &&
      (!Number.isSafeInteger(data.endTs) || data.endTs < data.startTs)))) return false;
  if (timerWindow && !timerWindow.isDestroyed() && isRest !== (timerMode === 'rest')) return false;
  timerMode = isRest ? 'rest' : 'elapsed';
  const safeData = {
    ...(isRest ? { mode: 'rest', endTs: data.endTs, key: data.startTs + ':' + data.endTs } : {}),
    actName: data.actName, startTs: data.startTs, color: data.color,
    startLabel: typeof data.startLabel === 'string' ? data.startLabel.slice(0, 30) : '',
    compact: isCompact,
  };
  timerState = safeData;
  if (timerWindow && !timerWindow.isDestroyed()) {
    placeTimerWindow(timerWindow, isRest, isCompact, position);
    if (!isRest) timerWindow.focus();
    else if (data.reveal && !timerWindow.webContents.isLoading()) timerWindow.show();
    timerWindow.webContents.send('timer:data', safeData);
    return true;
  }
  const win = new BrowserWindow({
    width: isCompact ? 136 : 176, height: isCompact ? 66 : (isRest ? 112 : 128), resizable: false, show: !isRest,
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
  placeTimerWindow(win, isRest, isCompact, position);
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
// 타이머 팝업을 여는 유일한 통로. 타이머를 시작할 때는 메인 창을 내리고,
// 이미 도는 타이머를 팝업으로 옮길 때는 { minimize: false }로 창을 그대로 둔다.
ipcMain.handle('timer:start', (event, data, options) => {
  if (!fromMain(event)) return { ok: false, code: 'desktop/forbidden' };
  if (!createTimerWindow(data)) return { ok: false, code: 'desktop/invalid-timer' };
  if (options?.minimize !== false) mainWindow.minimize();
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
  if (type === 'end' || (type === 'expire' && timerState.endTs !== null && timerState.endTs <= Date.now())) {
    sendRestCommand(type, key);
  }
});
ipcMain.on('timer:stop-from-popup', event => {
  if (!fromTimer(event) || timerMode === 'rest') return;
  timerStopPending = true;
  timerWindow.close();
});
// 돈까스 인증을 안 했을 때 렌더러가 요청하는 Windows 알림. 누르면 인증 탭을 연다.
let checkInNotification = null;
ipcMain.on('checkin:show-alert', (event, data) => {
  if (!fromMain(event) || typeof data?.title !== 'string' || typeof data?.body !== 'string'
    || data.title.length > 200 || data.body.length > 1000 || !Notification.isSupported()) return;
  checkInNotification?.close();
  checkInNotification = new Notification({ title: data.title, body: data.body });
  checkInNotification.on('click', () => {
    revealMain();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('checkin:open');
  });
  checkInNotification.show();
});
app.on('second-instance', revealMain);
app.whenReady().then(() => {
  if (!hasInstanceLock) return;
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
app.on('activate', () => { if (hasInstanceLock && !mainWindow) createMainWindow(); });
