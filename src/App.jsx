import ScheduleSettings from './components/ScheduleSettings';
import { useCollection } from './lib/useCollection';
import { subscribeScheduleSettings } from './features/planner/scheduleSettings';
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./features/auth/useAuth";
import { useGoals } from "./features/goals/useGoals";
import { useTasks } from "./features/tasks/useTasks";
import { useTodos } from "./features/todos/useTodos";
import { usePriorityNotes } from "./features/priorities/usePriorityNotes";
import { useLegacyBlockMigration } from './features/planner/useLegacyBlockMigration';
import { loginWithGoogle, logout, cancelLogin, loginErrorMessage } from "./features/auth/authService";
import TodayTab from "./components/tabs/TasksTab";
import PlannerTab from "./components/tabs/PlannerTab";
import { restTimer } from './components/planner/restTimer';
import LearningTab, { LearningSummary } from './components/tabs/LearningTab';
import HelpDialog from './components/HelpDialog';
import UpdateBanner from './components/UpdateBanner';
import NotesTab from './components/tabs/NotesTab';
import CalendarTab from './components/tabs/CalendarTab';
import { useLearning } from './features/learning/useLearning';
import { useDiscordLink, useServerInfo } from './features/discord/useDiscord';
import { useTonkatsu } from './features/tonkatsu/useTonkatsu';
import CheckInTab from './components/tabs/CheckInTab';
import HabitsTab from './components/tabs/HabitsTab';
import { useHabits } from './features/habits/useHabits';
import { hasVisibleModal, isEditingTarget } from './features/navigation/keyboardShortcuts.mjs';
import { useTabVisibility } from './features/navigation/useTabVisibility';
import { HOME_VIEW, availableViews, resolveView, stepView, tabOfView, viewForTab, visibleTabs } from './features/navigation/appTabs.mjs';
import "./styles/app.css";
import "./styles/goals.css";
import "./styles/tasks.css";

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
  const tabs = useMemo(() => visibleTabs(tabVisibility, tabContext), [tabVisibility, tabContext]);
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
  const tonkatsu = useTonkatsu(discordId, Boolean(openedViews.checkin));
  const learning = useLearning(openedViews.planner || openedViews.learning ? user?.uid : null);
  const activateView = useCallback(viewId => {
    setActiveView(viewId);
    setOpenedViews(opened => opened[viewId] ? opened : { ...opened, [viewId]: true });
  }, []);
  // 보던 화면이 숨겨지면 같은 탭의 다른 화면(없으면 오늘 할 일)으로 옮긴다.
  useEffect(() => { if (activeView !== currentView) activateView(currentView); }, [activeView, currentView, activateView]);
  const currentTabId = currentTab?.id;
  useEffect(() => {
    if (currentTabId) setLastViewByTab(last => last[currentTabId] === currentView ? last : { ...last, [currentTabId]: currentView });
  }, [currentTabId, currentView]);
  const [restTarget, setRestTarget] = useState(null);
  useEffect(() => { setRestTarget(null); }, [user?.uid]);
  const controlVisible = tabVisibility.control;
  useEffect(() => {
    if (user?.uid && controlVisible && restTimer.read(user.uid).session) activateView('control');
  }, [user?.uid, controlVisible, activateView]);

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
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      activateView(stepView(tabs, currentView, event.shiftKey ? -1 : 1));
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
          <h1 className="landing-title">Planer</h1>
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

  const plannerProps = { uid: user.uid, scheduleHistory, settingsReady, settingsError };
  const afterBlockMigration = content => blockMigration.ready ? content
    : <BlockMigrationNotice error={blockMigration.error} retry={blockMigration.retry} />;
  // 보기 id(appTabs.mjs)마다 그릴 화면
  const panels = {
    today: () => <TodayTab key={user.uid} uid={user.uid} tasks={tasksData} todos={todosData} goalsData={goalsData}
      priorityData={priorityData} habitsData={habitsData} scheduleHistory={scheduleHistory} settingsReady={settingsReady} settingsError={settingsError}
      onOpenHabits={tabOfView(tabs, 'habits') ? () => activateView('habits') : null} />,
    planner: () => <>
      <LearningSummary learning={learning} onOpen={() => activateView('learning')} />
      {afterBlockMigration(<PlannerTab key={user.uid} {...plannerProps} active={currentView === 'planner'}
        restTarget={restTarget?.uid === user.uid ? restTarget : null} />)}
    </>,
    control: () => afterBlockMigration(<PlannerTab key={`${user.uid}-control`} {...plannerProps} control
      active={currentView === 'control'} onRestReturn={resumeAfterRest} />),
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
          <span className="brand-name">Planer</span>
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

      {settingsUser === user.uid && <ScheduleSettings key={user.uid} uid={user.uid} history={scheduleHistory}
        ready={settingsReady} error={settingsError} onClose={() => setSettingsUser(null)} discord={discord} serverInfo={serverInfo} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
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
      </nav>

      <main className="main">
        {dataError && <p role="alert">
          데이터를 불러오지 못했습니다. 인터넷 연결과 계정 접근 권한을 확인해 주세요.
        </p>}
        {currentTab && currentTab.views.length > 1 && <div className="subtab-nav" role="group" aria-label={`${currentTab.label} 화면 선택`}>
          {currentTab.views.map(view => <button key={view.id} type="button" aria-pressed={currentView === view.id}
            className={`subtab-btn ${currentView === view.id ? 'subtab-active' : ''}`} onClick={() => activateView(view.id)}>
            {view.label}
          </button>)}
        </div>}
        {availableViews(tabContext).map(view => <div key={view.id} hidden={currentView !== view.id}>
          {(view.eager || openedViews[view.id]) && panels[view.id]()}
        </div>)}
      </main>
    </div>
  );
}

export default App;
