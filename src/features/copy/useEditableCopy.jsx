import { useEffect, useRef, useState } from 'react';
import CopyField from '../../components/CopyField';
import { UI_COPY, copyEdits, copyValues } from './uiCopy.mjs';
import { readUiCopy, saveUiCopy } from './uiTextService';

export function useEditableCopy(section) {
  const [values,setValues] = useState(UI_COPY[section]);
  const [draft,setDraft] = useState(null);
  const [ready,setReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [path,setPath] = useState('');
  const [saved,setSaved] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    readUiCopy().then(result => {
      if (!active) return;
      setValues(copyValues(section,result.data));setPath(result.path);setReady(true);
    }).catch(error => {if (active) setError(error.message);});
    return () => {active = false;};
  },[section]);
  const editing = draft !== null;
  const dirty = editing && Object.keys(values).some(key => draft[key] !== values[key]);
  async function save() {
    if (saving.current) return;
    saving.current = true;setBusy(true);setError('');
    try {
      const result = await saveUiCopy(section,copyEdits(section,draft));
      setValues({...draft});setPath(result.path);setDraft(null);setSaved(true);
    } catch (error) {setError(error.message);}
    finally {saving.current = false;setBusy(false);}
  }
  function cancel() {
    if (saving.current || (dirty && !window.confirm('저장하지 않은 문구 수정을 취소할까요?'))) return;
    setDraft(null);setError('');
  }
  function canClose() {
    return !saving.current && (!dirty || window.confirm('수정한 문구를 저장하지 않고 닫을까요?'));
  }
  const field = key => <CopyField name={UI_COPY[section][key]} value={(draft || values)[key]} editing={editing && !busy}
    onChange={text => setDraft(previous => ({...previous,[key]:text}))} />;
  return {field,editing,busy,canClose,
    actions:<div className="copy-edit-actions">{editing ? <>
      <button type="button" disabled={busy} onClick={cancel}>취소</button>
      <button type="button" className="copy-edit-button is-active" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
    </> : <button type="button" className="copy-edit-button" aria-label="수정" title="수정" disabled={!ready} onClick={() => {setDraft({...values});setSaved(false);setError('');}}><span aria-hidden="true">✎</span></button>}</div>,
    status:<>{(editing || saved) && <div className="copy-edit-notice">
      <p>{editing ? '문구를 눌러 직접 수정하세요. 저장하면 이 기기에 적용됩니다.' : '수정 문구를 로컬 파일에 저장했습니다.'}</p>
      <p className="copy-file-path">{path}</p>
      {!editing && window.electronAPI?.showUiTextFile && <button type="button" onClick={async () => {
        const result = await window.electronAPI.showUiTextFile();
        if (!result.ok) setError('저장된 파일을 찾지 못했습니다.');
      }}>파일 위치 열기</button>}
    </div>}{error && <p className="copy-edit-error" role="alert">{error}</p>}</>,
    value:key => (draft || values)[key],
  };
}
