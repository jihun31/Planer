// Consume the same filtered, overlap-merged activity time as the learning charts.
export function buildPersonalRecords({ days, weeks, weekActivities, today }) {
  const months = new Map(), totals = new Map(), growth = [];
  let totalMinutes = 0;
  for (const [date, day] of Object.entries(days).sort(([a],[b]) => a.localeCompare(b))) {
    if (day.achieved) months.set(date.slice(0,7), (months.get(date.slice(0,7)) || 0) + 1);
    totalMinutes += day.minutes;
    growth.push({date,minutes:totalMinutes});
  }
  const bestMonth = [...months].map(([month,count]) => ({month,days:count}))
    .sort((a,b) => b.days-a.days || b.month.localeCompare(a.month))[0] ?? null;
  const bestWeek = Object.entries(weeks).map(([week,minutes]) => ({week,minutes}))
    .sort((a,b) => b.minutes-a.minutes || b.week.localeCompare(a.week))[0] ?? null;
  for (const {activities} of [...weekActivities].sort((a,b) => a.week.localeCompare(b.week))) {
    for (const {days:activityDays,minutes,...info} of activities) {
      const total = totals.get(info.key) || {totalMinutes:0,lastDate:''};
      Object.assign(total,info);
      total.totalMinutes += minutes;
      total.lastDate = activityDays.reduce((latest,day) => day.date > latest ? day.date : latest,total.lastDate);
      totals.set(info.key,total);
    }
  }
  return {
    bestMonth, bestWeek,
    topActivity:[...totals.values()].sort((a,b) => b.totalMinutes-a.totalMinutes
      || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name,'ko'))[0] ?? null,
    growth, totalMinutes, today,
  };
}
