import { useState } from "react";
import { todayStr } from "../../features/habits/habitService";
import { GoalPopup, DeadlineGoalsBlock } from "../today/GoalsPanel";
import { TaskPopup, AllTasksBlock } from "../today/TasksPanel";
import PriorityBar from "../today/PriorityBar";
import TodayMain from "../today/TodayMain";
import DayPlanBlock from '../today/DayPlanBlock';
import TodayHabitsBlock from '../today/TodayHabitsBlock';

/* ── 탭 루트 ── */
function TodayTab({ uid, tasks: tasksData, todos: todosData, goalsData, priorityData, habitsData, onOpenHabits, scheduleHistory, settingsReady, settingsError }) {
  const { tasks, addTask, toggleTask, deleteTask } = tasksData;
  const { todos, addTodo, deleteTodo } = todosData;
  const { goals = [], subGoals = [], addGoal, deleteGoal, updateGoalColor, updateGoalTitle, addSubGoal, deleteSubGoal, toggleSubGoal } = goalsData;

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [goalPopup,    setGoalPopup]    = useState(false);
  const [taskPopup,    setTaskPopup]    = useState(false);

  return (
    <div className="today-page">
      <PriorityBar data={priorityData} />

      <div className="today-layout">
        {/* 하루 계획: 날짜별 할 일과 계획표가 같은 날짜를 쓴다 */}
        <section className="today-plan-card" aria-label="하루 계획">
          <TodayMain
            tasks={tasks} selectedDate={selectedDate}
            onAdd={addTask} onToggle={toggleTask} onDelete={deleteTask}
            onDateChange={setSelectedDate}
          />
          <DayPlanBlock uid={uid} date={selectedDate} onDateChange={setSelectedDate} embedded
            scheduleHistory={scheduleHistory} settingsReady={settingsReady} settingsError={settingsError} />
        </section>

        <div className="today-side">
          {habitsData && <TodayHabitsBlock habitsData={habitsData} onOpen={onOpenHabits} />}
          <AllTasksBlock tasks={todos} onDelete={deleteTodo} onManage={() => setTaskPopup(true)} />
          <DeadlineGoalsBlock goals={goals} subGoals={subGoals} withinDays={14} onManage={() => setGoalPopup(true)} />
        </div>
      </div>

      {goalPopup && (
        <GoalPopup
          goals={goals} subGoals={subGoals}
          onClose={() => setGoalPopup(false)}
          onAddGoal={addGoal} onDeleteGoal={deleteGoal}
          onUpdateColor={updateGoalColor} onUpdateTitle={updateGoalTitle}
          onAddSubGoal={addSubGoal} onDeleteSubGoal={deleteSubGoal}
          onToggleSubGoal={toggleSubGoal}
        />
      )}

      {taskPopup && (
        <TaskPopup
          tasks={todos}
          onClose={() => setTaskPopup(false)}
          onAdd={addTodo} onDelete={deleteTodo}
        />
      )}
    </div>
  );
}

export default TodayTab;
