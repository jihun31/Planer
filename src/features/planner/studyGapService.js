import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { plannerDate } from './scheduleTime.mjs';
import { studyGap } from './studyGap.mjs';
import { excludeStudyTime } from './controlTime.mjs';
import { controlColor, orderControlActivities } from './controlColors.mjs';

async function readDay(uid,startTs) {
  if (!uid) throw new Error('Login required');
  const snapshot = await getDocs(query(collection(db,'scheduleBlocks'),where('uid','==',uid),where('date','==',plannerDate(startTs))));
  return snapshot.docs.map(item => ({id:item.id,...item.data()}));
}

export async function prepareStudyGap(uid,startTs) {
  const gap = studyGap(await readDay(uid,startTs),startTs);
  if (!gap) return null;
  const snapshot = await getDocs(query(collection(db,'controlActivities'),where('uid','==',uid)));
  const activities = orderControlActivities(snapshot.docs.map(item => ({id:item.id,...item.data()}))
    .filter(activity => !activity.archived).sort((a,b) => (a.order ?? Infinity) - (b.order ?? Infinity)));
  return {...gap,activities};
}

export async function saveStudyGap(uid,gap,metadata) {
  if (!['controlled','foolish'].includes(metadata.group)) throw new Error('Choose a control group');
  // Do not overwrite study or control entries added while the dialog was open.
  const current = await readDay(uid,gap.startTs);
  const fresh = studyGap(current,gap.startTs);
  if (!fresh) return;
  const segments = excludeStudyTime(gap.segments,current).flatMap(segment => fresh.segments.flatMap(part => {
    const startMin = Math.max(segment.startMin,part.startMin), endMin = Math.min(segment.endMin,part.endMin);
    return startMin < endMin ? [{date:segment.date,startMin,endMin}] : [];
  }));
  const batch = writeBatch(db);
  for (const segment of segments) batch.set(doc(db,'scheduleBlocks',`study_gap_${uid}_${gap.startTs}_${segment.startMin}`),{
    ...metadata,...segment,uid,kind:'control',activityColor:controlColor(metadata.group),
    customColor:controlColor(metadata.group),source:'study-gap',createdAt:serverTimestamp(),
  });
  if (segments.length) await batch.commit();
}
