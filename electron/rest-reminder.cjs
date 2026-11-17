function registerRestReminder({ ipcMain, powerMonitor, Notification, fromMain, revealMain, onElapsed }) {
  let reminder = null;
  let timeout = null;
  let notification = null;

  function clear() {
    clearTimeout(timeout);
    timeout = null;
    reminder = null;
    notification?.close();
    notification = null;
  }

  function refresh() {
    clearTimeout(timeout);
    timeout = null;
    if (!reminder || reminder.sent) return;
    const remaining = reminder.endTs - Date.now();
    if (remaining > 0) {
      timeout = setTimeout(refresh, remaining);
      return;
    }
    reminder.sent = true;
    onElapsed?.(reminder.key);
    if (!Notification.isSupported()) return;
    notification = new Notification({ title: 'Planer', body: '휴식 시간이 끝났어요.' });
    notification.on('click', revealMain);
    notification.show();
  }

  ipcMain.on('rest:schedule-reminder', (event, data) => {
    if (!fromMain(event) || typeof data?.key !== 'string' || !/^\d{1,16}:\d{1,16}$/.test(data.key)
      || !Number.isFinite(data.endTs) || data.endTs > Date.now() + 86_400_000) return;
    if (reminder?.key === data.key) return;
    clear();
    reminder = { key: data.key, endTs: data.endTs, sent: false };
    refresh();
  });
  ipcMain.on('rest:clear-reminder', (event, key) => {
    if (fromMain(event) && key === reminder?.key) clear();
  });
  powerMonitor.on('resume', refresh);
  return clear;
}

module.exports = { registerRestReminder };
