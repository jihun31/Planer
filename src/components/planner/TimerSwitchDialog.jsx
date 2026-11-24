import { useEffect, useRef } from 'react';
import { fmtElapsed } from './plannerDisplay.mjs';

const badgeColor = color => /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : '#6366f1';

// 타이머를 정지한 뒤 다음 할 일을 고르는 창. 배지를 누르면 그 활동으로 전환하고, 종료를 누르면 닫는다.
// rest가 있으면(기록 타이머 + 작업 종료 시 휴식 연결) 아래 버튼 줄 오른쪽에 "휴식 시작 (N분)"을 주 버튼으로 두고 포커스한다.
// 배지 목록의 "휴식" 활동(시간을 정하지 않은 일반 휴식)과는 별개다.
// groups: [{ view: 'planner' | 'control', label, activities: [{ id, name, color }] }], rest: { minutes, returnActivityId } | null
export default function TimerSwitchDialog({ finished, groups, rest, onPick, onRest, onClose }) {
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
    <h2 id="timer-switch-title">{shown.length || !rest ? '다음 활동' : '휴식할까요?'}</h2>
    {finished && <p className="timer-switch-finished">
      <span className="timer-switch-dot" style={{ background: badgeColor(finished.color) }} aria-hidden="true" />
      {finished.name} {fmtElapsed(finished.seconds)} 기록
    </p>}
    {rest && <p className="timer-switch-rest-note">일한 시간에 맞춰 {rest.minutes}분 쉴 수 있어요.</p>}
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
      <button type="button" className={rest ? undefined : 'study-gap-primary'} data-switch-focus={rest ? undefined : ''}
        onClick={onClose}>종료</button>
      {rest && <button type="button" className="study-gap-primary timer-switch-rest" data-switch-focus
        onClick={() => onRest(rest)}>휴식 시작 ({rest.minutes}분)</button>}
    </div>
  </dialog>;
}
