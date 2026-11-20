import { useEffect, useRef } from 'react';
import { fmtElapsed } from './plannerDisplay.mjs';

const badgeColor = color => /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : '#6366f1';

// 타이머를 정지한 뒤 다음 활동을 고르는 창. 배지를 누르면 그 활동으로 전환하고, 종료를 누르면 닫는다.
// groups: [{ view: 'planner' | 'control', label, activities: [{ id, name, color }] }]
export default function TimerSwitchDialog({ finished, groups, onPick, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node.open) node.showModal();
    node.querySelector('[data-switch-focus]')?.focus();
    return () => node.close();
  }, []);
  const shown = groups.filter(group => group.activities.length);
  return <dialog ref={dialog} className="study-gap-dialog timer-switch-dialog" aria-labelledby="timer-switch-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="timer-switch-title">다음 활동</h2>
    {finished && <p className="timer-switch-finished">
      <span className="timer-switch-dot" style={{ background: badgeColor(finished.color) }} aria-hidden="true" />
      {finished.name} {fmtElapsed(finished.seconds)} 기록
    </p>}
    {shown.map(group => <section key={group.view} className="timer-switch-group">
      <h3>{group.label}</h3>
      <div className="act-chips" role="group" aria-label={`${group.label} 활동`}>
        {group.activities.map(activity => <button type="button" key={activity.id}
          className="act-chip planer-rest-badge" style={{ '--rest-badge-color': badgeColor(activity.color) }}
          onClick={() => onPick(group.view, activity.id)}>
          <span className="act-chip-dot" aria-hidden="true" />
          <span>{activity.name}</span>
        </button>)}
      </div>
    </section>)}
    <div className="study-gap-actions">
      <button type="button" className="study-gap-primary" data-switch-focus onClick={onClose}>종료</button>
    </div>
  </dialog>;
}
