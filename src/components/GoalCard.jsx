import { useState } from "react";
import { GOAL_COLORS } from "../features/goals/goalService";
import { periodLabel } from "../features/goals/periodLabel";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEEKS_OF_MONTH = [1, 2, 3, 4, 5];

function SubGoalForm({ onAdd, onCancel }) {
  const [type, setType] = useState("month");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [weekOfMonth, setWeekOfMonth] = useState(1);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await onAdd({
      title: title.trim(), type,
      year: Number(year), month: Number(month),
      weekOfMonth: type === "week" ? Number(weekOfMonth) : null,
    });
    setTitle(""); setSubmitting(false); onCancel();
  };

  return (
    <form className="subgoal-form" onSubmit={handleSubmit}>
      <div className="subgoal-form-row">
        <select className="form-select-sm" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="month">월 단위</option>
          <option value="week">주 단위</option>
        </select>
        <select className="form-select-sm" value={year} onChange={(e) => setYear(e.target.value)}>
          {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="form-select-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
          {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        {type === "week" && (
          <select className="form-select-sm" value={weekOfMonth} onChange={(e) => setWeekOfMonth(e.target.value)}>
            {WEEKS_OF_MONTH.map((w) => <option key={w} value={w}>{w}주</option>)}
          </select>
        )}
      </div>
      <div className="subgoal-form-row">
        <input
          className="form-input-sm"
          placeholder="세부 목표를 입력하세요"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required autoFocus
        />
        <button className="btn-subgoal-add" type="submit" disabled={submitting}>
          {submitting ? "..." : "추가"}
        </button>
        <button className="btn-subgoal-cancel" type="button" onClick={onCancel}>취소</button>
      </div>
    </form>
  );
}

function SubGoalItem({ sub, color, onToggle, onDelete }) {
  return (
    <li className={`subgoal-item ${sub.completed ? "subgoal-done" : ""}`} style={{ '--goal-color': color }}>
      <input
        type="checkbox"
        className="subgoal-checkbox"
        style={{ accentColor: color }}
        checked={sub.completed}
        onChange={() => onToggle(sub.id, sub.completed)}
      />
      <span className="subgoal-type-badge" style={{ background: color + '20', color }}>
        {sub.type === "month" ? "월" : "주"}
      </span>
      <span className="subgoal-period">{periodLabel(sub)}</span>
      <span className="subgoal-title">{sub.title}</span>
      <button className="subgoal-delete" onClick={() => onDelete(sub.id)} title="삭제">✕</button>
    </li>
  );
}

function GoalCard({ goal, subGoals, onDeleteGoal, onAddSubGoal, onDeleteSubGoal, onToggleSubGoal, onUpdateColor, onUpdateTitle }) {
  const [showForm, setShowForm]     = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [editTitle, setEditTitle]   = useState(false);
  const [titleDraft, setTitleDraft] = useState(goal.title);
  const color = goal.color || GOAL_COLORS[0];

  const commitTitle = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== goal.title) await onUpdateTitle(goal.id, trimmed);
    else setTitleDraft(goal.title);
    setEditTitle(false);
  };

  return (
    <div className="goal-card" style={{ '--goal-color': color }}>
      <div className="goal-color-bar" style={{ background: color }} />

      <div className="goal-card-header" style={{ background: `linear-gradient(to right, ${color}18, transparent 70%)` }}>
        <span className="goal-card-icon">🎯</span>

        {editTitle ? (
          <input
            className="goal-title-input"
            style={{ color, borderColor: color + '80' }}
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); commitTitle(); }
              if (e.key === 'Escape') { setTitleDraft(goal.title); setEditTitle(false); }
            }}
          />
        ) : (
          <h3
            className="goal-card-title"
            style={{ color, cursor: 'text' }}
            onDoubleClick={() => { setTitleDraft(goal.title); setEditTitle(true); }}
            title="더블클릭으로 수정"
          >{goal.title}</h3>
        )}

        <button
          className="goal-color-toggle"
          style={{ background: color }}
          onClick={() => setShowPicker((v) => !v)}
          title="색상 변경"
        />
        <button className="goal-card-delete" onClick={() => onDeleteGoal(goal.id)} title="장기 목표 삭제">삭제</button>
      </div>

      {showPicker && (
        <div className="goal-color-picker">
          {GOAL_COLORS.map((c) => (
            <button
              key={c}
              className={`goal-color-dot ${c === color ? 'gcd-active' : ''}`}
              style={{ background: c, boxShadow: c === color ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none' }}
              onClick={() => { onUpdateColor(goal.id, c); setShowPicker(false); }}
              title={c}
            />
          ))}
        </div>
      )}

      {subGoals.length > 0 ? (
        <ul className="subgoal-list">
          {[...subGoals].sort((a, b) => {
            if (a.year === b.year && a.month === b.month) {
              return (a.createdAt?.seconds ?? Infinity) - (b.createdAt?.seconds ?? Infinity);
            }
            if (a.year !== b.year) return a.year - b.year;
            return a.month - b.month;
          }).map((sub) => (
            <SubGoalItem key={sub.id} sub={sub} color={color} onToggle={onToggleSubGoal} onDelete={onDeleteSubGoal} />
          ))}
        </ul>
      ) : (
        !showForm && <p className="subgoal-empty">세부 목표를 추가해보세요.</p>
      )}

      {showForm ? (
        <SubGoalForm onAdd={(data) => onAddSubGoal(goal.id, data)} onCancel={() => setShowForm(false)} />
      ) : (
        <button className="btn-add-subgoal" style={{ '--goal-color': color }} onClick={() => setShowForm(true)}>
          + 세부 목표 추가
        </button>
      )}
    </div>
  );
}

export default GoalCard;
