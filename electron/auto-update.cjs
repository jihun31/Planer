// 앱 자동 업데이트: GitHub Releases(jihun31/Planer)에서 새 버전을 확인해 백그라운드로 받고,
// 받기가 끝나면 화면에 알림. '지금 다시 시작'을 누르거나 앱을 끌 때 설치됨.
const CHECK_DELAY_MS = 10 * 1000;            // 앱을 켜고 10초 뒤 첫 확인
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 이후 4시간마다

function setupAutoUpdate({ autoUpdater, ipcMain, isAllowed, getWindow, logger = console, timers = globalThis }) {
  let state = { status: 'idle' }; // idle | checking | downloading | ready | error
  const setState = (next) => {
    state = next;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:status', state);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => { if (state.status !== 'ready') setState({ status: 'checking' }); });
  autoUpdater.on('update-not-available', () => { if (state.status !== 'ready') setState({ status: 'idle' }); });
  autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info?.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') setState({ ...state, percent: Math.round(p?.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info?.version }));
  autoUpdater.on('error', (error) => {
    // 인터넷이 끊겼거나 GitHub에 접속 못 할 때. 다음 확인 때 다시 시도하고, 화면에는 굳이 알리지 않음
    logger.warn?.('[auto-update]', error?.message || error);
    if (state.status !== 'ready') setState({ status: 'error' });
  });

  const check = () => { autoUpdater.checkForUpdates().catch((error) => logger.warn?.('[auto-update]', error?.message || error)); };

  ipcMain.handle('update:get-state', (event) => (isAllowed(event) ? state : null));
  ipcMain.on('update:install', (event) => {
    if (!isAllowed(event) || state.status !== 'ready') return;
    // 조용히 설치하고 설치가 끝나면 앱을 다시 켬
    autoUpdater.quitAndInstall(true, true);
  });

  const first = timers.setTimeout(check, CHECK_DELAY_MS);
  const repeat = timers.setInterval(check, CHECK_INTERVAL_MS);
  return { getState: () => state, check, stop: () => { timers.clearTimeout(first); timers.clearInterval(repeat); } };
}

module.exports = { setupAutoUpdate, CHECK_DELAY_MS, CHECK_INTERVAL_MS };
