export const DISPLAY_MODES = Object.freeze(['all', 'faded', 'blind', 'hidden']);

export const DEFAULT_OPPOSITE_DISPLAY = Object.freeze({
  plannerOppositeDisplay: 'faded',
  controlOppositeDisplay: 'blind',
});

export const validDisplayMode = mode => DISPLAY_MODES.includes(mode);
const storedDisplayMode = mode => mode === 'transparent' ? 'faded' : mode;

export function oppositeDisplayFromHistory(history) {
  const latestFirst = [...history].sort((a, b) =>
    (b.changedAt ?? b.createdAt?.toMillis?.() ?? 0) - (a.changedAt ?? a.createdAt?.toMillis?.() ?? 0)
    || (b.id || '').localeCompare(a.id || ''));
  const valueFor = key => storedDisplayMode(latestFirst.find(item =>
    validDisplayMode(item[key]) || item[key] === 'transparent')?.[key]) || DEFAULT_OPPOSITE_DISPLAY[key];
  return {
    plannerOppositeDisplay: valueFor('plannerOppositeDisplay'),
    controlOppositeDisplay: valueFor('controlOppositeDisplay'),
  };
}
