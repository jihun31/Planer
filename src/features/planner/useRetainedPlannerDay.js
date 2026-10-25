import { useRef } from 'react';

// A month refresh must not remove the selected day's mounted timetable.
// Never retain data across account/date boundaries or enable writes while stale.
export function useRetainedPlannerDay(uid,date,data) {
  const previous=useRef(null);
  if(!data.loading&&!data.error)previous.current={uid,date,blocks:data.blocks.filter(block=>block.date===date),oppositeBlocks:data.oppositeBlocks.filter(block=>block.date===date)};
  if(previous.current?.uid===uid&&previous.current.date===date)return previous.current;
  return {blocks:[],oppositeBlocks:[]};
}
