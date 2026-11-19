// Replaces src/features/todos/todoService.js in the memo/todo DOM test.
export const updates = globalThis.todoUpdates = [];
export const updateTodo = async (id, data) => {
  updates.push({id, ...data});
  await new Promise(resolve => setTimeout(resolve, 30));
  if (globalThis.failTodoUpdate) throw new Error('offline');
  globalThis.applyTodoUpdate?.(id, data);
};
