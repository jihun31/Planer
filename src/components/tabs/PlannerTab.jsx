import { useEffect, useRef, useState } from 'react';
import { usePlanner } from '../../features/planner/usePlanner';
import { useControl } from '../../features/planner/useControl';
import { oppositeDisplayFromHistory } from '../../features/planner/oppositeDisplay.mjs';
import { plannerDate, rangeForDate, shiftPlannerDate } from '../../features/planner/scheduleTime.mjs';
import { hasVisibleModal, isEditingTarget } from '../../features/navigation/keyboardShortcuts.mjs';
import TimerBlock from '../planner/TimerBlock';
import ActivityManager from '../planner/ActivityManager';
import PlannerCalendar from '../planner/PlannerCalendar';
import MonthlyStats from '../planner/MonthlyStats';
import DailySchedule from '../planner/DailySchedule';
import '../../styles/planner.css';

const effectiveNow = () => {
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return d;
};
const nowDateStr = plannerDate;

function PlannerTab({ uid, scheduleHistory, settingsReady, settingsError, control = false, active = false }) {
  const today = nowDateStr();
  const now   = effectiveNow();
  const [selectedDate, setSelectedDate] = useState(today);
  const [calYear,  setCalYear]  = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const timerStart = useRef(null);
  const plannerData = usePlanner(control ? null : uid, calYear, calMonth, selectedDate);
  const controlData = useControl(control ? uid : null, calYear, calMonth, selectedDate);
  const { activities, allActivities, blocks, oppositeBlocks, oppositeActivities, loading, error, retryLoading, addActivity,
    deleteActivity, addBlock, saveTimer, deleteBlock, updateActivityOrder, updateActivityGroup } =
    control ? controlData : plannerData;
  const displaySettings = oppositeDisplayFromHistory(scheduleHistory);
  const oppositeMode = control ? displaySettings.controlOppositeDisplay : displaySettings.plannerOppositeDisplay;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey
        || event.shiftKey || isEditingTarget(event.target) || hasVisibleModal()) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const nextDate = shiftPlannerDate(selectedDate, event.key === 'ArrowLeft' ? -1 : 1);
      const [year, month] = nextDate.split('-').map(Number);
      setSelectedDate(nextDate);
      setCalYear(year);
      setCalMonth(month - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, selectedDate]);

  const handleMonthChange = (delta) => {
    let mo = calMonth + delta, yr = calYear;
    if (mo < 0)  { mo = 11; yr--; }
    if (mo > 11) { mo = 0;  yr++; }
    setCalMonth(mo); setCalYear(yr);
  };


  return (
    <div className="planner-wrap">
      {control && <blockquote className="control-quote">
        “현명해지는 가장 확실한 방법은 <strong>어리석음을 제거하는 것이다.</strong> 좋은 선택을 하고자 하기보다 나쁜 선택을 일상적으로 피하고자 하는 것이 <span className="control-quote-end">낫다.” <cite>— 찰리 멍거</cite></span>
      </blockquote>}
      {error ? <div role="alert">
        기록을 불러오지 못했습니다. 연결 상태와 접근 권한을 확인해 주세요.
        <button type="button" onClick={retryLoading}>다시 시도</button>
      </div> : loading && <div role="status">기록을 불러오는 중...</div>}
      <ActivityManager activities={activities} onAdd={addActivity} onDelete={deleteActivity} onUpdateOrder={updateActivityOrder}
        onUpdateGroup={updateActivityGroup} onStart={id => timerStart.current?.(id)} control={control} />
      <div className="planner-main">
        <div className="planner-left">
          <TimerBlock uid={uid} activities={activities} allActivities={allActivities} onSaveTimer={saveTimer} startActivityRef={timerStart} control={control} />
          <PlannerCalendar
            year={calYear} month={calMonth} selectedDate={selectedDate}
            blocks={blocks} oppositeBlocks={oppositeBlocks} oppositeActivities={oppositeActivities} oppositeMode={oppositeMode}
            onSelectDate={setSelectedDate} onMonthChange={handleMonthChange} control={control}
          />
          {!loading && !error && <MonthlyStats year={calYear} month={calMonth} blocks={blocks} activities={allActivities} control={control} />}
        </div>
        <div className="planner-right">
          {!settingsReady && <p role="status">시간 설정을 불러오는 중…</p>}
          {settingsError && <p role="alert">시간 설정을 불러오지 못해 기본 범위로 표시합니다. 기존 기록은 유지됩니다. 설정 버튼에서 안내를 확인해 주세요.</p>}
          {!loading && !error && settingsReady && <DailySchedule
            key={selectedDate + JSON.stringify(rangeForDate(scheduleHistory, selectedDate))} range={rangeForDate(scheduleHistory, selectedDate)}
            date={selectedDate} blocks={blocks} oppositeBlocks={oppositeBlocks} oppositeActivities={oppositeActivities}
            oppositeMode={oppositeMode} activities={activities} allActivities={allActivities}
            onAddBlock={addBlock} onDeleteBlock={deleteBlock} control={control}
          />}
        </div>
      </div>
    </div>
  );
}

export default PlannerTab;
