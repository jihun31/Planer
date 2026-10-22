import { useState } from "react";
import GoalCard from "../GoalCard";
import { GOAL_COLORS } from "../../features/goals/goalService";
import { periodLabel } from "../../features/goals/periodLabel";
import { todayStr } from "../../features/habits/habitService";

function AddGoalForm({ onAdd, goalsCount }) {
  const [title, setTitle]         = useState("");
  const [color, setColor]         = useState(GOAL_COLORS[goalsCount % GOAL_COLORS.length]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await onAdd(title.trim(), color);
    setTitle("");
    setColor(GOAL_COLORS[(goalsCount + 1) % GOAL_COLORS.length]);
    setSubmitting(false);
  };

  return (
    <form className="goal-tab-form-card" onSubmit={handleSubmit}>
      <p className="form-section-label">🎯 목표 추가</p>
      <div className="goal-add-colors">
        {GOAL_COLORS.map((c) => (
          <button
            key={c} type="button"
            className={`goal-color-dot ${c === color ? 'gcd-active' : ''}`}
            style={{ background: c, boxShadow: c === color ? `0 0 0 2px #fff, 0 0 0 3px ${c}` : 'none' }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="goal-tab-form-row">
        <input
          className="form-input"
          placeholder="장기 목표 이름 (예: 기타, 영어 공부, 운동)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ borderColor: color + '80' }}
          required
        />
        <button className="btn btn-login" type="submit" disabled={submitting}
          style={{ background: color, borderColor: color, whiteSpace: 'nowrap' }}>
          {submitting ? "..." : "+ 추가"}
        </button>
      </div>
    </form>
  );
}

function AddTaskForm({ onAdd }) {
  const [title, setTitle]         = useState("");
  const [dueDate, setDueDate]     = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await onAdd({ title: title.trim(), dueDate: dueDate || null });
    setTitle(""); setDueDate("");
    setSubmitting(false);
  };

  return (
    <form className="goal-tab-form-card" onSubmit={handleSubmit}>
      <p className="form-section-label">✅ 할 일 추가</p>
      <div className="goal-tab-form-row">
        <input className="form-input" placeholder="할 일 제목"
          value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className="form-input-date" type="date"
          value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={todayStr()} />
        <button className="btn btn-login" type="submit" disabled={submitting || !title.trim()}
          style={{ whiteSpace: 'nowrap' }}>
          {submitting ? "..." : "+ 추가"}
        </button>
      </div>
    </form>
  );
}

function CompletedSection({ goals, subGoals, onDeleteSubGoal, onToggleSubGoal }) {
  const [open, setOpen] = useState(false);
  const completedSubs = subGoals.filter((s) => s.completed);
  const grouped = goals.reduce((acc, goal) => {
    const items = completedSubs.filter((s) => s.goalId === goal.id);
    if (items.length > 0) acc.push({ goal, items });
    return acc;
  }, []);

  if (grouped.length === 0) return null;

  return (
    <div className="completed-section">
      <button className="completed-toggle" onClick={() => setOpen((v) => !v)}>
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
                  <span className="completed-goal-dot" style={{ background: color }} />
                  {goal.title}
                </p>
                <ul className="subgoal-list">
                  {items.map((sub) => (
                    <li key={sub.id} className="subgoal-item subgoal-done">
                      <input type="checkbox" className="subgoal-checkbox"
                        style={{ accentColor: color }} checked
                        onChange={() => onToggleSubGoal(sub.id, sub.completed)} />
                      <span className="subgoal-type-badge" style={{ background: color + '20', color }}>
                        {sub.type === "month" ? "월" : "주"}
                      </span>
                      <span className="subgoal-period">{periodLabel(sub)}</span>
                      <span className="subgoal-title">{sub.title}</span>
                      <button className="subgoal-delete" onClick={() => onDeleteSubGoal(sub.id)}>✕</button>
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

function GoalTab({ goals, subGoals, loading, addGoal, deleteGoal, updateGoalColor, updateGoalTitle, addSubGoal, deleteSubGoal, toggleSubGoal, addTask }) {
  if (loading) return <p className="loading-text">불러오는 중...</p>;

  return (
    <div className="goal-tab-page">
      <div className="goal-tab-forms">
        <AddGoalForm onAdd={addGoal} goalsCount={goals.length} />
        <AddTaskForm onAdd={addTask} />
      </div>

      {goals.length === 0 ? (
        <div className="goals-empty-state">
          <span className="empty-big-icon">🎯</span>
          <p className="empty-main">장기 목표를 추가해보세요</p>
          <p className="empty-sub">
            기타, 운동, 영어 공부 등 꾸준히 이어갈 큰 목표를 등록하고<br />
            그 안에 월/주 단위 세부 목표를 채워나가세요.
          </p>
        </div>
      ) : (
        <div className="goal-cards-grid">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              subGoals={subGoals.filter((s) => s.goalId === goal.id && !s.completed)}
              onDeleteGoal={deleteGoal}
              onUpdateColor={updateGoalColor}
              onUpdateTitle={updateGoalTitle}
              onAddSubGoal={addSubGoal}
              onDeleteSubGoal={deleteSubGoal}
              onToggleSubGoal={toggleSubGoal}
            />
          ))}
        </div>
      )}

      <CompletedSection
        goals={goals} subGoals={subGoals}
        onDeleteSubGoal={deleteSubGoal} onToggleSubGoal={toggleSubGoal}
      />
    </div>
  );
}

export default GoalTab;
