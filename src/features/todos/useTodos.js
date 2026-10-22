import { useCollection } from "../../lib/useCollection";
import { subscribeTodos, addTodo, deleteTodo } from "./todoService";

export const useTodos = (uid) => {
  const [todos, ready, error] = useCollection(uid, subscribeTodos);
  return {
    error: error,
    todos,
    loading: !ready,
    addTodo: (data) => addTodo(uid, data),
    deleteTodo,
  };
};
