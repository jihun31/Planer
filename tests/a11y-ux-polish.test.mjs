import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const stripImports = source =>
  source
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];?\s*/g, '')
    .replace(/export\s+(const|function)\s+/g, '$1 ');

test('커스텀 모달 3곳은 dialog role, aria-modal, aria-label 및 Escape 닫기를 제공한다', () => {
  for (const [file, label] of [
    ['src/components/today/GoalsPanel.jsx', '목표 관리'],
    ['src/components/today/TasksPanel.jsx', '할 일 관리'],
    ['src/components/today/PriorityBar.jsx', '우선순위'],
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /role="dialog"/, `${file}: role="dialog" 누락`);
    assert.match(source, /aria-modal="true"/, `${file}: aria-modal="true" 누락`);
    assert.ok(source.includes(`aria-label="${label}"`), `${file}: aria-label="${label}" 누락`);
    assert.match(source, /["']Escape["']/, `${file}: Escape 키 닫기 핸들러 누락`);
    assert.match(source, /defaultPrevented/, `${file}: 인라인 편집 Esc와 충돌하지 않도록 defaultPrevented 확인 필요`);
    assert.match(source, /className="modal-close"[^>]*aria-label="닫기"/, `${file}: 닫기 버튼 aria-label 누락`);
  }
});

test('TimerBlock은 블로킹 alert()를 호출하지 않고 인라인 오류 상태로 안내한다', () => {
  const source = fs.readFileSync('src/components/planner/TimerBlock.jsx', 'utf8');
  assert.doesNotMatch(source, /\balert\s*\(/, 'TimerBlock에 블로킹 alert()가 남아 있음');
  assert.match(source, /setDesktopError\(['"]다른 탭의 타이머를 먼저 정지해 주세요\.['"]\)/);
  assert.match(source, /\{desktopError && <p role="alert">\{desktopError\}<\/p>\}/);
});

test('CheckInTab은 ref 기반 중복 실행 가드, busy 시 폼 제출 비활성화, 아이콘 버튼 aria-label을 가진다', () => {
  const source = fs.readFileSync('src/components/tabs/CheckInTab.jsx', 'utf8');
  assert.match(source, /const runningRef = useRef\(false\)/);
  assert.match(source, /if \(runningRef\.current\) return false;/);
  assert.match(source, /disabled=\{!!error \|\| busy\}>등록<\/button>/);
  assert.match(source, /disabled=\{!changed \|\| !!error \|\| busy\}>저장<\/button>/);
  assert.match(source, /title="계획 수정"\s+aria-label=\{`\$\{plan\.content\} 계획 수정`\}/);
  assert.match(source, /title="계획 삭제"\s+aria-label=\{`\$\{plan\.content\} 계획 삭제`\}/);
});

test('TodoItem과 GoalCard의 아이콘 버튼은 한국어 aria-label을 가진다', () => {
  const todoSource = fs.readFileSync('src/components/today/TodoItem.jsx', 'utf8');
  assert.match(todoSource, /className="th-del"[^\n]*aria-label=\{`\$\{todo\.title\} 삭제`\}/);

  const goalSource = fs.readFileSync('src/components/GoalCard.jsx', 'utf8');
  assert.match(goalSource, /className="subgoal-delete"[^\n]*aria-label=\{`\$\{sub\.title\} 삭제`\}/);
  assert.match(goalSource, /className="goal-color-toggle"[\s\S]*?aria-label=\{`\$\{goal\.title\} 색상 변경`\}/);
  assert.match(goalSource, /className=\{`goal-color-dot[\s\S]*?aria-label=\{`색상 \$\{c\}`\}/);
});

test('ActivityManager는 reordering 중 삭제된 항목이 있어도 displayActivities 기준으로 인덱스를 맞춘다', () => {
  const source = fs.readFileSync('src/components/planner/ActivityManager.jsx', 'utf8');
  assert.match(source, /const next = displayActivities\.map\(a => a\.id\);/);
  assert.match(source, /const currentIds = new Set\(activities\.map\(a => a\.id\)\);/);
  assert.match(source, /ids\.filter\(id => currentIds\.has\(id\)\)/);
});

test('ScheduleSettings는 모든 타이머 설정 변경에 saveTimerPreference 헬퍼를 사용한다', () => {
  const source = fs.readFileSync('src/components/ScheduleSettings.jsx', 'utf8');
  const calls = source.match(/saveTimerPreference\(\(\) =>/g) || [];
  assert.equal(calls.length, 6, '타이머 설정 6개 모두 saveTimerPreference를 사용해야 함');
  const inlineFailureSets = source.match(/setTimerFailure\('타이머 설정을 저장하지 못했습니다/g) || [];
  assert.equal(inlineFailureSets.length, 1, 'setTimerFailure 오류 문구는 헬퍼 1곳에만 있어야 함');
});

test('timerPreferences 훅들은 useBooleanPreference로 통합되었으며 기존 동작을 100% 유지한다', () => {
  const source = fs.readFileSync('src/features/planner/timerPreferences.js', 'utf8');
  const storage = new Map();
  let dispatched = 0;
  const context = vm.createContext({
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    Event: class FakeEvent { constructor(type) { this.type = type; } },
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => { dispatched += 1; },
      localStorage: {
        getItem: k => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
      },
    },
  });

  vm.runInContext(
    `${stripImports(source)}
    globalThis.hooks = {
      useTimerPopupPreference,
      useStudyGapPreference,
      useTimerPopupPosition,
      useTimerSwitchPreference,
      useTimerCompactPreference,
      useFlowRestPreference,
    };`,
    context
  );

  const {
    useTimerPopupPreference,
    useStudyGapPreference,
    useTimerPopupPosition,
    useTimerSwitchPreference,
    useTimerCompactPreference,
    useFlowRestPreference,
  } = context.hooks;

  // 기본값 확인
  assert.equal(useTimerPopupPreference('u1')[0], true);
  assert.equal(useTimerCompactPreference('u1')[0], true);
  assert.equal(useStudyGapPreference('u1')[0], false);
  assert.equal(useTimerSwitchPreference('u1')[0], false);
  assert.equal(useFlowRestPreference('u1')[0], false);
  assert.equal(useTimerPopupPosition('u1')[0], 'right');

  // 값 저장 및 읽기
  useTimerPopupPreference('u1')[1](false);
  assert.equal(useTimerPopupPreference('u1')[0], false);
  assert.equal(storage.get('planer:timer-popup:u1'), 'false');

  useStudyGapPreference('u1')[1](true);
  assert.equal(useStudyGapPreference('u1')[0], true);
  assert.equal(storage.get('planer:study-gap-control:u1'), 'true');

  useTimerSwitchPreference('u1')[1](true);
  assert.equal(useTimerSwitchPreference('u1')[0], true);

  useTimerCompactPreference('u1')[1](false);
  assert.equal(useTimerCompactPreference('u1')[0], false);

  useFlowRestPreference('u1')[1](true);
  assert.equal(useFlowRestPreference('u1')[0], true);

  useTimerPopupPosition('u1')[1]('left');
  assert.equal(useTimerPopupPosition('u1')[0], 'left');
  assert.equal(dispatched, 6);

  // 손상된 값은 기본값으로 폴백
  storage.set('planer:timer-popup:u1', 'corrupted');
  assert.equal(useTimerPopupPreference('u1')[0], true);
  storage.set('planer:study-gap-control:u1', 'corrupted');
  assert.equal(useStudyGapPreference('u1')[0], false);

  // 잘못된 입력/uid 없음은 예외 발생
  assert.throws(() => useTimerPopupPreference(null)[1](true), /Invalid timer preference/);
  assert.throws(() => useTimerPopupPreference('u1')[1]('true'), /Invalid timer preference/);
  assert.throws(() => useTimerPopupPosition('u1')[1]('center'), /Invalid timer position/);
});
