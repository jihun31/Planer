import ScheduleSettings from './components/ScheduleSettings';
import { useCollection } from './lib/useCollection';
import { subscribeScheduleSettings } from './features/planner/scheduleSettings';
import { useState } from "react";
import { useAuth } from "./features/auth/useAuth";
import { useGoals } from "./features/goals/useGoals";
import { useTasks } from "./features/tasks/useTasks";
import { useTodos } from "./features/todos/useTodos";
import { useLegacyBlockMigration } from './features/planner/useLegacyBlockMigration';
import { loginWithGoogle, logout, cancelLogin, loginErrorMessage } from "./features/auth/authService";
import TodayTab from "./components/tabs/TasksTab";
import PlannerTab from "./components/tabs/PlannerTab";
import "./styles/app.css";
import "./styles/goals.css";
import "./styles/tasks.css";

const TABS = [
  { id: "today",   label: "📋 오늘 할 일" },
  { id: "planner", label: "🕐 시간 관리" },
  { id: "control", label: "🧭 통제" },
];

function BlockMigrationNotice({ error, retry }) {
  if (error) return <div role="alert">
    기존 통제 기록을 옮기지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.
    <button type="button" onClick={retry}>다시 시도</button>
  </div>;
  return <p role="status">기존 통제 기록을 불러오는 중…</p>;
}

function App() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("today");
  const goalsData   = useGoals(user?.uid);
  const tasksData   = useTasks(user?.uid);
  const todosData   = useTodos(user?.uid);
  const blockMigration = useLegacyBlockMigration(user?.uid);
  const [settingsUser, setSettingsUser] = useState(null);
  const [scheduleHistory, settingsReady, settingsError] = useCollection(user?.uid, subscribeScheduleSettings);
  const [plannerOpened, setPlannerOpened] = useState(false);
  const [controlOpened, setControlOpened] = useState(false);

  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const dataError = goalsData.error || tasksData.error || todosData.error;
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
          <button className="btn-signout" onClick={() => setSettingsUser(user.uid)} disabled={!settingsReady}>⚙ 설정</button>
          <button className="btn-signout" onClick={logout}>로그아웃</button>
        </div>
      </header>

      {settingsUser === user.uid && <ScheduleSettings key={user.uid} uid={user.uid} history={scheduleHistory}
        ready={settingsReady} error={settingsError} onClose={() => setSettingsUser(null)} />}
      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "tab-active" : ""}`}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === "planner") setPlannerOpened(true);
              if (tab.id === "control") setControlOpened(true);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {dataError && <p role="alert">
          데이터를 불러오지 못했습니다. 인터넷 연결과 계정 접근 권한을 확인해 주세요.
        </p>}
        <div hidden={activeTab !== "today"}>
          <TodayTab key={user.uid} tasks={tasksData} todos={todosData} goalsData={goalsData} />
        </div>
        <div hidden={activeTab !== "planner"}>
          {plannerOpened && (blockMigration.ready
            ? <PlannerTab key={user.uid} uid={user.uid} scheduleHistory={scheduleHistory} settingsReady={settingsReady} settingsError={settingsError} />
            : <BlockMigrationNotice error={blockMigration.error} retry={blockMigration.retry} />)}
        </div>
        <div hidden={activeTab !== "control"}>
          {controlOpened && (blockMigration.ready
            ? <PlannerTab key={`${user.uid}-control`} uid={user.uid} control scheduleHistory={scheduleHistory} settingsReady={settingsReady} settingsError={settingsError} />
            : <BlockMigrationNotice error={blockMigration.error} retry={blockMigration.retry} />)}
        </div>
      </main>
    </div>
  );
}

export default App;
