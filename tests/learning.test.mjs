import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activitySelectionForDate, editorGoalConfiguration, latestGoalConfiguration, learningStats, goalForDate, goalEffectiveDate, validActivityTargets, withRecentGoal, weekStart, dateShift } from '../src/features/learning/learningStats.mjs';
import { archivedActivityReferences, missingActivitySnapshot } from '../src/features/learning/archivedActivity.mjs';
import { badgeTier } from '../src/features/learning/badgeAppearance.mjs';
const goal = { minutes:60, effectiveDate:'2026-10-01' };
const block = (date,startMin=0,endMin=60) => ({date,startMin,endMin,kind:'study'});
const now = new Date('2026-10-18T12:00:00');

test('learning merges overlapping and duplicate blocks, excludes control and future time', () => {
  const s = learningStats([
    block('2026-10-18',0,120),block('2026-10-18',60,180),block('2026-10-18',0,120),
    {...block('2026-10-18',180,240),kind:'control'},block('2026-10-19'),
    block('2026-10-18',210,300),block('2026-10-18',300,360),
  ],[goal],now);
  assert.equal(s.todayMinutes,210);
  assert.equal(s.qualifiedCount,1);
});
test('legacy records, 05:00 boundary and overnight minutes are counted', () => {
  const s = learningStats([{date:'2026-10-17',startSlot:0,endSlot:4},block('2026-10-17',1200,1300)], [goal],new Date('2026-10-18T04:30:00'));
  assert.equal(s.today,'2026-10-17');
  assert.equal(s.todayMinutes,90);
});
test('unfinished today retains yesterday streak, missed yesterday breaks it', () => {
  const blocks = [15,16,17].map(day => block(`2026-10-${day}`));
  assert.equal(learningStats(blocks,[goal],now).streak,3);
  assert.equal(learningStats([...blocks,block('2026-10-18')],[goal],now).streak,4);
  const later = learningStats(blocks,[goal],new Date('2026-10-19T05:00:00'));
  assert.equal(later.streak,0);
  assert.equal(later.bestStreak,3);
  assert.equal(later.badges.find(b => b.id==='streak-3').earnedDate,'2026-10-17');
});
test('first goal classifies existing study days; later revisions preserve earlier results', () => {
  const history = [goal,{minutes:120,effectiveDate:'2026-10-19',changedAt:1},{minutes:90,effectiveDate:'2026-10-19',changedAt:2}];
  assert.equal(goalForDate(history,'2026-10-18').minutes,60);
  assert.equal(goalForDate(history,'2026-10-19').minutes,90);
  assert.equal(goalEffectiveDate([], '2026-10-18'),'2026-10-18');
  assert.equal(goalEffectiveDate(history,'2026-10-18'),'2026-10-19');
  const s = learningStats([block('2026-09-30'),block('2026-10-01')],history,now);
  assert.equal(goalForDate(history,'2026-09-30').minutes,60);
  assert.equal(s.qualifiedCount,2);
  const revised = learningStats([block('2026-10-18'),block('2026-10-19')],history,new Date('2026-10-20T12:00:00'));
  assert.equal(revised.days['2026-10-18'].achieved,true);
  assert.equal(revised.days['2026-10-19'].achieved,false);
});
test('first saved goal marks past qualifying days for chart and heatmap', () => {
  const stats = learningStats([block('2026-10-13',0,90),block('2026-10-14',0,45)],
    [{minutes:60,effectiveDate:'2026-10-18'}],now);
  assert.equal(stats.days['2026-10-13'].achieved,true);
  assert.equal(stats.days['2026-10-14'].achieved,false);
  assert.equal(stats.qualifiedCount,1);
});
test('weekly badges include old history, use Monday weeks and recalculate on deletion', () => {
  assert.equal(weekStart('2027-01-01'),'2026-12-28');
  assert.equal(dateShift('2026-12-31',1),'2027-01-01');
  const blocks = [block('2026-09-01',0,300),block('2026-09-02',0,300)];
  const s = learningStats(blocks,[],now);
  assert.equal(s.badges.find(b => b.id==='week-10').earnedDate,'2026-08-31');
  assert.equal(s.weekMinutes,0);
  assert.equal(s.qualifiedCount,0);
  assert.equal(learningStats(blocks.slice(0,1),[],now).badges.find(b=>b.id==='week-10').earnedDate,undefined);
});
test('weekly milestones start at five and ten hours and end at seventy hours', () => {
  const blocks = Array.from({length:7},(_,i) => block(`2026-10-${12+i}`,0,600));
  const s = learningStats(blocks,[goal],new Date('2026-10-18T22:00:00'));
  assert.deepEqual(s.badges.filter(b => b.type === 'week').map(b => b.target/60),[5,10,20,30,40,50,60,70]);
  assert.equal(s.badges.find(b => b.id === 'week-70').earnedDate,'2026-10-12');
  assert.equal(s.badges.find(b => b.id === 'week-70').lastEarnedDate,'2026-10-18');
  assert.equal(s.weekHighlights.find(b => b.type === 'week').id,'week-70');
  assert.equal(s.weekHighlights.find(b => b.type === 'week').remaining,null);
  assert.equal(s.weekHighlights.find(b => b.type === 'week').repeated,false);
  assert.equal(s.weekHighlights.find(b => b.type === 'streak').id,'streak-7');
});

test('seventy-hour badge is awarded on the threshold-crossing day and is the highest weekly target', () => {
  const records = Array.from({length:7},(_,i) => block(dateShift('2026-10-12',i),0,600));
  const before = learningStats([...records.slice(0,-1),block('2026-10-18',0,599)],[goal],new Date('2026-10-18T22:00:00'));
  assert.equal(before.badges.find(b => b.id === 'week-70').earnedDate,undefined);
  const stats = learningStats(records,[goal],new Date('2026-10-18T22:00:00'));
  assert.equal(stats.badges.find(b => b.id === 'week-70').lastEarnedDate,'2026-10-18');
  assert.equal(stats.weekHighlights.find(b => b.type === 'week').id,'week-70');
  assert.equal(stats.weekHighlights.find(b => b.type === 'week').remaining,null);
});

test('weekly and streak badges use the same eight medal tiers in the same order', () => {
  const stats = learningStats([],[],now);
  const week = stats.badges.filter(b => b.type === 'week');
  const streak = stats.badges.filter(b => b.type === 'streak');
  const tiers = ['bronze','silver','gold','navy','champagne','rose','platinum','legend'];
  assert.deepEqual(streak.map(b => b.target),[3,7,14,30,60,100,200,365]);
  assert.deepEqual(week.map(b => badgeTier(b.type,b.target)),tiers);
  assert.deepEqual(streak.map(b => badgeTier(b.type,b.target)),tiers);
});

test('200-day and 365-day badges respect the exact streak threshold and missing days', () => {
  const start = '2025-10-19';
  const records = Array.from({length:365},(_,i) => block(dateShift(start,i)));
  const at200 = learningStats(records.slice(0,200),[goal],new Date(`${dateShift(start,199)}T22:00:00`));
  assert.equal(at200.badges.find(b => b.id === 'streak-200').lastEarnedDate,dateShift(start,199));
  assert.equal(at200.badges.find(b => b.id === 'streak-365').earnedDate,undefined);
  assert.equal(at200.weekHighlights.find(b => b.type === 'streak').remaining,165);
  const at365 = learningStats(records,[goal],now);
  assert.equal(at365.streak,365);
  assert.equal(at365.badges.find(b => b.id === 'streak-365').lastEarnedDate,'2026-10-18');
  assert.equal(at365.weekHighlights.find(b => b.type === 'streak').id,'streak-365');
  assert.equal(at365.weekHighlights.find(b => b.type === 'streak').remaining,null);
  const broken = learningStats(records.filter(b => b.date !== dateShift(start,199)),[goal],now);
  assert.equal(broken.badges.find(b => b.id === 'streak-200').earnedDate,undefined);
  assert.equal(broken.badges.find(b => b.id === 'streak-365').earnedDate,undefined);
});
test('weekly top activities use included study time, merge overlaps, and show only three', () => {
  const history = [{minutes:60,effectiveDate:'2026-10-12',
    includedActivityIds:['a','b','c'],activityTargets:{}}];
  const records = [
    {...block('2026-10-12',0,90),activityId:'a'},
    {...block('2026-10-12',30,60),activityId:'a'},
    {...block('2026-10-13',0,30),activityId:'a'},
    {...block('2026-10-12',90,180),activityId:'b'},
    {...block('2026-10-12',180,240),customName:'독서',learningIncluded:true},
    {...block('2026-10-12',240,270),activityId:'c'},
    {...block('2026-10-12',270,570),activityId:'excluded'},
    {...block('2026-10-12',270,570),activityId:'a',kind:'control'},
  ];
  const activities = [{id:'a',name:'수학',color:'#123456'},{id:'b',name:'영어'}, {id:'c',name:'과학'}];
  const stats = learningStats(records,history,new Date('2026-10-19T12:00:00'),activities);
  assert.equal(stats.weeks['2026-10-12'],300);
  assert.deepEqual(stats.weekTopActivities['2026-10-12'].map(item => [item.name,item.minutes]),
    [['수학',120],['영어',90],['독서',60]]);
  assert.equal(stats.weekTopActivities['2026-10-12'][0].color,'#123456');
});
test('this-week achievement repeats are distinct from first badge unlocks', () => {
  const blocks = Array.from({length:14},(_,i) => block(dateShift('2026-10-05',i),0,600));
  const s = learningStats(blocks,[goal],new Date('2026-10-18T22:00:00'));
  assert.equal(s.badges.find(b => b.id === 'week-70').earnedDate,'2026-10-05');
  assert.equal(s.weekHighlights.find(b => b.type === 'week').repeated,true);
  assert.equal(s.weekHighlights.find(b => b.type === 'streak').id,'streak-14');
  assert.equal(s.weekHighlights.find(b => b.type === 'streak').repeated,false);
});

test('weekly badges show the latest threshold-crossing day and time to the next target', () => {
  const records = [block('2026-10-05',0,600),block('2026-10-12',0,300),block('2026-10-13',0,460)];
  const stats = learningStats(records,[goal],now);
  const badge = stats.badges.find(b => b.id === 'week-10');
  assert.equal(badge.earnedDate,'2026-10-05');
  assert.equal(badge.lastEarnedDate,'2026-10-13');
  assert.equal(stats.weekHighlights.find(b => b.type === 'week').remaining,440);
  assert.equal(stats.weekHighlights.find(b => b.type === 'week').repeated,true);
  const afterDeletion = learningStats(records.slice(0,2),[goal],now);
  assert.equal(afterDeletion.badges.find(b => b.id === 'week-10').lastEarnedDate,'2026-10-05');
  assert.equal(afterDeletion.weekHighlights.find(b => b.type === 'week').id,'week-5');
  assert.equal(afterDeletion.weekHighlights.find(b => b.type === 'week').remaining,300);
});

test('streak badges show the latest repeated milestone date without moving it as the streak grows', () => {
  const records = [1,2,3,10,11,12,13].map(day => block(`2026-10-${String(day).padStart(2,'0')}`));
  const date = new Date('2026-10-13T22:00:00');
  const stats = learningStats(records,[goal],date);
  const badge = stats.badges.find(b => b.id === 'streak-3');
  assert.equal(badge.earnedDate,'2026-10-03');
  assert.equal(badge.lastEarnedDate,'2026-10-12');
  assert.equal(stats.streak,4);
  assert.equal(stats.weekHighlights.find(b => b.type === 'streak').remaining,3);
  assert.equal(stats.weekHighlights.find(b => b.type === 'streak').repeated,true);
  const afterDeletion = learningStats(records.filter(b => b.date !== '2026-10-11'),[goal],date);
  assert.equal(afterDeletion.badges.find(b => b.id === 'streak-3').lastEarnedDate,'2026-10-03');
  assert.equal(afterDeletion.weekHighlights.some(b => b.type === 'streak'),false);
});
test('first activity selection reclassifies past records and excludes unrelated or unreviewed custom time', () => {
  const history = [goal, { minutes:60, effectiveDate:'2026-10-19', changedAt:1,
    includedActivityIds:['math'], activityTargets:{math:30} }];
  const records = [
    {...block('2026-10-17',0,60),activityId:'math'},
    {...block('2026-10-17',60,120),activityId:'exercise'},
    {...block('2026-10-17',120,180),activityId:null,customName:'독서'},
    {...block('2026-10-18',0,30),activityId:'math'},
    {...block('2026-10-18',30,60),activityId:'exercise'},
  ];
  assert.equal(learningStats(records,[goal],now).days['2026-10-17'].minutes,180);
  const stats = learningStats(records,history,now);
  assert.equal(activitySelectionForDate(history,'2026-10-17').includedActivityIds[0],'math');
  assert.equal(stats.days['2026-10-17'].minutes,60);
  assert.equal(stats.days['2026-10-17'].achieved,true);
  assert.equal(stats.todayMinutes,30);
  assert.equal(stats.activityMinutes.exercise,30);
  assert.equal(stats.qualifiedCount,1);
  assert.equal(learningStats([...records,{...block('2026-10-17',120,180),activityId:null,learningIncluded:true}],history,now).days['2026-10-17'].minutes,120);
});
test('later activity changes begin next week and targets remain optional', () => {
  const history = [
    {minutes:60,effectiveDate:'2026-10-01',includedActivityIds:['math'],activityTargets:{math:30}},
    {minutes:60,effectiveDate:'2026-10-19',includedActivityIds:['english'],activityTargets:{}},
  ];
  const records = [
    {...block('2026-10-18'),activityId:'math'},
    {...block('2026-10-18',60,120),activityId:'english'},
    {...block('2026-10-19'),activityId:'math'},
    {...block('2026-10-19',60,120),activityId:'english'},
  ];
  const stats = learningStats(records,history,new Date('2026-10-20T12:00:00'));
  assert.equal(stats.days['2026-10-18'].minutes,60);
  assert.equal(stats.days['2026-10-19'].minutes,60);
  assert.equal(activitySelectionForDate(history,'2026-10-18').includedActivityIds[0],'math');
  assert.equal(activitySelectionForDate(history,'2026-10-19').includedActivityIds[0],'english');
  assert.equal(validActivityTargets(['math'],{}),true);
  assert.equal(validActivityTargets(['math'],{english:30}),false);
  assert.equal(validActivityTargets(['math','math'],{}),false);
  assert.equal(validActivityTargets(['math'],{math:0}),false);
});
test('saved activity exclusions remain visible until the goal listener catches up', () => {
  const old = { id:'old', uid:'alice', minutes:60, effectiveDate:'2026-10-12',
    includedActivityIds:['study','rest'], activityTargets:{}, changedAt:1 };
  const saved = { id:'saved', uid:'alice', minutes:60, effectiveDate:'2026-10-19',
    includedActivityIds:['study'], activityTargets:{study:45}, changedAt:2 };
  const immediate = withRecentGoal([old], saved, 'alice');
  assert.deepEqual(activitySelectionForDate(immediate,'2026-10-19').includedActivityIds,['study']);
  assert.equal(immediate.length,2);
  assert.equal(withRecentGoal([old,saved],saved,'alice').length,2);
  assert.equal(withRecentGoal([old],saved,'bob').length,1);
});
test('reopening goal settings uses the most recently saved selection, including after reload', () => {
  const old = { id:'old', minutes:60, effectiveDate:'2026-10-26', changedAt:100,
    createdAt:{ toMillis:() => 300 }, includedActivityIds:['study','rest'], activityTargets:{} };
  const saved = { id:'saved', minutes:75, effectiveDate:'2026-10-26', changedAt:200,
    createdAt:{ toMillis:() => 150 }, includedActivityIds:['study'], activityTargets:{study:45} };
  const history = [saved,old];
  assert.deepEqual(latestGoalConfiguration(history).includedActivityIds,['study']);
  assert.deepEqual(activitySelectionForDate(history,'2026-10-26').includedActivityIds,['study']);
  assert.equal(goalForDate(history,'2026-10-26').minutes,75);
  const unsynced = { ...saved, id:'newest', changedAt:250, includedActivityIds:[] };
  assert.deepEqual(editorGoalConfiguration(history,unsynced).includedActivityIds,[]);
  assert.deepEqual(editorGoalConfiguration(history,{ ...old, changedAt:50 }).includedActivityIds,['study']);
});
test('purging a stored activity preserves names and colors on old study blocks', () => {
  const activity = { id:'old', name:'육아', color:'#123456', archived:true };
  const blocks = [
    { id:'a', activityId:'old', kind:'study' },
    { id:'b', activityId:'old', kind:'study', activityName:'옛 이름', activityColor:'#654321' },
    { id:'c', activityId:'old', kind:'control' },
  ];
  assert.deepEqual(archivedActivityReferences(blocks,'old').map(block => block.id),['a','b']);
  assert.deepEqual(missingActivitySnapshot(blocks[0],activity),{ activityName:'육아', activityColor:'#123456' });
  assert.deepEqual(missingActivitySnapshot(blocks[1],activity),{});
});

test('personal records use the whole week total and the activity with the largest lifetime total', () => {
  const activities = ['a','b','c','d'].map(id => ({id,name:id,color:'#123456'}));
  const records = activities.map((activity,index) => ({...block('2026-10-05',index*120,(index+1)*120),activityId:activity.id}));
  records.push({...block('2026-10-05',360,480),activityId:'d'});
  records.push({...block('2026-10-12',0,120),activityId:'d'});
  const stats = learningStats(records,[goal],now,activities);
  assert.equal(stats.weekTopActivities['2026-10-05'].length,3);
  assert.deepEqual(stats.personalRecords.bestWeek,{week:'2026-10-05',minutes:480});
  assert.equal(stats.personalRecords.topActivity.key,'activity:d');
  assert.equal(stats.personalRecords.topActivity.totalMinutes,240);
  assert.equal(stats.personalRecords.topActivity.color,'#123456');
  assert.equal(stats.personalRecords.totalMinutes,600);
  const revised = learningStats(records.filter(item => item.date !== '2026-10-05'),[goal],now,activities);
  assert.deepEqual(revised.personalRecords.bestWeek,{week:'2026-10-12',minutes:120});
  assert.equal(revised.personalRecords.topActivity.totalMinutes,120);
  const tied = learningStats([
    {...block('2026-10-05',0,120),activityId:'a'},
    {...block('2026-10-12',0,120),activityId:'d'},
  ],[goal],now,activities).personalRecords;
  assert.equal(tied.bestWeek.week,'2026-10-12');
  assert.equal(tied.topActivity.key,'activity:d');
});

test('personal monthly record counts goal-qualified days, resolves ties by latest month and recalculates', () => {
  const records = ['2026-09-01','2026-09-02','2026-10-01','2026-10-02'].map(date => block(date));
  records.push(block('2026-10-03',0,30));
  const stats = learningStats(records,[goal],now);
  assert.deepEqual(stats.personalRecords.bestMonth,{month:'2026-10',days:2});
  assert.deepEqual(learningStats(records.filter(item => item.date !== '2026-10-02'),[goal],now).personalRecords.bestMonth,
    {month:'2026-09',days:2});
  assert.equal(learningStats(records,[],now).personalRecords.bestMonth,null);
  assert.deepEqual(learningStats([],[],now).personalRecords,
    {bestMonth:null,bestWeek:null,topActivity:null,growth:[],totalMinutes:0,today:'2026-10-18'});
});

test('cumulative growth uses chronological union time across activities and recalculates after deletion', () => {
  const records = [
    {...block('2026-10-04',0,60),activityId:'math'},
    {...block('2026-10-01',0,120),activityId:'math'},
    {...block('2026-10-01',60,180),activityId:'reading'},
    {...block('2026-10-01',0,120),activityId:'math'},
  ];
  const result = learningStats(records,[goal],now).personalRecords;
  assert.deepEqual(result.growth,[{date:'2026-10-01',minutes:180},{date:'2026-10-04',minutes:240}]);
  assert.equal(result.totalMinutes,240);
  assert.equal(result.topActivity.totalMinutes,180);
  assert.equal(result.today,'2026-10-18');
  const revised = learningStats(records.filter(item => !(item.date === '2026-10-01' && item.activityId === 'math')),[goal],now).personalRecords;
  assert.equal(revised.totalMinutes,180);
  assert.equal(revised.topActivity.key,'activity:reading');
  assert.deepEqual(revised.growth,[{date:'2026-10-01',minutes:120},{date:'2026-10-04',minutes:180}]);
});

test('personal records follow study selection, custom inclusion and the elapsed planner-day boundary', () => {
  const history = [{...goal,includedActivityIds:['math'],activityTargets:{}}];
  const records = [
    {...block('2026-10-17',1200,1300),activityId:'math'},
    {...block('2026-10-17',0,600),activityId:'excluded'},
    {...block('2026-10-17',0,600),activityId:'math',kind:'control'},
    {...block('2026-10-18',0,600),activityId:'math'},
    {...block('2026-10-19',0,600),activityId:'math'},
    {...block('2026-10-17',0,120),customName:'독서',learningIncluded:true},
    {...block('2026-10-17',120,240),customName:'미검토'},
  ];
  const stats = learningStats(records,history,new Date('2026-10-18T04:30:00'));
  assert.equal(stats.personalRecords.topActivity.name,'독서');
  assert.equal(stats.personalRecords.topActivity.totalMinutes,120);
  assert.equal(stats.personalRecords.bestWeek.minutes,150);
  assert.equal(stats.personalRecords.totalMinutes,150);
  assert.deepEqual(stats.personalRecords.growth,[{date:'2026-10-17',minutes:150}]);
  assert.equal(stats.personalRecords.bestMonth.days,1);
});
