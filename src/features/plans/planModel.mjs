import { calendarToday, formatCalendarDate, isCalendarDate } from '../calendar/calendarDates.mjs';

export { calendarToday as planToday };
export const WEEKDAYS=[{value:1,label:'월'},{value:2,label:'화'},{value:3,label:'수'},{value:4,label:'목'},
  {value:5,label:'금'},{value:6,label:'토'},{value:0,label:'일'}];
export const weekdayFor=date=>new Date(`${date}T12:00:00`).getDay();
export function shiftPlanDate(date,days) {
  const value=new Date(`${date}T12:00:00`);value.setDate(value.getDate()+days);return formatCalendarDate(value);
}
export const planDateWindow=date=>[-1,0,1].map(offset=>shiftPlanDate(date,offset)).filter(isCalendarDate);
export const overrideId=(date,routineId)=>`${date}_${routineId}`;
export function planTime(minute) {
  const day=Math.floor(minute/1440),clock=minute%1440;
  return `${day ? '다음날 ' : ''}${String(Math.floor(clock/60)).padStart(2,'0')}:${String(clock%60).padStart(2,'0')}`;
}
export function minuteFromTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('시간을 확인해 주세요.');
  const [hours,minutes]=value.split(':').map(Number);return hours*60+minutes;
}
export function planInput(data) {
  const title=typeof data.title === 'string' ? data.title.trim() : '';
  if (!title || title.length>120) throw new Error('활동명은 1~120자로 입력해 주세요.');
  const {startMinute,endMinute}=data;
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute<0 || startMinute>=2880
    || endMinute<=startMinute || endMinute>startMinute+1440 || endMinute>2880) throw new Error('시간표에서 24시간 이내의 구간을 선택해 주세요.');
  const metadata={};
  if(data.activityId!=null){
    if(typeof data.activityId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.activityId))throw new Error('활동을 확인해 주세요.');
    metadata.activityId=data.activityId;
  }
  if(data.activityColor!=null){
    if(typeof data.activityColor!=='string'||!/^#[0-9a-fA-F]{6}$/.test(data.activityColor))throw new Error('활동 색상을 확인해 주세요.');
    metadata.activityColor=data.activityColor;
  }
  return {title,startMinute,endMinute,...metadata};
}
export function routineInput(data) {
  const input=planInput(data);
  if (!isCalendarDate(data.effectiveDate)) throw new Error('적용 날짜를 확인해 주세요.');
  if (!Array.isArray(data.weekdays) || !data.weekdays.length || data.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6))
    throw new Error('반복할 요일을 하나 이상 선택해 주세요.');
  return {...input,weekdays:[...new Set(data.weekdays)].sort((a,b)=>a-b),effectiveDate:data.effectiveDate,
    deleted:data.deleted === true || data.removed === true,...(data.removed === true ? {removed:true} : {})};
}
export function entryInput(data) {
  if (!isCalendarDate(data.date)) throw new Error('날짜를 확인해 주세요.');
  const routineId=data.routineId ?? null;
  if (routineId !== null && (typeof routineId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(routineId))) throw new Error('반복 루틴을 확인해 주세요.');
  if (data.skipped && !routineId) throw new Error('반복 루틴만 이번 날짜에서 제외할 수 있습니다.');
  return {...planInput(data),date:data.date,routineId,skipped:data.skipped === true};
}
function latestVersions(versions,date=null) {
  const latest=new Map();
  for (const version of versions) {
    if (date && version.effectiveDate>date) continue;
    const previous=latest.get(version.routineId);
    // Removal is terminal for this ID, including edits from another stale window.
    if (!previous || (!previous.removed && (version.removed || version.revision>previous.revision))) latest.set(version.routineId,version);
  }
  return [...latest.values()];
}
export const routineCatalog=versions=>latestVersions(versions).filter(routine=>!routine.removed).sort((a,b)=>a.startMinute-b.startMinute || a.title.localeCompare(b.title,'ko'));
export function plansForDate(versions,entries,date) {
  const day=weekdayFor(date),plans=new Map();
  const current=latestVersions(versions,date),removed=new Set(current.filter(routine=>routine.removed).map(routine=>routine.routineId));
  for (const routine of current) if (!routine.deleted && !routine.removed && routine.weekdays.includes(day))
    plans.set(routine.routineId,{...routine,date,entryId:null,source:'routine',key:`routine:${routine.routineId}:${date}`});
  for (const entry of entries) if (entry.date === date) {
    if(entry.routineId && removed.has(entry.routineId))continue;
    const key=entry.routineId || `single:${entry.id}`;
    const original=plans.get(key);
    plans.set(key,{...original,...entry,entryId:entry.id,source:entry.routineId ? 'exception' : 'single',key:`entry:${entry.id}`});
  }
  return [...plans.values()].sort((a,b)=>a.startMinute-b.startMinute || a.endMinute-b.endMinute || a.title.localeCompare(b.title,'ko'));
}
const dateNumber=date=>Date.parse(`${date}T00:00:00Z`)/86400000;
export function overlappingPlanKeys(versions,entries,date) {
  const rows=planDateWindow(date).flatMap(day=>plansForDate(versions,entries,day)).filter(plan=>!plan.skipped);
  const overlaps=new Set();
  for (let i=0;i<rows.length;i++) for (let j=i+1;j<rows.length;j++) {
    const a=rows[i],b=rows[j],startA=dateNumber(a.date)*1440+a.startMinute,startB=dateNumber(b.date)*1440+b.startMinute;
    if (startA<dateNumber(b.date)*1440+b.endMinute && startB<dateNumber(a.date)*1440+a.endMinute) {
      overlaps.add(a.key);overlaps.add(b.key);
    }
  }
  return overlaps;
}
