const commands = {제목:'h3',인용:'quote',체크리스트:'checklist',체크박스:'checklist',할일:'checklist',todo:'checklist',checklist:'checklist',숫자목록:'numbered',번호목록:'numbered',numbered:'numbered',number:'numbered'};

export function noteSlashShortcut(editor,selection,afterSpace = false) {
  if (!selection?.isCollapsed || !selection.rangeCount) return null;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.commonAncestorContainer)) return null;
  let line = caret.startContainer.nodeType === 1 ? caret.startContainer : caret.startContainer.parentElement;
  if (line?.closest('.notes-toggle-title,[contenteditable="false"]')) return null;
  while (line && line !== editor && !['DIV','P','H1','H2','H3','BLOCKQUOTE','LI'].includes(line.nodeName)) line = line.parentElement;
  const range = caret.cloneRange();
  range.selectNodeContents(line || editor);range.setEnd(caret.startContainer,caret.startOffset);
  const prefix=range.toString();
  if (afterSpace && !prefix.endsWith(' ')) return null;
  const command=(afterSpace ? prefix.slice(0,-1) : prefix).match(/^\/([^\s/]+)$/)?.[1];
  return commands[command] ? {type:commands[command],range} : null;
}
