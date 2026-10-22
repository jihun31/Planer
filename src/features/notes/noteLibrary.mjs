export const ALL_NOTES = 'all';
const updatedTime = note => note.updatedAt?.toMillis?.() ?? note.createdAt?.toMillis?.() ?? 0;

export function sortedNoteFolders(folders) {
  const order = item => Number.isFinite(item.sortOrder) ? item.sortOrder : Infinity;
  return [...folders].sort((a,b) => order(a)-order(b) || a.name.localeCompare(b.name,'ko') || a.id.localeCompare(b.id));
}

export function movedFolderIds(folders,id,targetId,after) {
  const ids = folders.map(item => item.id);
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids;
  const next = ids.filter(item => item !== id);
  next.splice(next.indexOf(targetId) + (after ? 1 : 0),0,id);
  return next;
}

export function visibleNotes(notes,folder,search = '') {
  const needle = search.trim().toLocaleLowerCase();
  return notes.filter(note => {
    if (note.archived) return false;
    if (needle && !note.title.toLocaleLowerCase().includes(needle)) return false;
    return folder === ALL_NOTES || note.folderId === folder;
  }).sort((a,b) => updatedTime(b)-updatedTime(a) || a.id.localeCompare(b.id));
}
