// Place one label per run on its widest row piece (ties: closest to the run's
// middle), spanning that piece as a grid area so long names can ellipsize
// instead of overflowing a single minute cell.
// rowStarts: the first minute of each rendered row (60 minutes per row).
// groupAt(minute): the run shown at that minute, or null for no label.
export function calendarLabelPlacements(rowStarts, groupAt) {
  const widest = new Map();
  rowStarts.forEach((first, row) => {
    const last = first + 60;
    for (let start = first; start < last;) {
      const group = groupAt(start);
      if (!group) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < last && groupAt(end) === group) end++;

      const width = end - start;
      const midpoint = ((group.startMin ?? group.startMinute) + (group.endMin ?? group.endMinute)) / 2;
      const distance = Math.abs((start + end) / 2 - midpoint);
      const previous = widest.get(group);
      if (!previous || width > previous.width || width === previous.width && distance < previous.distance) {
        const rowLine = row + 2;
        const column = start - first + 2;
        widest.set(group, {
          group, width, distance, key: start,
          style: { gridRow: rowLine + ' / ' + (rowLine + 1), gridColumn: column + ' / ' + (column + width) },
        });
      }
      start = end;
    }
  });
  return [...widest.values()];
}
