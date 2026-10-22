import { useState, useMemo } from "react";
import { todayStr } from "../../features/habits/habitService";

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const TIME_SLOTS = ['오전', '오후', '저녁'];

/* ── 왼쪽 메인 영역 ── */
function TodayMain({ tasks, selectedDate, onAdd, onToggle, onDelete, onDateChange }) {
  const [title,    setTitle]    = useState("");
  const [timeSlot, setTimeSlot] = useState("오전");
  const [busy,     setBusy]     = useState(false);

  const dateTasks = useMemo(() => tasks.filter(t => t.dueDate === selectedDate), [tasks, selectedDate]);
  const done  = dateTasks.filter(t => t.completed).length;
  const total = dateTasks.length;

  const grouped = useMemo(() => {
    const g = { '오전': [], '오후': [], '저녁': [], '기타': [] };
    for (const t of dateTasks) {
      const slot = TIME_SLOTS.includes(t.timeSlot) ? t.timeSlot : '기타';
      g[slot].push(t);
    }
    for (const slot of Object.keys(g)) {
      g[slot].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    }
    return g;
  }, [dateTasks]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onAdd({ title: title.trim(), dueDate: selectedDate, timeSlot });
    setTitle("");
    setBusy(false);
  };

  const [year, month, day] = selectedDate.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
  const dateLabel = `${month}월 ${day}일 (${weekday})`;
  const isToday = selectedDate === todayStr();

  return (
    <div className="today-main">
      <div className="today-block-hdr today-main-hdr">
        <span className="today-block-title">📅 날짜별 할 일</span>
      </div>
      <div className="today-date-row">
        <div className="today-date-left">
          <h2 className="today-date-title">
            {isToday ? '오늘' : dateLabel}
            {isToday && <span className="today-date-sub">&nbsp;·&nbsp;{dateLabel}</span>}
          </h2>
          {total > 0 && (
            <span className={`today-progress ${done === total ? 'today-all-done' : ''}`}>
              {done}/{total} 완료
            </span>
          )}
        </div>
        <div className="today-day-nav">
          <button className="day-nav-arrow" onClick={() => onDateChange(shiftDate(selectedDate, -1))} title="이전 날">‹</button>
          <button className="day-nav-arrow" onClick={() => onDateChange(shiftDate(selectedDate, 1))} title="다음 날">›</button>
        </div>
      </div>

      <div className="today-slot-btns">
        {TIME_SLOTS.map(s => (
          <button key={s} type="button"
            className={`today-slot-btn ${timeSlot === s ? 'slot-active' : ''}`}
            onClick={() => setTimeSlot(s)}>
            {s}
          </button>
        ))}
      </div>

      <form className="today-add-form" onSubmit={handleAdd}>
        <input
          className="today-add-input"
          placeholder={`${timeSlot} 할 일 추가...`}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <button className="today-add-btn" type="submit" disabled={busy || !title.trim()}>
          + 추가
        </button>
      </form>

      {dateTasks.length === 0 ? (
        <div className="today-empty">
          <span>📝</span>
          <p>이 날의 할 일이 없습니다</p>
          <p className="today-empty-hint">위 입력창에서 추가하거나<br />날짜 화살표로 이동하세요.</p>
        </div>
      ) : (
        <div className="today-grouped-list">
          {[...TIME_SLOTS, '기타'].map(slot => {
            const items = grouped[slot];
            if (!items || items.length === 0) return null;
            return (
              <div key={slot} className="today-slot-group">
                <p className="today-slot-label">{slot === '기타' ? '기타' : slot}</p>
                <ul className="today-task-list">
                  {items.map(t => (
                    <li key={t.id} className={`today-task-item ${t.completed ? 'today-task-done' : ''}`}>
                      <input type="checkbox" className="today-checkbox"
                        checked={t.completed} onChange={() => onToggle(t.id, t.completed)} />
                      <span className="today-task-title">{t.title}</span>
                      <button className="th-del" onClick={() => onDelete(t.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TodayMain;
