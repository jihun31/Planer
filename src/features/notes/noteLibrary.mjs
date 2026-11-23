export const ALL_NOTES = 'all';
export const MAX_FOLDER_DEPTH = 3;
const updatedTime = note => note.updatedAt?.toMillis?.() ?? note.createdAt?.toMillis?.() ?? 0;
const bySiblingOrder = (a,b) => {
  const order = item => Number.isFinite(item.sortOrder) ? item.sortOrder : Infinity;
  return order(a)-order(b) || a.name.localeCompare(b.name,'ko') || a.id.localeCompare(b.id);
};

// Folders without parentId, or whose parent no longer exists, are top-level.
export function folderParentId(folders,folder) {
  const parentId = typeof folder?.parentId === 'string' ? folder.parentId : null;
  return parentId && parentId !== folder.id && folders.some(item => item.id === parentId) ? parentId : null;
}

// Depth-first rows. A corrupted parent cycle is shown at the top level instead of disappearing.
export function folderTree(folders) {
  const children = new Map();
  for (const folder of folders) {
    const parentId = folderParentId(folders,folder);
    if (!children.has(parentId)) children.set(parentId,[]);
    children.get(parentId).push(folder);
  }
  for (const list of children.values()) list.sort(bySiblingOrder);
  const rows = [], seen = new Set();
  const visit = (folder,depth,parentId) => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    const kids = (children.get(folder.id) || []).filter(item => !seen.has(item.id));
    rows.push({folder,depth,parentId,hasChildren:kids.length > 0});
    kids.forEach(item => visit(item,depth+1,folder.id));
  };
  (children.get(null) || []).forEach(item => visit(item,1,null));
  [...folders].sort(bySiblingOrder).forEach(item => visit(item,1,null));
  return rows;
}

export const sortedNoteFolders = folders => folderTree(folders).map(row => row.folder);

export function folderDescendantIds(folders,id) {
  const rows = folderTree(folders), start = rows.findIndex(row => row.folder.id === id);
  if (start < 0) return [];
  const ids = [];
  for (let index = start+1;index < rows.length && rows[index].depth > rows[start].depth;index++) ids.push(rows[index].folder.id);
  return ids;
}

const subtreeHeight = (rows,id) => {
  const start = rows.findIndex(row => row.folder.id === id);
  let height = 1;
  for (let index = start+1;index < rows.length && rows[index].depth > rows[start].depth;index++)
    height = Math.max(height,rows[index].depth-rows[start].depth+1);
  return height;
};

// position: 'before' | 'after' | 'inside'. Returns the new parent and that parent's ordered child ids, or null when not allowed.
export function folderMove(folders,id,targetId,position) {
  const rows = folderTree(folders), source = rows.find(row => row.folder.id === id), target = rows.find(row => row.folder.id === targetId);
  if (!source || !target || id === targetId || folderDescendantIds(folders,id).includes(targetId)) return null;
  const parentId = position === 'inside' ? targetId : target.parentId;
  const parentDepth = position === 'inside' ? target.depth : target.depth-1;
  if (parentDepth + subtreeHeight(rows,id) > MAX_FOLDER_DEPTH) return null;
  const ids = rows.filter(row => row.parentId === parentId && row.folder.id !== id).map(row => row.folder.id);
  if (position === 'inside') ids.push(id);
  else ids.splice(ids.indexOf(targetId) + (position === 'after' ? 1 : 0),0,id);
  const siblings = rows.filter(row => row.parentId === parentId).map(row => row.folder.id);
  if (source.parentId === parentId && ids.every((item,index) => item === siblings[index])) return null;
  return {id,parentId,ids};
}

// Applies a pending move so the tree can update before the cloud confirms it.
export function foldersWithMove(folders,move) {
  if (!move) return folders;
  return folders.map(folder => {
    const index = move.ids.indexOf(folder.id);
    if (index < 0) return folder;
    return {...folder,sortOrder:index,...(folder.id === move.id ? {parentId:move.parentId} : {})};
  });
}

export function visibleNotes(notes,folder,search = '') {
  const needle = search.trim().toLocaleLowerCase();
  return notes.filter(note => {
    if (note.archived) return false;
    if (needle && !note.title.toLocaleLowerCase().includes(needle)) return false;
    return folder === ALL_NOTES || note.folderId === folder;
  }).sort((a,b) => updatedTime(b)-updatedTime(a) || a.id.localeCompare(b.id));
}
