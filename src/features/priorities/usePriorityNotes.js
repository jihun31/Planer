import { useCollection } from '../../lib/useCollection';
import {
  subscribePriorityNotes, addPriorityNote, updatePriorityNote,
  deletePriorityNote, movePriorityNote,
} from './priorityService';

export const usePriorityNotes = uid => {
  const [notes, ready, error] = useCollection(uid, subscribePriorityNotes);
  return {
    notes,
    loading: !ready,
    error,
    addNote: text => addPriorityNote(uid, text),
    updateNote: (id, text) => updatePriorityNote(uid, id, text),
    deleteNote: id => deletePriorityNote(uid, id),
    moveNote: (id, direction) => movePriorityNote(uid, id, direction),
  };
};
