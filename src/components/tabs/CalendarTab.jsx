import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCalendar } from '../../features/calendar/useCalendar';
import PlannerCalendar from '../planner/PlannerCalendar';
import { hasVisibleModal, isEditingTarget } from '../../features/navigation/keyboardShortcuts.mjs';
import {
  calendarToday, calendarDateLabel, shiftCalendarMonth, isCalendarDate, eventInput, EVENT_COLORS,
} from '../../features/calendar/calendarDates.mjs';
import '../../styles/planner.css';
import '../../styles/calendar.css';

function EventDialog({ event, date, onSave, onDelete, onClose }) {
  const dialog = useRef(null);
  const titleInput = useRef(null);
  const submitting = useRef(false);
  const [title, setTitle] = useState(event?.title ?? '');
  const eventDate = event?.date ?? date;
  const [note, setNote] = useState(event?.note ?? '');
  const color = event?.color ?? EVENT_COLORS[0];
  const [addToTasks, setAddToTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
    titleInput.current.focus();
  }, []);

  const save = async e => {
    e.preventDefault();
    if (submitting.current) return;
    let input;
    try { input = eventInput({ title, date: eventDate, note, color }); }
    catch (error) { setFailure(error.message); return; }
    submitting.current = true;
    setBusy(true); setFailure('');
    try { await onSave(input, addToTasks); }
    catch { setFailure('저장하지 못했습니다. 연결 상태와 계정 접근 권한을 확인한 뒤 다시 시도해 주세요.'); }
    finally { submitting.current = false; setBusy(false); }
  };

  const remove = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setFailure('');
    try { await onDelete(); }
    catch { setFailure('일정을 삭제하지 못했습니다. 연결 상태와 계정 접근 권한을 확인해 주세요.'); }
    finally { submitting.current = false; setBusy(false); }
  };

  return <dialog ref={dialog} className="event-dialog" aria-labelledby="event-dialog-title"
    onCancel={e => { e.preventDefault(); if (!submitting.current) onClose(); }}>
    <div className="event-dialog-heading">
      <h2 id="event-dialog-title">{event ? '일정 수정' : '새 일정'}</h2>
      <button type="button" className="calendar-icon-button" aria-label="닫기" onClick={onClose} disabled={busy}>×</button>
    </div>
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <label>제목<input ref={titleInput} required maxLength={120} value={title}
          placeholder="어떤 일정인가요?" onChange={e => setTitle(e.target.value)} /></label>
        <label><span>메모 <span className="calendar-muted">선택</span></span><textarea rows={4} maxLength={5000}
          value={note} placeholder="기억할 내용을 적어 두세요." onChange={e => setNote(e.target.value)} /></label>
        {!event && <div className="event-task-option">
          <label><input type="checkbox" checked={addToTasks} onChange={e => setAddToTasks(e.target.checked)} />할 일 등록</label>
          <p>‘할 일’ 블록에 추가하고, 선택한 날짜를 마감일로 지정합니다.<br />등록 후 일정과 할 일은 각각 수정·삭제할 수 있습니다.</p>
        </div>}
        {event?.taskId && <p className="calendar-muted">할 일에도 등록한 일정입니다. 수정 내용은 캘린더에만 반영됩니다.</p>}
      </fieldset>
      {failure && <p className="calendar-error" role="alert">{failure}</p>}
      <div className="event-dialog-footer">
        {event && <button type="button" className="calendar-button calendar-danger" disabled={busy}
          onClick={remove}>일정 삭제</button>}
        <div className="event-dialog-actions">
          <button type="button" className="calendar-button" onClick={onClose} disabled={busy}>취소</button>
          <button type="submit" className="calendar-button calendar-primary" disabled={busy || !title.trim()}>
            {busy ? '저장 중…' : event ? '변경 저장' : '일정 등록'}
          </button>
        </div>
      </div>
    </form>
  </dialog>;
}

function DayEventsDialog({ date, events, onEdit, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { if (!dialog.current.open) dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="event-dialog" aria-labelledby="day-events-title"
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="event-dialog-heading">
      <h2 id="day-events-title">{calendarDateLabel(date)} 일정</h2>
      <button type="button" className="calendar-icon-button" aria-label="닫기" onClick={onClose}>×</button>
    </div>
    <div className="calendar-day-events-list">
      {events.map(event => <button type="button" key={event.id} className="calendar-event-chip"
        onClick={() => onEdit(event)}>{event.title}</button>)}
    </div>
  </dialog>;
}

export default function CalendarTab({ uid, active }) {
  const [selectedDate, setSelectedDate] = useState(calendarToday);
  const [today, setToday] = useState(calendarToday);
  const [editor, setEditor] = useState(null);
  const [dayList, setDayList] = useState(null);
  const month = selectedDate.slice(0, 7);
  const calendar = useCalendar(uid, month);
  const [year, monthNumber] = month.split('-').map(Number);
  const changeMonth = useCallback(delta => {
    setSelectedDate(current => {
      const currentMonth = current.slice(0, 7);
      if ((currentMonth === '1000-01' && delta < 0) || (currentMonth === '9999-12' && delta > 0)) return current;
      return shiftCalendarMonth(current, delta);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey
        || event.shiftKey || isEditingTarget(event.target) || hasVisibleModal()) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      changeMonth(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, changeMonth]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => setToday(calendarToday());
    refresh();
    const interval = window.setInterval(refresh, 30000);
    return () => window.clearInterval(interval);
  }, [active]);

  const byDate = useMemo(() => {
    const grouped = new Map();
    const sorted = [...calendar.events].sort((a, b) =>
      (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0) || a.id.localeCompare(b.id));
    for (const event of sorted) {
      if (!grouped.has(event.date)) grouped.set(event.date, []);
      grouped.get(event.date).push(event);
    }
    return grouped;
  }, [calendar.events]);
  const monthCount = calendar.events.filter(event => event.date.startsWith(month)).length;
  const selectDate = date => setSelectedDate(date);
  const openEditor = (event, date) => { selectDate(date); setEditor({ event, date }); };
  const save = async (input, addToTasks) => {
    if (editor.event) await calendar.update(editor.event.id, input);
    else await calendar.add(input, addToTasks);
    setSelectedDate(input.date);
    setEditor(null);
  };
  const remove = async () => {
    await calendar.remove(editor.event.id);
    setEditor(null);
  };

  return <section className="calendar-workspace" aria-label="일정 캘린더">
    <header className="calendar-toolbar">
      <div><p className="calendar-eyebrow">나의 일정</p><h1>{year}년 {monthNumber}월</h1>
        <p className="calendar-muted calendar-subtitle">
          <span className="calendar-summary" role="status">{!calendar.ready ? '불러오는 중…' : calendar.error ? '일정 조회 실패' : `이번 달 일정 ${monthCount}개`}</span>
          <span>날짜를 눌러 일정 추가</span>
        </p></div>
      <div className="calendar-month-nav">
          <button type="button" className="calendar-icon-button" aria-label="이전 달"
            disabled={month === '1000-01'} onClick={() => changeMonth(-1)}>‹</button>
          <button type="button" className="calendar-icon-button" aria-label="다음 달"
            disabled={month === '9999-12'} onClick={() => changeMonth(1)}>›</button>
      </div>
    </header>
    {calendar.error && <div className="calendar-error" role="alert">일정을 불러오지 못했습니다. 인터넷 연결과 캘린더 데이터 접근 권한을 확인해 주세요.
      <button type="button" className="calendar-button" onClick={calendar.retry}>다시 시도</button></div>}
    <div className="calendar-layout">
      <div className="calendar-sheet" aria-busy={!calendar.ready}>
        <div className="calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(label => <span key={label}>{label}</span>)}</div>
        <div className="calendar-month-grid">
          {calendar.dates.map(date => {
            const events = byDate.get(date) ?? [];
            const outside = !date.startsWith(month);
            return <div key={date}
              className={`calendar-cell${outside ? ' calendar-outside' : ''}`}>
              <button type="button" className="calendar-date-button"
                disabled={!calendar.ready || !!calendar.error || !isCalendarDate(date)}
                aria-label={`${date}, 일정 ${events.length}개, 일정 추가`}
                aria-current={date === today ? 'date' : undefined} onClick={() => openEditor(null, date)}>
                <span className={`calendar-day-number${date === today ? ' calendar-today' : ''}`}>{Number(date.slice(-2))}</span>
              </button>
              <div className="calendar-cell-events">{events.slice(0, 3).map(event =>
                <button type="button" key={event.id} className="calendar-event-chip"
                  title={event.note ? `${event.title}\n${event.note}` : event.title}
                  aria-label={`${event.title} 수정`} onClick={() => openEditor(event, date)}>{event.title}</button>)}
                {events.length > 3 && <button type="button" className="calendar-more"
                  title="일정 모두 보기" aria-label={`${date} 일정 ${events.length}개 모두 보기`} onClick={() => setDayList(date)}>+{events.length - 3}</button>}
              </div>
            </div>;
          })}
        </div>
      </div>
      <aside className="calendar-mini" aria-label="작은 일정 달력">
        <PlannerCalendar year={year} month={monthNumber - 1} selectedDate=""
          blocks={calendar.events} oppositeBlocks={[]} oppositeActivities={[]} oppositeMode="hidden"
          todayDate={today} minimumWeeks={5} onSelectDate={selectDate} onMonthChange={changeMonth} />
      </aside>
    </div>
    {dayList && <DayEventsDialog date={dayList} events={byDate.get(dayList) ?? []}
      onEdit={event => { setDayList(null); openEditor(event, dayList); }} onClose={() => setDayList(null)} />}
    {editor && <EventDialog event={editor.event} date={editor.date} onSave={save} onDelete={remove} onClose={() => setEditor(null)} />}
  </section>;
}
