import { useNotepad } from '../../features/notes/useNotepad';
import { useState } from 'react';
import { useNoteLibrary } from '../../features/notes/useNoteLibrary';
import { NotesWorkspace } from '../notes/NotesWorkspace.jsx';
import { NoteTextEditor } from '../notes/NoteTextEditor.jsx';
import { MAX_NOTE_LENGTH } from '../../features/notes/notepadStore.mjs';
import { notePlainText } from '../../features/notes/noteRichText.mjs';
import '../../styles/notes.css';

// The editor is separate from its data hook so its save states can be previewed.
export function NotepadEditor({ notepad }) {
  const {text,dirty,loading,saving,error,conflict,localError,edit,retry,resolveConflict} = notepad;
  const status = conflict ? '내용 확인 필요' : error ? '서버 저장 안 됨' : loading ? '불러오는 중…'
    : saving ? '저장 중…' : dirty ? '저장 대기 중…' : '저장됨';
  return <div className="notes-document-body">
    {error && <div className="notes-notice" role="alert">
      <span>{error.code === 'permission-denied' ? '메모를 서버에 저장하려면 Firebase에 새 메모 규칙을 적용해 주세요.' : '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'}
        {!localError && ' 입력한 내용은 이 기기에 임시 보관됩니다.'}</span>
      <button type="button" onClick={retry}>다시 연결</button>
    </div>}
    {localError && <p className="notes-notice" role="alert">이 기기에 임시 저장할 수 없습니다. 앱을 닫기 전에 서버에 저장되었는지 확인해 주세요.</p>}
    {conflict && <div className="notes-notice notes-conflict" role="alert">
      <p>다른 창에서 메모가 바뀌어 자동 저장을 멈췄습니다. 사용할 내용을 선택해 주세요.</p>
      <details><summary>다른 창의 메모 보기</summary><pre>{notePlainText(conflict.text) || '(빈 메모)'}</pre></details>
      <div><button type="button" onClick={() => resolveConflict(true)}>내 메모로 저장</button>
        <button type="button" onClick={() => {
          if (window.confirm('입력 중인 내용 대신 다른 창의 메모로 바꿀까요?')) resolveConflict(false);
        }}>다른 메모로 바꾸기</button></div>
    </div>}
    <div className="notes-paper">
      <NoteTextEditor text={text} edit={edit} loading={loading} readOnly={notepad.deleting || notepad.deleted} />
      <footer><span className={`notes-status${error || conflict ? ' has-error' : ''}`} role="status">{status}</span><span>{notePlainText(text).length.toLocaleString()} / {MAX_NOTE_LENGTH.toLocaleString()}자</span></footer>
    </div>
  </div>;
}

export function NoteDocument({ note, folders, run, library, notepad }) {
  const [titleDraft,setTitleDraft] = useState(null);
  async function saveTitle() {
    if (titleDraft === null) return;
    const title = titleDraft.trim() || '제목 없는 메모';
    if (title === note.title) { setTitleDraft(null); return; }
    const result = await run(() => library.rename(note.id,title),false);
    if (result.ok) setTitleDraft(null);
  }
  return <>
    <div className="notes-document-heading">
      <input className="notes-title-input" aria-label="메모 제목" value={titleDraft ?? note.title}
        maxLength={120} readOnly={notepad.deleting || notepad.deleted} onChange={event => setTitleDraft(event.target.value)}
        onBlur={saveTitle} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }} />
      <div className="notes-document-actions">
        <select aria-label="메모 폴더" disabled={notepad.deleting || notepad.deleted} value={folders.some(folder => folder.id === note.folderId) ? note.folderId : ''}
          onChange={event => run(() => library.move(note.id,event.target.value || null))}>
          <option value="">폴더 없음</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <button type="button" disabled={notepad.deleting || notepad.deleted} onClick={() => run(() => notepad.remove(() => library.remove(note.id)))}>
          {notepad.deleting ? '삭제 중…' : '삭제'}
        </button>
      </div>
    </div>
    <NotepadEditor notepad={notepad} />
  </>;
}

function ConnectedNoteDocument({ uid, ...props }) {
  const notepad = useNotepad(uid,props.note.id);
  return <NoteDocument {...props} notepad={notepad} />;
}

export default function NotesTab({ uid }) {
  const library = useNoteLibrary(uid);
  return <NotesWorkspace library={library} renderEditor={(note,run) =>
    <ConnectedNoteDocument uid={uid} note={note} folders={library.folders} library={library} run={run} />} />;
}
