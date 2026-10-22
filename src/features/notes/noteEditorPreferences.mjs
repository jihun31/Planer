import { noteColor, NOTE_TEXT_COLORS } from './noteRichText.mjs';

const COLOR_KEY = 'planer:notes:last-text-color';

export function recentNoteColor(storage) {
  try {return noteColor((storage ?? globalThis.localStorage)?.getItem(COLOR_KEY)) || NOTE_TEXT_COLORS[0].value;}
  catch {return NOTE_TEXT_COLORS[0].value;}
}

export function rememberNoteColor(color,storage) {
  const valid = noteColor(color);
  if (!valid) return;
  try {(storage ?? globalThis.localStorage)?.setItem(COLOR_KEY,valid);}
  catch { /* Formatting still works when local preferences cannot be saved. */ }
}
