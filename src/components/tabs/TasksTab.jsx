import { useState } from "react";
import { todayStr } from "../../features/habits/habitService";
import { GoalPopup, DeadlineGoalsBlock } from "../today/GoalsPanel";
import { TaskPopup, AllTasksBlock } from "../today/TasksPanel";
import PriorityNotesBlock from "../today/PriorityNotesBlock";
import TodayMain from "../today/TodayMain";
import DayPlanBlock from '../today/DayPlanBlock';

/* ── 탭 루트 ── */
function TodayTab({ uid, tasks: tasksData, todos: todosData, goalsData, priorityData, scheduleHistory, settingsReady, settingsError }) {
  const { tasks, addTask, toggleTask, deleteTask } = tasksData;
  const { todos, addTodo, deleteTodo } = todosData;
  const { goals = [], subGoals = [], addGoal, deleteGoal, updateGoalColor, updateGoalTitle, addSubGoal, deleteSubGoal, toggleSubGoal } = goalsData;

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [goalPopup,    setGoalPopup]    = useState(false);
  const [taskPopup,    setTaskPopup]    = useState(false);

  return (
    <div className="today-layout">
      <TodayMain
        tasks={tasks} selectedDate={selectedDate}
        onAdd={addTask} onToggle={toggleTask} onDelete={deleteTask}
        onDateChange={setSelectedDate}
      />

      <div className="today-middle">
        <AllTasksBlock tasks={todos} onDelete={deleteTodo} onManage={() => setTaskPopup(true)} />
      </div>

      <div className="today-right">
        <PriorityNotesBlock data={priorityData} />
        <DeadlineGoalsBlock goals={goals} subGoals={subGoals} onManage={() => setGoalPopup(true)} />
      </div>

      <DayPlanBlock uid={uid} date={selectedDate} onDateChange={setSelectedDate} scheduleHistory={scheduleHistory} settingsReady={settingsReady} settingsError={settingsError} />

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
