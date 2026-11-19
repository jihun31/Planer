import { useEffect, useRef } from 'react';
import { useEditableCopy } from '../features/copy/useEditableCopy';
import { UI_COPY } from '../features/copy/uiCopy.mjs';
import { allViews } from '../features/navigation/appTabs.mjs';

// 가이드 문구(uiCopy.mjs의 `${id}Title`)가 있는 화면만 탭 순서대로 보여 준다.
const GUIDE_VIEWS = allViews().map(view => view.id).filter(id => `${id}Title` in UI_COPY.guide);

export default function HelpDialog({ onClose }) {
  const dialogRef = useRef(null);
  const copy = useEditableCopy('guide');
  const close = () => {if (copy.canClose()) dialogRef.current?.close();};

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  return <dialog ref={dialogRef} className="help-dialog" onClose={onClose}
    onCancel={event => {event.preventDefault();close();}}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="help-dialog-heading">
      <h2>{copy.field('title')}</h2>
      {copy.actions}
      <button type="button" className="help-dialog-close" aria-label="닫기"
        onClick={close} disabled={copy.busy}>×</button>
    </div>
    {copy.status}
    <section className="help-section">
      <h3>{copy.field('guideHeading')}</h3>
      <dl className="help-guide-list">
        {GUIDE_VIEWS.map(key => <div key={key}><dt>{copy.field(`${key}Title`)}</dt><dd>{copy.field(key)}</dd></div>)}
      </dl>
    </section>
    <section className="help-section">
      <h3>{copy.field('shortcutsHeading')}</h3>
      <dl className="help-guide-list">
        <div><dt><kbd>{copy.field('tabKeys')}</kbd></dt><dd>{copy.field('tabAction')}</dd></div>
        <div><dt><kbd>{copy.field('arrowKeys')}</kbd></dt><dd>{copy.field('arrowAction')}</dd></div>
      </dl>
      {(copy.editing || copy.value('shortcutsNote')) && <p className="help-dialog-note">{copy.field('shortcutsNote')}</p>}
    </section>
    <section className="help-section">
      <h3>{copy.field('settingsHeading')}</h3>
      <p className="help-settings-copy">{copy.field('settings')}</p>
    </section>
  </dialog>;
}
