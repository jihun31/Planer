// Keep equality queries within Firestore's 30-disjunction limit.
// Existing YYYY-MM-DD fields work without a data migration.
export function monthDates(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return Array.from({ length: new Date(year, month + 1, 0).getDate() },
    (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);
}

export function selectedDateOutsideMonth(year, month, date) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  return date && !date.startsWith(prefix) ? date : '';
}

// watchDates is injected so subscription cleanup and merging can be tested
// without touching the user's database.
export function subscribeDateGroups(dates, watchDates, onData, onError) {
  const uniqueDates = [...new Set(dates)];
  const groups = [];
  for (let i = 0; i < uniqueDates.length; i += 30) groups.push(uniqueDates.slice(i, i + 30));
  let active = true;
  const results = new Map();
  const stops = [];
  const stop = () => {
    active = false;
    stops.forEach(unsubscribe => unsubscribe());
  };
  const fail = error => {
    if (!active) return;
    stop();
    onError(error);
  };
  if (!groups.length) onData([]);
  groups.forEach((group, index) => {
    if (!active) return;
    try {
      const unsubscribe = watchDates(group, rows => {
        if (!active) return;
        results.set(index, rows);
        if (results.size !== groups.length) return;
        const byId = new Map();
        for (const items of results.values()) for (const row of items) byId.set(row.id, row);
        onData([...byId.values()]);
      }, fail);
      if (active) stops.push(unsubscribe);
      else unsubscribe();
    } catch (error) {
      fail(error);
    }
  });
  return stop;
}
