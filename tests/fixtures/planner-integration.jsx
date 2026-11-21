import React, { useState } from 'react';
import TaskReminder from '../../src/components/planner/TaskReminder.jsx';
import TodayMain from '../../src/components/today/TodayMain.jsx';
import {createRoot} from 'react-dom/client';
import PlannerTab from '../../src/components/tabs/PlannerTab.jsx';
import '../../src/styles/app.css';
const history=[{effectiveDate:'1000-01-01',startHour:8,endHour:3}];
const reminderDate = '2026-11-22';
const reminderTasks = [
  { id: 'evening', title: '저녁 강의 요약과 복습 문제 풀기', timeSlot: '저녁' },
  { id: 'late-morning', title: '수업 자료 정리 및 빠진 부분 확인', timeSlot: '오전', createdAtMs: 2 },
  { id: 'morning', title: '영어 듣기', timeSlot: '오전', createdAtMs: 1 },
  { id: 'afternoon', title: '리포트 읽고 수정 부분 표시하기', timeSlot: '오후' },
  { id: 'early', title: '어제 할 일', timeSlot: '오전', dueDate: '2026-11-21' },
  { id: 'finished', title: '이미 완료한 할 일', timeSlot: '오전', completed: true },
  { id: 'no-slot', title: '시간대 없는 예전 할 일' },
].map(task => ({ dueDate: reminderDate, completed: false, ...task }));

export function ReminderPreview() {
  const [tasks, setTasks] = useState(reminderTasks);
  const toggleTask = async (id, completed) => {
    if (window.failReminderWrite) throw new Error('저장 실패');
    setTasks(items => items.map(item => item.id === id ? { ...item, completed: !completed } : item));
  };
  return <section id="reminder-preview">
    <div id="reminder-width"><TaskReminder tasks={tasks} onToggle={toggleTask} /></div>
    <TodayMain tasks={tasks} selectedDate={reminderDate} onToggle={toggleTask} />
  </section>;
}

const BrowserDate = Date;
let nextReminderBoundary;
window.setReminderClock = (day, hour, minute, runBoundary = false) => {
  const now = new BrowserDate(2026, 10, day, hour, minute);
  window.Date = class extends BrowserDate {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  };
  const realTimeout = window.setTimeout;
  let delay;
  window.setTimeout = (callback, ms) => {
    nextReminderBoundary = callback;
    delay = ms;
  };
  try {
    if (runBoundary) nextReminderBoundary();
    else window.dispatchEvent(new Event('focus'));
  } finally {
    window.Date = BrowserDate;
    window.setTimeout = realTimeout;
  }
  return delay;
};
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1280,margin:'24px auto'}}>
  <section id="study"><PlannerTab uid="preview-study" scheduleHistory={history} settingsReady active={false}/></section>
  <section id="control" style={{marginTop:30}}><PlannerTab uid="preview-control" scheduleHistory={history} settingsReady control active={false}/></section>
  <ReminderPreview />
</main>);
