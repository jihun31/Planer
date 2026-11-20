const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BOUNDS = { width: 1280, height: 800 };
const MIN_VISIBLE = 64;

function validBounds(value, minWidth, minHeight) {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isSafeInteger)) return null;
  if (width < minWidth || height < minHeight || width > 20000 || height > 20000) return null;
  return { x, y, width, height };
}

// 저장된 위치가 지금 연결된 모니터 중 하나에 충분히 걸쳐 있어야 그대로 쓴다.
// 모니터를 뗐거나 해상도가 바뀌어 창이 화면 밖에 뜨는 일을 막는다.
function visibleOn(bounds, workAreas) {
  return workAreas.some(area => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return width >= MIN_VISIBLE && height >= MIN_VISIBLE;
  });
}

function loadWindowState(file, { workAreas, minWidth, minHeight }) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { bounds: { ...DEFAULT_BOUNDS }, maximized: false }; }
  const bounds = validBounds(saved?.bounds, minWidth, minHeight);
  const maximized = saved?.maximized === true;
  if (!bounds) return { bounds: { ...DEFAULT_BOUNDS }, maximized };
  if (!visibleOn(bounds, workAreas)) return { bounds: { width: bounds.width, height: bounds.height }, maximized };
  return { bounds, maximized };
}

function saveWindowState(file, win) {
  if (!win || win.isDestroyed()) return;
  const state = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch { /* 창 위치 저장 실패는 앱 동작에 영향이 없다. */ }
}

// 창을 옮기거나 크기를 바꾸면 잠시 뒤에, 닫을 때는 바로 저장한다.
function trackWindowState(win, file, delay = 500) {
  let timer = null;
  const save = () => { clearTimeout(timer); timer = null; saveWindowState(file, win); };
  const later = () => { clearTimeout(timer); timer = setTimeout(save, delay); };
  for (const name of ['resize', 'move', 'maximize', 'unmaximize']) win.on(name, later);
  win.on('close', save);
}

module.exports = { loadWindowState, saveWindowState, trackWindowState };
