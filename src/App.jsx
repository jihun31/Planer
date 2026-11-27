import { useCollection } from './lib/useCollection';
import { subscribeScheduleSettings } from './features/planner/scheduleSettings';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./features/auth/useAuth";
import { useGoals } from "./features/goals/useGoals";
import { useTasks } from "./features/tasks/useTasks";
import { useTodos } from "./features/todos/useTodos";
import { usePriorityNotes } from "./features/priorities/usePriorityNotes";
import { useLegacyBlockMigration } from './features/planner/useLegacyBlockMigration';
import { loginWithGoogle, logout, cancelLogin, loginErrorMessage } from "./features/auth/authService";
import TodayTab from "./components/tabs/TodayTab";
import { restTimer } from './components/planner/restTimer';
import LearningSummary from './components/learning/LearningSummary';
import TaskReminder from './components/planner/TaskReminder';
import UpdateBanner from './components/UpdateBanner';
import { useLearning } from './features/learning/useLearning';
import { useDiscordLink, useServerInfo } from './features/discord/useDiscord';
import { useTonkatsu } from './features/tonkatsu/useTonkatsu';
import { useCheckInAlert, useCheckInAlertTime } from './features/tonkatsu/useCheckInAlert';
import { useHabits } from './features/habits/useHabits';
import { hasVisibleModal, isEditingTarget } from './features/navigation/keyboardShortcuts.mjs';
import { useTabVisibility } from './features/navigation/useTabVisibility';
import { useTabOrder } from './features/navigation/useTabOrder';
import { HOME_VIEW, availableViews, orderTabs, resolveView, stepSubView, tabOfView, viewForTab, visibleTabs } from './features/navigation/appTabs.mjs';

// 오늘 할 일 말고는 처음 열 때 코드를 받는다. 시작 뒤 한가할 때 미리 받아 두어 탭 전환은 기다리지 않는다.
const lazyViews = {
  planner: () => import('./components/tabs/PlannerTab'),
  learning: () => import('./components/tabs/LearningTab'),
  habits: () => import('./components/tabs/HabitsTab'),
  notes: () => import('./components/tabs/NotesTab'),
  calendar: () => import('./components/tabs/CalendarTab'),
  checkin: () => import('./components/tabs/CheckInTab'),
  settings: () => import('./components/ScheduleSettings'),
  help: () => import('./components/HelpDialog'),
};
const PlannerTab = lazy(lazyViews.planner);
const LearningTab = lazy(lazyViews.learning);
const HabitsTab = lazy(lazyViews.habits);
const NotesTab = lazy(lazyViews.notes);
const CalendarTab = lazy(lazyViews.calendar);
const CheckInTab = lazy(lazyViews.checkin);
const ScheduleSettings = lazy(lazyViews.settings);
const HelpDialog = lazy(lazyViews.help);

function preloadLazyViews() {
  const load = () => Object.values(lazyViews).forEach(loader => loader().catch(() => {}));
  if (typeof window.requestIdleCallback !== 'function') {
    const timer = setTimeout(load, 1500);
    return () => clearTimeout(timer);
  }
  const handle = window.requestIdleCallback(load, { timeout: 3000 });
  return () => window.cancelIdleCallback(handle);
}

const viewLoading = <p role="status" className="view-loading">화면을 불러오는 중…</p>;

function BlockMigrationNotice({ error, retry }) {
  if (error) return <div role="alert">
    기존 통제 기록을 옮기지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.
    <button type="button" onClick={retry}>다시 시도</button>
  </div>;
  return <p role="status">기존 통제 기록을 불러오는 중…</p>;
}

function App() {
  const { user, loading } = useAuth();
  const [activeView, setActiveView] = useState(HOME_VIEW);
  const [tabVisibility] = useTabVisibility(user?.uid);
  const discord = useDiscordLink(user?.uid);
  const discordId = discord.link?.discordId || null;
  const tabContext = useMemo(() => ({ discord: Boolean(discordId) }), [discordId]);
  const [tabOrder] = useTabOrder(user?.uid);
  const tabs = useMemo(() => visibleTabs(tabVisibility, tabContext, orderTabs(tabOrder)), [tabVisibility, tabContext, tabOrder]);
  const currentView = resolveView(tabs, activeView);
  const currentTab = tabOfView(tabs, currentView);
  const goalsData   = useGoals(user?.uid);
  const tasksData   = useTasks(user?.uid);
  const todosData   = useTodos(user?.uid);
  const priorityData = usePriorityNotes(user?.uid);
  const habitsData = useHabits(user?.uid);
  const blockMigration = useLegacyBlockMigration(user?.uid);
  const serverInfo = useServerInfo(!!discord.link);
  const [settingsUser, setSettingsUser] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [scheduleHistory, settingsReady, settingsError] = useCollection(user?.uid, subscribeScheduleSettings);
  // 한 번 연 화면은 숨겨도 계속 붙여 둔다(타이머 등 상태 유지).
  const [openedViews, setOpenedViews] = useState({});
  const [lastViewByTab, setLastViewByTab] = useState({});
  // 인증 PC 알림을 켜 두면 인증 탭을 열지 않아도 내 인증 상태를 받아 둔다.
  const [checkInAlertTime] = useCheckInAlertTime(user?.uid);
  const tonkatsu = useTonkatsu(discordId, Boolean(openedViews.checkin || checkInAlertTime));
  useCheckInAlert(user?.uid, discordId, tonkatsu, checkInAlertTime);
  // 시간 관리 화면의 요약은 최근 기록만, 학습 탭을 열면 전체 기록을 받는다.
  const learning = useLearning(openedViews.planner || openedViews.learning ? user?.uid : null,
    { full: Boolean(openedViews.learning) });
  const activateView = useCallback(viewId => {
    setActiveView(viewId);
    setOpenedViews(opened => opened[viewId] ? opened : { ...opened, [viewId]: true });
  }, []);
  useEffect(() => window.electronAPI?.onCheckInAlertClick?.(() => activateView('checkin')), [activateView]);
  // 보던 화면이 숨겨지면 같은 탭의 다른 화면(없으면 오늘 할 일)으로 옮긴다.
  useEffect(() => { if (activeView !== currentView) activateView(currentView); }, [activeView, currentView, activateView]);
  const currentTabId = currentTab?.id;
  useEffect(() => {
    if (currentTabId) setLastViewByTab(last => last[currentTabId] === currentView ? last : { ...last, [currentTabId]: currentView });
  }, [currentTabId, currentView]);
  const signedIn = Boolean(user);
  useEffect(() => signedIn ? preloadLazyViews() : undefined, [signedIn]);
  const [restTarget, setRestTarget] = useState(null);
  useEffect(() => { setRestTarget(null); }, [user?.uid]);
  const controlVisible = tabVisibility.control;
  useEffect(() => {
    if (user?.uid && controlVisible && restTimer.read(user.uid).session) activateView('control');
  }, [user?.uid, controlVisible, activateView]);

  // 타이머 정지 후 고른 다음 활동을 그 활동의 화면(기록·통제) 타이머에서 시작한다.
  // 시간 관리 탭을 보고 있었다면 그 화면으로 옮기고, 다른 탭이면 화면은 그대로 두고 타이머만 붙인다.
  const [timerSwitch, setTimerSwitch] = useState(null);
  useEffect(() => { setTimerSwitch(null); }, [user?.uid]);
  const switchTimer = (view, activityId) => {
    setTimerSwitch({ uid: user.uid, view, activityId });
    if (currentView === 'planner' || currentView === 'control') activateView(view);
    else setOpenedViews(opened => opened[view] ? opened : { ...opened, [view]: true });
  };
  // 다음 활동 창은 정지한 타이머의 화면 안에 있으므로, 창이 뜰 때 그 화면(기록 타이머면 기록 탭)으로 옮긴다.
  const showTimerPrompt = view => { if (currentView !== view) activateView(view); };
  const switchTargetFor = view => timerSwitch?.uid === user?.uid && timerSwitch?.view === view ? timerSwitch : null;

  // 기록 타이머를 정지한 뒤 다음 활동 창에서 "휴식 시작 (N분)"을 누르면 통제 화면의 휴식 타이머에서 시작한다(Flowtime 연결).
  const [flowRest, setFlowRest] = useState(null);
  useEffect(() => { setFlowRest(null); }, [user?.uid]);
  const startFlowRest = request => {
    setFlowRest({ uid: user.uid, ...request });
    if (currentView === 'planner' || currentView === 'control') activateView('control');
    else setOpenedViews(opened => opened.control ? opened : { ...opened, control: true });
  };

  const resumeAfterRest = activityId => {
    setRestTarget({ uid: user.uid, activityId });
    activateView('planner');
  };

  useEffect(() => {
    if (loading || !user || settingsUser === user.uid) return;
    const onKeyDown = event => {
      if (event.key !== 'Tab' || event.repeat || event.defaultPrevented || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey
        || isEditingTarget(event.target) || hasVisibleModal()) return;
      // 탭 사이는 옮기지 않고, 하위 화면이 있는 탭에서만 그 안의 화면을 바꾼다.
      const next = stepSubView(tabs, currentView, event.shiftKey ? -1 : 1);
      if (!next) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      activateView(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentView, tabs, activateView, loading, settingsUser, user]);

  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const dataError = goalsData.error || tasksData.error || todosData.error || priorityData.error;
  const handleLogin = async () => {
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError('');
    try { await loginWithGoogle(); }
    catch (error) { setLoginError(loginErrorMessage(error)); }
    finally { setLoginBusy(false); }
  };

  if (loading) {
    return (
      <div className="splash">
        <div className="splash-dots">
          <span /><span /><span />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="landing-bg">
        <div className="landing-card">
          <div className="landing-icon">🗓</div>
          <h1 className="landing-title">Planner</h1>
          <p className="landing-desc">
            장기 목표부터 일상 할 일까지<br />
            모든 계획을 한 곳에서 관리하세요.
          </p>
          <div className="landing-features">
            <span>📋 오늘 할 일</span>
            <span>🎯 목표 등록</span>
            <span>🕐 시간 관리</span>
          </div>
          <button className="btn-google" onClick={handleLogin} disabled={loginBusy}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.025 17.64 11.716 17.64 9.2z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Google로 시작하기
          </button>
          {loginBusy && <p role="status">브라우저에서 로그인을 완료해 주세요.
            <button type="button" onClick={cancelLogin}>취소</button>
          </p>}
          {loginError && <p role="alert">{loginError}</p>}
        </div>
      </div>
    );
  }

  const plannerProps = { uid: user.uid, scheduleHistory, settingsReady, settingsError, controlAvailable: controlVisible, onTimerSwitch: switchTimer, onTimerPrompt: showTimerPrompt,
    onFlowRest: startFlowRest };
  const afterBlockMigration = content => blockMigration.ready ? content
    : <BlockMigrationNotice error={blockMigration.error} retry={blockMigration.retry} />;
  // 보기 id(appTabs.mjs)마다 그릴 화면
  const panels = {
    today: () => <TodayTab key={user.uid} uid={user.uid} tasks={tasksData} todos={todosData} goalsData={goalsData}
      priorityData={priorityData} habitsData={habitsData} scheduleHistory={scheduleHistory} settingsReady={settingsReady} settingsError={settingsError}
      onOpenHabits={tabOfView(tabs, 'habits') ? () => activateView('habits') : null} />,
    planner: () => <>
      {/* 학습 기록 탭을 숨기면 요약도 함께 숨긴다(누르면 갈 곳이 없다). */}
      {tabOfView(tabs, 'learning') && <LearningSummary learning={learning} onOpen={() => activateView('learning')} />}
      {afterBlockMigration(<PlannerTab key={user.uid} {...plannerProps} active={currentView === 'planner'}
        restTarget={restTarget?.uid === user.uid ? restTarget : null} switchTarget={switchTargetFor('planner')} />)}
    </>,
    control: () => afterBlockMigration(<PlannerTab key={`${user.uid}-control`} {...plannerProps} control
      active={currentView === 'control'} onRestReturn={resumeAfterRest} switchTarget={switchTargetFor('control')}
      flowRestTarget={flowRest?.uid === user.uid ? flowRest : null} />),
    learning: () => <LearningTab key={user.uid} learning={learning} active={currentView === 'learning'} />,
    habits: () => <HabitsTab key={user.uid} uid={user.uid} habitsData={habitsData} />,
    notes: () => <NotesTab key={user.uid} uid={user.uid} />,
    calendar: () => <CalendarTab key={user.uid} uid={user.uid} active={currentView === 'calendar'} />,
    checkin: () => <CheckInTab tonkatsu={tonkatsu} discordId={discordId} />,
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="brand-icon">🗓</span>
          <span className="brand-name">Planner</span>
        </div>
        <div className="header-user">
          {user.photoURL && (
            <img src={user.photoURL} alt="프로필" className="avatar" />
          )}
          <span className="user-name">{user.displayName}</span>
          <button type="button" className="header-help" aria-label="사용법 보기" title="사용법"
            onClick={() => setHelpOpen(true)}>?</button>
          <button className="btn-signout" onClick={() => setSettingsUser(user.uid)} disabled={!settingsReady}>⚙ 설정</button>
          <button className="btn-signout" onClick={logout}>로그아웃</button>
        </div>
      </header>
      <UpdateBanner />

      <Suspense fallback={null}>
        {settingsUser === user.uid && <ScheduleSettings key={user.uid} uid={user.uid} history={scheduleHistory}
          ready={settingsReady} error={settingsError} onClose={() => setSettingsUser(null)} discord={discord} serverInfo={serverInfo} />}
        {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      </Suspense>
      <nav className="tab-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${currentTab?.id === tab.id ? "tab-active" : ""}`}
            onClick={() => activateView(viewForTab(tab, lastViewByTab))}
          >
            {tab.label}
          </button>
        ))}
        {/* 선택한 탭에 하위 화면이 있으면 탭 바 오른쪽 끝에서 전환한다(본문 위에 줄을 더 만들지 않는다). */}
        {currentTab && currentTab.views.length > 1 && <div className="subtab-nav" role="group" aria-label={`${currentTab.label} 화면 선택`}>
          {currentTab.views.map(view => <button key={view.id} type="button" aria-pressed={currentView === view.id}
            className={`subtab-btn ${currentView === view.id ? 'subtab-active' : ''}`} onClick={() => activateView(view.id)}>
            {view.label}
          </button>)}
        </div>}
      </nav>

      <main className="main">
        {dataError && <p role="alert">
          데이터를 불러오지 못했습니다. 인터넷 연결과 계정 접근 권한을 확인해 주세요.
        </p>}
        {currentTabId === 'time' && <TaskReminder key={user.uid} tasks={tasksData.tasks} onToggle={tasksData.toggleTask}
          habits={habitsData.habits} onSetHabitLog={habitsData.setLog} />}
        {availableViews(tabContext).map(view => <div key={view.id} hidden={currentView !== view.id}>
          {(view.eager || openedViews[view.id]) && <Suspense fallback={viewLoading}>{panels[view.id]()}</Suspense>}
        </div>)}
      </main>
    </div>
  );
}

export default App;
