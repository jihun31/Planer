import { useCallback, useMemo, useState } from 'react';
import { useCollection } from '../../lib/useCollection';
import { monthGrid } from './calendarDates.mjs';
import { subscribeCalendarEvents, addCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from './calendarService';

export function useCalendar(uid, month) {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ dates: monthGrid(month, 5), attempt }), [month, attempt]);
  // A retry changes the subscription identity so useCollection reconnects cleanly.
  const subscribe = useCallback((owner, receive, fail) =>
    subscribeCalendarEvents(owner, request.dates, receive, fail), [request]);
  const [events, ready, error] = useCollection(uid, subscribe);
  return {
    dates: request.dates, events, ready, error,
    retry: () => setAttempt(value => value + 1),
    add: (data, addToTasks) => addCalendarEvent(uid, data, addToTasks),
    update: updateCalendarEvent,
    remove: deleteCalendarEvent,
  };
}
