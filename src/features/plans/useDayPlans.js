import { useCallback, useState } from 'react';
import { useCollection } from '../../lib/useCollection';
import { planDateWindow, plansForDate, overlappingPlanKeys, routineCatalog } from './planModel.mjs';
import { subscribeRoutines, subscribePlanEntries, saveRoutine, savePlanEntry, removePlanEntry } from './planService';

export function useDayPlans(uid,date) {
  const [listeners,setListeners]=useState(()=>({routines:subscribeRoutines,entries:subscribePlanEntries}));
  const {entries:subscribeEntries}=listeners;
  const listenEntries=useCallback((owner,next,error)=>subscribeEntries(owner,planDateWindow(date),next,error),[date,subscribeEntries]);
  const [routines,routinesReady,routinesError]=useCollection(uid,listeners.routines);
  const [entries,entriesReady,entriesError]=useCollection(uid,listenEntries);
  return {plans:plansForDate(routines,entries,date),routines:routineCatalog(routines),overlaps:overlappingPlanKeys(routines,entries,date),
    versions:routines,entries,loading:!routinesReady || !entriesReady,error:routinesError || entriesError,
    retry:()=>setListeners({routines:(...args)=>subscribeRoutines(...args),entries:(...args)=>subscribePlanEntries(...args)}),
    saveRoutine:(data,options)=>saveRoutine(uid,data,options),saveEntry:(data,id)=>savePlanEntry(uid,data,id),removeEntry:id=>removePlanEntry(uid,id)};
}
