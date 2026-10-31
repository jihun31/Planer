import { blockMinutes, plannerDate } from '../planner/scheduleTime.mjs';
import { isStudyBlock } from '../planner/blockKind.mjs';
import { blockActivity } from '../planner/activityHistory.mjs';
import { buildPersonalRecords } from './personalRecords.mjs';

export function dateShift(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function weekStart(date) {
  return dateShift(date, -((new Date(`${date}T12:00:00`).getDay()+6)%7));
}
export const validGoal = minutes => Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440;
export const WEEKLY_HOUR_BADGES = Object.freeze([5,10,20,30,40,50,60,70]);
export const STREAK_DAY_BADGES = Object.freeze([3,7,14,30,60,100,200,365]);
const goalChangedAt = goal => Number.isFinite(goal.changedAt)
  ? goal.changedAt : goal.createdAt?.toMillis?.() ?? 0;
const orderedGoals = history => history.filter(g => validGoal(g.minutes) && /^\d{4}-\d{2}-\d{2}$/.test(g.effectiveDate))
    .sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate)
      || goalChangedAt(a) - goalChangedAt(b)
      || (a.id || '').localeCompare(b.id || ''));
export function goalForDate(history, date) {
  const ordered = orderedGoals(history);
  // The first goal also classifies existing study records. Later revisions only
  // take effect on their scheduled dates, preserving already classified days.
  return ordered.filter(g => g.effectiveDate <= date).at(-1) ?? ordered[0] ?? null;
}
export const validActivityTargets = (ids, targets) => Array.isArray(ids) && ids.length <= 100
  && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
  && new Set(ids).size === ids.length
  && targets && typeof targets === 'object' && !Array.isArray(targets)
  && Object.entries(targets).every(([id, minutes]) => ids.includes(id) && validGoal(minutes));
export function activitySelectionForDate(history, date) {
  const configured = orderedGoals(history).filter(g => validActivityTargets(g.includedActivityIds, g.activityTargets));
  return configured.filter(g => g.effectiveDate <= date).at(-1) ?? configured[0] ?? null;
}
export function latestGoalConfiguration(history) {
  return history.filter(g => validGoal(g.minutes) && /^\d{4}-\d{2}-\d{2}$/.test(g.effectiveDate)
    && validActivityTargets(g.includedActivityIds,g.activityTargets))
    .sort((a,b) => goalChangedAt(a) - goalChangedAt(b)
      || a.effectiveDate.localeCompare(b.effectiveDate)
      || (a.id || '').localeCompare(b.id || '')).at(-1) ?? null;
}
export function editorGoalConfiguration(history, lastSavedGoal) {
  const latest = latestGoalConfiguration(history);
  return lastSavedGoal && goalChangedAt(lastSavedGoal) >= goalChangedAt(latest || {})
    ? lastSavedGoal : latest;
}
export function withRecentGoal(history, recentGoal, uid) {
  return recentGoal?.uid === uid && !history.some(goal => goal.id === recentGoal.id)
    ? [...history,recentGoal] : history;
}
export function goalEffectiveDate(history, today) {
  return history.length ? dateShift(weekStart(today), 7) : today;
}
function unionMinutes(ranges) {
  let minutes = 0, previousEnd = -Infinity;
  for (const [start,end] of ranges.sort((a,b) => a[0]-b[0])) {
    minutes += Math.max(0,end-Math.max(start,previousEnd));
    previousEnd = Math.max(previousEnd,end);
  }
  return minutes;
}
export function learningStats(blocks, history, now = new Date(), activities = []) {
  const today = plannerDate(now);
  const intervals = {}, activityIntervals = {}, selections = new Map(), weekActivityRanges = new Map();
  const activityMap = Object.fromEntries(activities.map(activity => [activity.id,activity]));
  for (const block of blocks) {
    if (!isStudyBlock(block) || !/^\d{4}-\d{2}-\d{2}$/.test(block.date) || block.date > today) continue;
    const { startMin, endMin } = blockMinutes(block);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue;
    // Saved future time is not earned yet. The planner day runs from 05:00 to 05:00.
    const elapsed = Math.floor((new Date(now).getTime() - new Date(`${block.date}T08:00:00`).getTime())/60000);
    const start = Math.max(-180, startMin);
    const end = Math.min(1260, endMin, elapsed);
    if (end > start && block.date === today && block.activityId)
      (activityIntervals[block.activityId] ??= []).push([start,end]);
    if (!selections.has(block.date)) selections.set(block.date,activitySelectionForDate(history,block.date));
    const selection = selections.get(block.date);
    if (block.activityId) {
      if (selection && !selection.includedActivityIds.includes(block.activityId)) continue;
    } else if (block.learningIncluded === false || (selection && block.learningIncluded !== true)) continue;
    if (end > start) {
      (intervals[block.date] ??= []).push([start,end]);
      const week = weekStart(block.date);
      const info = blockActivity(block,activityMap);
      if (!weekActivityRanges.has(week)) weekActivityRanges.set(week,new Map());
      const weekEntries = weekActivityRanges.get(week);
      if (!weekEntries.has(info.key)) weekEntries.set(info.key,{...info,dates:new Map()});
      const entry = weekEntries.get(info.key);
      if (!entry.dates.has(block.date)) entry.dates.set(block.date,[]);
      entry.dates.get(block.date).push([start,end]);
    }
  }
  const weekActivities = [...weekActivityRanges].map(([week,entries]) => ({week,
    activities:[...entries.values()].map(({dates,...info}) => {
      const days = [...dates].map(([date,ranges]) => ({date,minutes:unionMinutes(ranges)}));
      return {...info,days,minutes:days.reduce((sum,day) => sum+day.minutes,0)};
    }).sort((a,b) => b.minutes-a.minutes || a.name.localeCompare(b.name,'ko')),
  }));
  const weekTopActivities = Object.fromEntries(weekActivities.map(({week,activities}) => [week,
    activities.slice(0,3).map(({days:_days,...info}) => info),
  ]));
  const days = {}, weeks = {}, latestWeeklyAwards = {}, qualified = [];
  for (const date of Object.keys(intervals).sort()) {
    const minutes = unionMinutes(intervals[date]);
    const goal = goalForDate(history,date);
    const achieved = !!goal && minutes >= goal.minutes;
    days[date] = { minutes, achieved, goal: goal?.minutes ?? null };
    const week = weekStart(date);
    const previousMinutes = weeks[week] || 0;
    weeks[week] = previousMinutes + minutes;
    for (const hours of WEEKLY_HOUR_BADGES) {
      if (previousMinutes < hours*60 && weeks[week] >= hours*60) latestWeeklyAwards[hours] = date;
    }
    if (achieved) qualified.push(date);
  }
  let bestStreak = 0, run = 0, previous = null;
  const streakAwards = {}, latestStreakAwards = {}, currentWeekStreakEvents = {};
  const currentWeek = weekStart(today);
  for (const date of qualified) {
    run = previous && dateShift(previous,1) === date ? run+1 : 1;
    bestStreak = Math.max(bestStreak,run);
    streakAwards[run] ??= date;
    latestStreakAwards[run] = date;
    if (date >= currentWeek && STREAK_DAY_BADGES.includes(run)) currentWeekStreakEvents[run] = date;
    previous = date;
  }
  let streak = 0;
  let cursor = days[today]?.achieved ? today : dateShift(today,-1);
  while (days[cursor]?.achieved) { streak++; cursor = dateShift(cursor,-1); }
  const badges = [
    ...WEEKLY_HOUR_BADGES.map(hours => ({
      id: `week-${hours}`, type: 'week', target: hours*60, label: `주 ${hours}시간`,
      earnedDate: Object.keys(weeks).sort().find(w => weeks[w] >= hours*60),
      lastEarnedDate: latestWeeklyAwards[hours],
      progress: weeks[currentWeek] || 0,
    })),
    ...STREAK_DAY_BADGES.map(count => ({
      id: `streak-${count}`, type: 'streak', target: count, label: `${count}일 연속`,
      earnedDate: streakAwards[count], lastEarnedDate: latestStreakAwards[count], progress: streak,
    })),
  ];
  // Surface one best milestone per family. Earlier unlocks count as a repeat
  // when the same weekly target or streak milestone is reached again.
  const weekHighlight = badges.filter(b => b.type === 'week' && b.progress >= b.target).at(-1);
  const streakHighlight = badges.filter(b => b.type === 'streak' && currentWeekStreakEvents[b.target]).at(-1);
  const weekHighlights = [weekHighlight,streakHighlight].filter(Boolean).map(b => {
    const next = badges.find(candidate => candidate.type === b.type && candidate.target > b.target);
    return { ...b, remaining: next ? Math.max(0,next.target-b.progress) : null,
      repeated: b.type === 'week' ? b.earnedDate !== currentWeek
        : b.earnedDate !== currentWeekStreakEvents[b.target],
    };
  });
  return { today, days, weeks, weekTopActivities, streak, bestStreak, badges, goal: goalForDate(history,today),
    todayMinutes: days[today]?.minutes || 0, weekMinutes: weeks[currentWeek] || 0,
    activityMinutes: Object.fromEntries(Object.entries(activityIntervals).map(([id,ranges]) => [id,unionMinutes(ranges)])),
    qualifiedCount: qualified.length, weekHighlights,
    personalRecords:buildPersonalRecords({days,weeks,weekActivities,today}) };
}
export function duration(minutes) {
  const value = Math.floor(minutes);
  return value >= 60 ? `${Math.floor(value/60)}시간${value%60 ? ` ${value%60}분` : ''}` : `${value}분`;
}
