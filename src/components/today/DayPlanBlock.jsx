import { useEffect, useId, useRef, useState } from 'react';
import { useDayPlans } from '../../features/plans/useDayPlans';
import { useCollection } from '../../lib/useCollection';
import { subscribeActivities } from '../../features/planner/plannerService';
import { rangeForDate } from '../../features/planner/scheduleTime.mjs';
import { planActivity } from '../../features/plans/planTimetable.mjs';
import { WEEKDAYS, overrideId, planInput, planTime, planToday, shiftPlanDate, weekdayFor } from '../../features/plans/planModel.mjs';
import { isCalendarDate } from '../../features/calendar/calendarDates.mjs';
import DayPlanGrid from './DayPlanGrid';
import '../../styles/planner.css';
import '../../styles/day-plans.css';

const shortDate=date=>`${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일`;
const daysLabel=days=>WEEKDAYS.filter(day=>days?.includes(day.value)).map(day=>day.label).join('·');
const clockTime=minute=>planTime(minute%1440);
const defaults=date=>({title:'',activityId:null,activityColor:null,scope:'date',weekdays:[weekdayFor(date)]});

export function DayPlanBlock({date,onDateChange,data,activities=[],allActivities=activities,range,settingsReady=true,settingsError=null,activitiesReady=true,activitiesError=null}) {
  const [form,setForm]=useState(()=>defaults(date)),[editing,setEditing]=useState(null);
  const [selection,setSelection]=useState(null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  const lock=useRef(false),currentDate=useRef(date),scopeId=useId();
  currentDate.current=date;
  const unavailable=data.loading || !!data.error || busy || !settingsReady || !activitiesReady || !!activitiesError;
  const active=data.plans.filter(plan=>!plan.skipped).map(plan=>planActivity(plan,allActivities)),skipped=data.plans.filter(plan=>plan.skipped).map(plan=>planActivity(plan,allActivities));
  const routines=data.routines.map(routine=>planActivity(routine,allActivities));
  const effectiveDate=date<planToday() ? planToday() : date;
  const previousDate=shiftPlanDate(date,-1),nextDate=shiftPlanDate(date,1);
  useEffect(()=>{setEditing(null);setForm(defaults(date));setSelection(null);setFailure('');},[date]);
  const change=(key,value)=>setForm(previous=>({...previous,[key]:value}));
  const reset=()=>{setEditing(null);setForm(defaults(currentDate.current));setSelection(null);setFailure('');};
  function edit(plan,scope='date') {
    if (unavailable) return;
    setEditing(plan);setFailure('');
    setSelection({startMinute:plan.startMinute,endMinute:plan.endMinute,editingKey:plan.key,pending:false});
    const display=planActivity(plan,allActivities);
    setForm({title:display.title,activityId:plan.activityId||null,activityColor:display.color,
      scope,weekdays:plan.weekdays || data.routines.find(routine=>routine.routineId===plan.routineId)?.weekdays || [weekdayFor(date)]});
  }
  async function run(task,after) {
    if (lock.current || unavailable) return;
    const actionDate=date;lock.current=true;setBusy(true);setFailure('');
    try {await task();if (currentDate.current===actionDate) after?.();}
    catch(error) {if (currentDate.current===actionDate) setFailure(error.code==='permission-denied'
      ? '계획을 저장할 권한이 없습니다. 계정 연결을 확인해 주세요.' : error.message || '저장하지 못했습니다. 연결 상태를 확인해 주세요.');}
    finally {lock.current=false;setBusy(false);}
  }
  function save(activity=null) {
    if(!selection){setFailure('시간표에서 계획할 칸을 선택해 주세요.');return;}
    let input;
    const linked=activity||activities.find(item=>item.id===form.activityId);
    if(form.activityId&&!activity&&!linked&&!editing){setFailure('활동 목록이 변경됐습니다. 활동을 다시 선택해 주세요.');return;}
    try {input=planInput({title:linked?.name||form.title,activityId:linked?.id||form.activityId,
      activityColor:linked?.color||form.activityColor,startMinute:selection.startMinute,endMinute:selection.endMinute});}
    catch(error) {setFailure(error.message);return;}
    const overlaps=active.some(plan=>plan.key!==editing?.key
      && !(editing?.routineId&&plan.routineId===editing.routineId)
      && input.startMinute<plan.endMinute&&plan.startMinute<input.endMinute);
    if(overlaps){setFailure('선택한 시간대에 이미 계획이 있습니다. 빈 시간대를 선택해 주세요.');return;}
    if (form.scope==='weekly' && !form.weekdays.length) {setFailure('반복할 요일을 하나 이상 선택해 주세요.');return;}
    if (form.scope==='weekly') {
      const clearEntryId=editing?.source==='single' ? editing.entryId
        : editing?.source==='exception' ? overrideId(date,editing.routineId) : null;
      void run(()=>data.saveRoutine({...input,weekdays:form.weekdays,effectiveDate,deleted:false},
        {routineId:editing?.routineId || null,clearEntryId}),reset);
    } else void run(()=>data.saveEntry({...input,date,routineId:editing?.routineId || null,skipped:false},
      editing?.source==='single' ? editing.entryId : null),reset);
  }
  function submit(event) {event.preventDefault();save();}
  function remove(plan) {
    if (plan.routineId) void run(()=>data.saveEntry({...plan,date,routineId:plan.routineId,skipped:true}),reset);
    else void run(()=>data.removeEntry(plan.entryId),reset);
  }
  function updateRoutine(routine,remove=false) {
    void run(()=>data.saveRoutine({...routine,effectiveDate,deleted:remove||!routine.deleted,
      ...(remove?{removed:true}:{})},{routineId:routine.routineId}),reset);
  }
  return <section className="day-plan-block" aria-labelledby={`${scopeId}-heading`}>
    <div className="day-plan-heading">
      <div><h2 id={`${scopeId}-heading`}>계획표</h2><p>시작 칸과 끝 칸을 선택하고 활동을 등록하세요. 채워진 칸을 누르면 수정할 수 있습니다.</p></div>
      <div className="day-plan-date"><input type="date" aria-label="계획 날짜" value={date} min="1000-01-01" max="9999-12-31" disabled={busy}
        onChange={event=>{if(isCalendarDate(event.target.value))onDateChange(event.target.value);}} /><span>{daysLabel([weekdayFor(date)])}요일</span>
        <div className="day-plan-date-nav">
          <button type="button" aria-label="계획표 이전 날짜" title="이전 날짜" disabled={busy||!isCalendarDate(previousDate)} onClick={()=>onDateChange(previousDate)}>{'<'}</button>
          <button type="button" aria-label="계획표 다음 날짜" title="다음 날짜" disabled={busy||!isCalendarDate(nextDate)} onClick={()=>onDateChange(nextDate)}>{'>'}</button>
        </div>
      </div>
    </div>
    {data.error && <div className="day-plan-error" role="alert">계획을 불러오지 못했습니다. 연결 상태와 계정 접근 권한을 확인해 주세요.
      <button type="button" onClick={data.retry}>다시 연결</button></div>}
    {(!settingsReady||!activitiesReady)&&<p className="day-plan-empty" role="status">시간 관리 설정을 불러오는 중…</p>}
    {(settingsError||activitiesError)&&<p className="day-plan-error" role="alert">시간 관리 설정을 불러오지 못했습니다. {settingsError?'시간 범위는 기본 설정으로 표시합니다.':''}
      {activitiesError&&<button type="button" onClick={data.retry}>다시 연결</button>}</p>}
    <form className="day-plan-form" onSubmit={submit}>
      <fieldset disabled={unavailable} className="day-plan-toolbar">
    {activitiesReady&&!activitiesError&&<div className="day-plan-activities" aria-label="계획 활동">{activities.length?activities.map(activity=><button key={activity.id} type="button" disabled={unavailable}
      style={{color:activity.color,background:activity.color+'20',borderColor:activity.color+'80'}}
      aria-pressed={form.activityId===activity.id}
      onClick={()=>{if(selection)save(activity);else setForm(previous=>({...previous,title:activity.name,activityId:activity.id,activityColor:activity.color}));}}
      title="칸을 선택한 뒤 누르면 바로 등록됩니다">{activity.name}</button>):<span>시간 관리 탭에서 활동을 추가해 주세요.</span>}</div>}
        <div className="day-plan-controls">
          {selection&&<span className="day-plan-selection" aria-live="polite"><strong>{clockTime(selection.startMinute)} ~ {clockTime(selection.endMinute)}</strong><span>{selection.endMinute-selection.startMinute}분</span></span>}
          {editing&&!form.activityId&&<span className="day-plan-editing-name">{form.title}</span>}
          <div className="day-plan-scope" role="radiogroup" aria-label="적용 범위">
            <label><input type="radio" name={scopeId} value="date" checked={form.scope==='date'} onChange={()=>change('scope','date')} />이번 날짜만</label>
            <label><input type="radio" name={scopeId} value="weekly" checked={form.scope==='weekly'} onChange={()=>change('scope','weekly')} />매주 반복</label>
          </div>
          <div className="day-plan-form-actions">{(editing||selection) && <button type="button" onClick={reset}>선택 취소</button>}
            <button type="submit" className="day-plan-primary" disabled={!form.title.trim()||!selection}>{busy ? '저장 중…' : editing ? '변경 저장' : '계획 등록'}</button></div>
        {form.scope==='weekly' && <div className="day-plan-repeat">
          <div className="day-plan-weekdays" role="group" aria-label="반복 요일">{WEEKDAYS.map(day=><label key={day.value} className={form.weekdays.includes(day.value)?'is-selected':''}>
            <input type="checkbox" aria-label={`${day.label}요일 반복`} checked={form.weekdays.includes(day.value)} onChange={()=>change('weekdays',form.weekdays.includes(day.value)
              ? form.weekdays.filter(value=>value!==day.value) : [...form.weekdays,day.value])} /><span>{day.label}</span></label>)}</div>
          <span className="day-plan-effective" title="이전 날짜의 계획은 유지됩니다.">{shortDate(effectiveDate)}부터</span>
        </div>}
        </div>
      </fieldset>
      {failure && <p className="day-plan-error" role="alert">{failure}</p>}
    </form>
    <div onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.stopPropagation();reset();}}}>
      <DayPlanGrid key={date} plans={active} selection={selection} onSelect={setSelection} onEdit={edit} onRemove={remove} disabled={unavailable} range={range}/>
    </div>
    {skipped.length>0 && <details className="day-plan-skipped"><summary>이번 날짜에서 제외한 루틴 {skipped.length}개</summary>{skipped.map(plan=><div key={plan.key}>
      <span>{clockTime(plan.startMinute)} · {plan.title}</span><button type="button" disabled={unavailable} onClick={()=>void run(()=>data.removeEntry(plan.entryId),reset)}>되돌리기</button>
    </div>)}</details>}
    <details className="day-plan-routines">
      <summary>반복 루틴 관리 <span>{routines.length}개</span></summary>
      <p className="day-plan-routine-help">변경은 {shortDate(effectiveDate)}부터 적용되며, 이전 날짜의 계획은 유지됩니다.</p>
      {data.loading?<p className="day-plan-empty" role="status">반복 루틴을 불러오는 중…</p>
        :!data.error&&!routines.length&&<p className="day-plan-empty">등록된 반복 루틴이 없습니다. 계획을 등록할 때 ‘매주 반복’을 선택해 주세요.</p>}
      {routines.map(routine=><div className="day-plan-routine" key={routine.routineId}>
        <div className="day-plan-routine-info">
          <strong style={{color:routine.color}}>{routine.title}</strong>
          <span>{daysLabel(routine.weekdays)} · {planTime(routine.startMinute)} ~ {planTime(routine.endMinute)}</span>
          <span>{routine.deleted?'중단됨':'반복 중'}{routine.effectiveDate>date?` · ${shortDate(routine.effectiveDate)}부터`:''}</span>
        </div>
        <div className="day-plan-routine-actions">
          <button type="button" disabled={unavailable} aria-label={`${routine.title} 반복 수정`} onClick={()=>edit(routine,'weekly')}>수정</button>
          <button type="button" disabled={unavailable} aria-label={`${routine.title} 반복 ${routine.deleted?'재개':'중단'}`} onClick={()=>updateRoutine(routine)}>{routine.deleted?'재개':'중단'}</button>
          <button type="button" disabled={unavailable} className="day-plan-delete" aria-label={`${routine.title} 반복 삭제`} onClick={()=>updateRoutine(routine,true)}>삭제</button>
        </div>
      </div>)}
    </details>
  </section>;
}
export default function ConnectedDayPlanBlock({uid,date,onDateChange,scheduleHistory=[],settingsReady=true,settingsError=null}) {
  const data=useDayPlans(uid,date);
  const [listenActivities,setListenActivities]=useState(()=>subscribeActivities);
  const [allActivities,activitiesReady,activitiesError]=useCollection(uid,listenActivities);
  const retry=()=>{data.retry();setListenActivities(()=>(...args)=>subscribeActivities(...args));};
  return <DayPlanBlock date={date} onDateChange={onDateChange} data={{...data,retry}} activities={allActivities.filter(activity=>!activity.archived)} allActivities={allActivities}
    range={rangeForDate(scheduleHistory,date)} settingsReady={settingsReady} settingsError={settingsError} activitiesReady={activitiesReady} activitiesError={activitiesError}/>;
}
