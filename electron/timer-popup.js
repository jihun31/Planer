let startTs = null;
let restSession = null;
let intervalId = null;

function fmtElapsed(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function applyColor(c) {
  document.body.style.borderColor = c;
  document.getElementById('dot').style.background = c;
  document.getElementById('time').style.color = c;
  document.getElementById('start-label').style.color = c;
  document.getElementById('stop-btn').style.color = c;
  document.getElementById('stop-btn').style.borderColor = c;
}

function startTick() {
  if (intervalId) clearInterval(intervalId);
  if (restSession) {
    const { startTs: restStartTs, endTs, key } = restSession;
    const tick = () => {
      const now = Date.now();
      const seconds = endTs === null ? Math.floor((now - restStartTs) / 1000) : Math.ceil((endTs - now) / 1000);
      document.getElementById('time').textContent = fmtElapsed(Math.max(0, seconds));
      if (endTs === null || seconds > 0) return;
      clearInterval(intervalId);
      window.electronAPI.sendRestPopupCommand({ type: 'expire', key });
    };
    intervalId = setInterval(tick, 250);
    tick();
    return;
  }
  const tick = () => {
    if (startTs === null) return;
    const seconds = Math.floor((Date.now() - startTs) / 1000);
    document.getElementById('time').textContent = fmtElapsed(seconds);
  };
  intervalId = setInterval(tick, 1000);
  tick();
}

window.electronAPI.onTimerData((data) => {
  restSession = data.mode === 'rest' ? data : null;
  const isCompact = data.compact === true;
  document.body.dataset.mode = restSession ? 'rest' : 'elapsed';
  document.body.dataset.compact = isCompact ? 'true' : 'false';
  const header = document.getElementById('header');
  const timeEl = document.getElementById('time');
  const closeBtn = document.getElementById('close-btn');
  const startLabelEl = document.getElementById('start-label');
  if (isCompact) header.insertBefore(timeEl, closeBtn);
  else document.body.insertBefore(timeEl, startLabelEl);
  closeBtn.title = restSession ? '숨기기' : '닫기';
  document.getElementById('stop-btn').textContent = restSession ? '휴식 마치기' : (isCompact ? '■ 정지' : '■ 정지 & 기록');
  document.getElementById('name').textContent = data.actName;
  startLabelEl.textContent = data.startLabel ? data.startLabel + ' 시작' : '';
  applyColor(data.color);
  startTs = data.startTs;
  startTick();
});

document.getElementById('stop-btn').addEventListener('click', () => {
  if (restSession) {
    window.electronAPI.sendRestPopupCommand({ type: 'end', key: restSession.key });
    return;
  }
  clearInterval(intervalId);
  window.electronAPI.stopTimerFromPopup();
});

document.getElementById('close-btn').addEventListener('click', () => {
  if (restSession) {
    window.electronAPI.sendRestPopupCommand({ type: 'hide', key: restSession.key });
    return;
  }
  clearInterval(intervalId);
  window.electronAPI.stopTimerFromPopup();
});
