import { useState } from "react";
import GoalCard from "../GoalCard";
import { GOAL_COLORS } from "../../features/goals/goalService";
import { periodLabel } from "../../features/goals/periodLabel";

function getDaysRemaining(sub) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let deadline;
  if (sub.type === "month") {
    deadline = new Date(sub.year, sub.month, 0);
  } else {
    const lastDay = sub.weekOfMonth < 5
      ? sub.weekOfMonth * 7
      : new Date(sub.year, sub.month, 0).getDate();
    deadline = new Date(sub.year, sub.month - 1, lastDay);
  }
  deadline.setHours(0, 0, 0, 0);
  return Math.round((deadline - now) / 86400000);
}

function DBadge({ days }) {
  if (days < 0)   return <span className="d-badge d-overdue">D+{-days}</span>;
  if (days === 0) return <span className="d-badge d-today">D-Day</span>;
  if (days <= 3)  return <span className="d-badge d-urgent">D-{days}</span>;
  if (days <= 7)  return <span className="d-badge d-soon">D-{days}</span>;
  return                 <span className="d-badge d-future">D-{days}</span>;
}

/* ── 목표 관리 팝업 ── */
function GoalAddInline({ onAdd, count }) {
  const [title, setTitle]   = useState("");
  const [color, setColor]   = useState(GOAL_COLORS[count % GOAL_COLORS.length]);
  const [busy,  setBusy]    = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onAdd(title.trim(), color);
    setTitle("");
    setColor(GOAL_COLORS[(count + 1) % GOAL_COLORS.length]);
    setBusy(false);
  };

  return (
    <form className="goal-add-inline" onSubmit={handleSubmit}>
      <div className="goal-add-colors">
        {GOAL_COLORS.map((c) => (
          <button key={c} type="button"
            className={`goal-color-dot ${c === color ? 'gcd-active' : ''}`}
            style={{ background: c, boxShadow: c === color ? `0 0 0 2px #fff, 0 0 0 3px ${c}` : 'none' }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="goal-add-inline-row">
        <input className="form-input" placeholder="장기 목표 이름 추가"
          value={title} onChange={(e) => setTitle(e.target.value)}
          style={{ borderColor: color + '80' }} required />
        <button className="btn btn-login" type="submit" disabled={busy}
          style={{ background: color, borderColor: color, whiteSpace: 'nowrap' }}>
          {busy ? "..." : "+ 추가"}
        </button>
      </div>
    </form>
  );
}

function CompletedSectionMini({ goals, subGoals, onDelete, onToggle }) {
  const [open, setOpen] = useState(false);
  const completedSubs = subGoals.filter(s => s.completed);
  const grouped = goals.reduce((acc, goal) => {
    const items = completedSubs.filter(s => s.goalId === goal.id);
    if (items.length > 0) acc.push({ goal, items });
    return acc;
  }, []);
  if (grouped.length === 0) return null;
  return (
    <div className="completed-section">
      <button className="completed-toggle" onClick={() => setOpen(v => !v)}>
        <span>✅ 완료된 목표 <span className="completed-count">{completedSubs.length}</span></span>
        <span className="toggle-arrow">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="completed-list">
          {grouped.map(({ goal, items }) => {
            const color = goal.color || GOAL_COLORS[0];
            return (
              <div key={goal.id} className="completed-group">
                <p className="completed-goal-label" style={{ color }}>
                  <span className="completed-goal-dot" style={{ background: color }} />{goal.title}
                </p>
                <ul className="subgoal-list">
                  {items.map(sub => (
                    <li key={sub.id} className="subgoal-item subgoal-done">
                      <input type="checkbox" className="subgoal-checkbox" style={{ accentColor: color }}
                        checked onChange={() => onToggle(sub.id, sub.completed)} />
                      <span className="subgoal-type-badge" style={{ background: color + '20', color }}>
                        {sub.type === "month" ? "월" : "주"}
                      </span>
                      <span className="subgoal-period">{periodLabel(sub)}</span>
                      <span className="subgoal-title">{sub.title}</span>
                      <button className="subgoal-delete" onClick={() => onDelete(sub.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GoalPopup({ goals, subGoals, onClose, onAddGoal, onDeleteGoal, onUpdateColor, onUpdateTitle, onAddSubGoal, onDeleteSubGoal, onToggleSubGoal }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-ttl">🎯 목표 관리</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-bdy">
          <GoalAddInline onAdd={onAddGoal} count={goals.length} />
          {goals.length === 0 ? (
            <p className="today-block-empty" style={{ padding: '24px 0' }}>목표를 추가해보세요</p>
          ) : (
            <div className="modal-goal-list">
              {goals.map(goal => (
                <GoalCard key={goal.id} goal={goal}
                  subGoals={subGoals.filter(s => s.goalId === goal.id && !s.completed)}
                  onDeleteGoal={onDeleteGoal} onUpdateColor={onUpdateColor}
                  onUpdateTitle={onUpdateTitle} onAddSubGoal={onAddSubGoal}
                  onDeleteSubGoal={onDeleteSubGoal} onToggleSubGoal={onToggleSubGoal}
                />
              ))}
            </div>
          )}
          <CompletedSectionMini goals={goals} subGoals={subGoals}
            onDelete={onDeleteSubGoal} onToggle={onToggleSubGoal} />
        </div>
      </div>
    </div>
  );
}

/* ── 오른쪽 사이드바 블록 ── */
function DeadlineGoalsBlock({ goals, subGoals, onManage }) {
  const goalMap = Object.fromEntries(goals.map(g => [g.id, g]));
  const sorted = subGoals
    .filter(s => !s.completed)
    .map(s => ({ ...s, daysLeft: getDaysRemaining(s) }))
    .sort((a, b) => {
      if (a.year === b.year && a.month === b.month) {
        return (a.createdAt?.seconds ?? Infinity) - (b.createdAt?.seconds ?? Infinity);
      }
      return a.daysLeft - b.daysLeft;
    })
    .slice(0, 8);
  const groups = [
    { label: '월간', items: sorted.filter(sub => sub.type === 'month') },
    { label: '주간', items: sorted.filter(sub => sub.type !== 'month') },
  ].filter(group => group.items.length > 0);

  return (
    <div className="today-block">
      <div className="today-block-hdr">
        <span className="today-block-title">⏰ 월별 목표</span>
        <button className="block-manage-btn" onClick={onManage}>관리</button>
      </div>
      {sorted.length === 0 ? (
        <p className="today-block-empty">세부 목표가 없습니다</p>
      ) : (
        <div className="goal-period-groups">
          {groups.map(group => (
            <section key={group.label} className="goal-period-group">
              <h3 className="goal-period-label">{group.label} <span>{group.items.length}</span></h3>
              <ul className="sidebar-list">
                {group.items.map(sub => {
                  const goal = goalMap[sub.goalId];
                  const color = goal?.color || GOAL_COLORS[0];
                  return (
                    <li key={sub.id} className="sidebar-item">
                      <span className="sidebar-goal-dot" style={{ background: color }} />
                      <DBadge days={sub.daysLeft} />
                      <div className="sidebar-item-body">
                        <p className="sidebar-sub-title">{sub.title}</p>
                        <p className="sidebar-meta" style={{ color }}>{goal?.title ?? "—"} · {periodLabel(sub)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export { GoalPopup, DeadlineGoalsBlock };
