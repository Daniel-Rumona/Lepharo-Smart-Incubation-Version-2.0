const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('../../../scripts/digital-twin/validate.cjs');
const {buildProcessTwin,emptySources}=loadTs('src/services/digitalTwin/processTwin.ts');
const {buildHistory,historyFrame}=loadTs('src/services/digitalTwin/history.ts');
const {simulate,captureSimulation,DEFAULT_ASSUMPTIONS,SIMULATION_VERSION}=loadTs('src/services/digitalTwin/simulation.ts');
const monday=Date.parse('2026-01-05T00:00:00+02:00');
const snapshot=(units)=>({id:'hand-case',modelVersion:SIMULATION_VERSION,capturedAt:monday,startAt:monday,scope:'test',units,excluded:{},synthetic:true});
const assumptions=(extra={})=>({...DEFAULT_ASSUMPTIONS,weeks:1,intakeWeeks:1,deliveryHours:5,hodWindows:5,hodWindowMinutes:60,reviewMinutes:15,ccHours:2.5,meHours:2.5,closedDates:[],...extra});
test('shared delivery consumes one session and produces separate reviews with next-day handoffs',()=>{
 const result=simulate(snapshot([{id:'group',stage:'delivery',members:2,releaseDay:0}]),assumptions());
 assert.equal(result.sessionsDelivered,1);assert.equal(result.delivered,2);assert.equal(result.verified,2);
 assert.equal(result.minutesUsed.delivery,60);assert.equal(result.minutesUsed.hod,30);assert.equal(result.minutesUsed.cc,30);assert.equal(result.minutesUsed.me,30);
 assert.equal(result.days[0].queues.hod,2);assert.equal(result.days[1].queues.cc,2);assert.equal(result.days[2].queues.me,2);assert.equal(result.days[3].verified,2);
 assert.equal(result.backlog+result.verified,result.demand);
});
test('capacity exhaustion carries work across days; zero downstream capacity remains a bottleneck',()=>{
 const s=snapshot([{id:'one',stage:'delivery',members:1,releaseDay:0}]);
 const slow=simulate(s,assumptions({deliveryHours:2.5,meHours:0}));
 assert.equal(slow.days[0].delivered,0);assert.equal(slow.days[1].delivered,1);
 assert.equal(slow.verified,0);assert.equal(slow.days.at(-1).queues.me,1);
 const fast=simulate(s,assumptions({deliveryHours:10,meHours:0}));assert.equal(fast.verified,0);
});
test('calendar respects closures and weekends; no work uses nonexistent capacity',()=>{
 const s=snapshot([{id:'one',stage:'delivery',members:1,releaseDay:0}]);
 const r=simulate(s,assumptions({closedDates:['2026-01-05']}));
 assert.equal(r.days[0].delivered,0);assert.equal(r.days[1].delivered,1);assert.equal(r.days[4].verified,1);
 assert.equal(r.days[5].verified,r.days[4].verified);assert.equal(r.days[6].verified,r.days[5].verified);
 for(const stage of ['delivery','hod','cc','me'])assert.ok(r.minutesUsed[stage]<=r.minutesAvailable[stage]);
});
test('frozen inputs reproduce exact results and added intake conserves demand',()=>{
 const s=snapshot([{id:'review',stage:'hod',members:1,releaseDay:0}]),a=assumptions({intake:30});const before=JSON.stringify({s,a});
 const r=simulate(s,a);assert.deepEqual(r,simulate(JSON.parse(JSON.stringify(s)),JSON.parse(JSON.stringify(a))));
 const {newSmeInterventionsBy}=loadTs('src/services/digitalTwin/pilotCalibration.ts'),added=Math.floor(30*newSmeInterventionsBy(6)+1e-9);
 assert.equal(r.demand,1+added);assert.equal(r.verified+r.backlog,1+added);assert.equal(JSON.stringify({s,a}),before);
 assert.equal(simulate(s,assumptions({intake:0})).demand,1);
});
test('malformed parameters, duplicate demand and incompatible models are rejected',()=>{
 const s=snapshot([{id:'one',stage:'hod',members:1,releaseDay:0}]);
 assert.throws(()=>simulate(s,assumptions({hodWindows:2.5})),/Invalid assumption/);
 assert.throws(()=>simulate(s,assumptions({closedDates:['2026-02-31']})),/valid YYYY/);
 assert.throws(()=>simulate({...s,units:[...s.units,...s.units]},assumptions()),/Duplicate/);
 assert.throws(()=>simulate({...s,modelVersion:'future'},assumptions()),/Unsupported/);
});
test('capture excludes pending consent and completed support while preserving review-ready work',()=>{
 const source=emptySources();source.assignedInterventions=[{id:'a',programId:'p',branchId:'b',participantAcceptanceStatus:'pending'}, {id:'b',programId:'p',branchId:'b',assignmentStatus:'completed'}];source.movDocuments=[{id:'mov',programId:'p',branchId:'b',assignedInterventionId:'b',status:'awaiting_hod'}];
 const model=buildProcessTwin(source,{programId:'p'},monday),s=captureSimulation(model,'scope',monday);
 assert.deepEqual(s.units,[{id:'mov:mov',stage:'hod',members:1,releaseDay:0}]);assert.equal(Object.values(s.excluded).reduce((a,b)=>a+b,0),1);
 const saved=JSON.stringify(s);source.movDocuments[0].status='approved';assert.equal(JSON.stringify(s),saved);
});
test('history deduplicates imports, sorts reordered records and never shows future events in a prefix',()=>{
 const source=emptySources();source.assignedInterventions=[{id:'a',programId:'p',branchId:'b',assignedAt:new Date(monday),participantConfirmedAt:new Date(monday+3000),updatedAt:new Date(monday+2000),assigneeCompletedAt:new Date(monday+1000)}];
 const model=buildProcessTwin(source,{programId:'p'},monday+5000);
 const seed=[{id:'seed',entityId:'a',dataOrigin:'synthetic',eventType:'assigned',occurredAt:new Date(monday)},{id:'foreign',entityId:'foreign',dataOrigin:'synthetic',eventType:'delivered',occurredAt:new Date(monday)},{id:'future',entityId:'a',dataOrigin:'synthetic',eventType:'confirmed',occurredAt:new Date(monday+9000)}];
 const history=buildHistory(model,seed,monday+5000);assert.equal(history.events.length,3);assert.equal(history.future,1);
 assert.deepEqual(history,buildHistory(model,[...seed].reverse(),monday+5000));
 const first=historyFrame(history.events,1);assert.equal(first.counts.assigned,1);assert.equal(first.counts.confirmed,0);assert.equal(first.previous,null);
 assert.equal(historyFrame(history.events,3).counts.confirmed,1);assert.equal(historyFrame(history.events,0).current,null);
 assert.equal(history.events.some(e=>e.at===monday+2000),false,'updatedAt is not a historical transition');
});
test('attendance is counted for every delivery method, once, and undated attendance stays off the timeline',()=>{
 const at='2026-03-02T09:00:00Z',now=Date.parse('2026-06-01T00:00:00Z');
 const a=(id,deliveryMethod,attendance)=>({id:'app-'+id,assignedInterventionId:'a-'+id,appointmentSessionId:'s-'+id,deliveryMethod,attendance});
 const model={assignments:['inperson','virtual','phone','late'].map(k=>({id:'a-'+k,participantName:k,interventionTitle:'T'})),
  appointments:[a('inperson','in_person',{status:'attended',checkedInAt:at}),a('virtual','virtual',{status:'attended',checkedInAt:at}),a('phone','telephonically',{status:'attended',checkedInAt:at}),a('late','virtual',{status:'attended'}),{...a('x','virtual',{status:'absent'}),assignedInterventionId:'a-virtual'}],
  sessions:[],movs:[],assessments:[],
  inquiries:[{id:'walk',assignedInterventionId:'a-inperson',appointmentId:'app-inperson',submittedAt:at}]};
 const h=buildHistory(model,[],now),att=h.events.filter(e=>e.node==='attended');
 assert.deepEqual(att.map(e=>e.assignmentId).sort(),['a-inperson','a-phone','a-virtual']);
 assert.equal(att.length,3);assert.equal(h.attendedUndated,1);
 assert.ok(att.find(e=>e.assignmentId==='a-phone').label.includes('telephonic'));
 assert.ok(att.find(e=>e.assignmentId==='a-virtual').label.includes('virtual'));
});
test('attendance routes are counted per route, can overlap, and the remote supplement is create-only and linked',()=>{
 const {historyFrame}=loadTs('src/services/digitalTwin/history.ts');
 const at=(d)=>`2026-03-0${d}T09:00:00Z`,now=Date.parse('2026-06-01T00:00:00Z');
 const inv=(id,asg,method,d)=>({id,assignedInterventionId:asg,appointmentSessionId:'s-'+id,deliveryMethod:method,attendance:{status:'attended',checkedInAt:at(d)}});
 const model={assignments:[{id:'a1',participantName:'x'},{id:'a2',participantName:'y'}],appointments:[inv('1','a1','in_person',1),inv('2','a1','virtual',2),inv('3','a2','telephonic',3),inv('4','a2','hybrid',4)],sessions:[],movs:[],assessments:[],inquiries:[]};
 const h=buildHistory(model,[],now),f=historyFrame(h.events,h.events.length);
 assert.deepEqual(f.channels,{in_person:1,virtual:1,telephonic:1,other:1});assert.equal(f.counts.attended,2);
 const {generate,RUN}=require('../../../scripts/digital-twin/dataset.cjs'),{build,EXT}=require('../../../scripts/digital-twin/seed-remote.cjs');
 const base=generate().records,r=build(base);
 assert.equal(r.summary.byMethod.virtual+r.summary.byMethod.telephonic,r.summary.created);assert.ok(r.summary.byMethod.virtual>0&&r.summary.byMethod.telephonic>0);
 const paths=new Set(base.map(x=>x.path));assert.ok(r.records.every(x=>!paths.has(x.path)&&x.data.seedRunId===EXT&&x.data.parentSeedRunId===RUN&&x.data.suppressNotifications===true));
 const ids=new Set(r.records.map(x=>x.path.split('/')[1]));
 for(const x of r.records.filter(x=>x.path.startsWith('appointments/')))assert.ok(ids.has(x.data.assignedInterventionId)&&ids.has(x.data.appointmentSessionId));
});
test('observed delivery uses completed sessions only, counts a shared session once and refuses thin data',()=>{
 const {observedDelivery}=loadTs('src/services/digitalTwin/simulation.ts');
 const now=Date.parse('2026-06-01T00:00:00Z'),at=(d,h=9)=>new Date(Date.UTC(2026,4,d,h)).toISOString();
 const s=(id,d,mins,extra={})=>({id,status:'completed',startAt:at(d),endAt:new Date(Date.parse(at(d))+mins*60000).toISOString(),...extra});
 const rows=[s('a',4,60),s('b',5,60),s('c',6,90),s('d',12,60),s('e',13,30),s('cancelled',7,60,{status:'cancelled'}),s('future',30,60,{startAt:'2026-07-01T09:00:00Z',endAt:'2026-07-01T10:00:00Z'}),s('old',1,60,{startAt:'2025-01-01T09:00:00Z',endAt:'2025-01-01T10:00:00Z'}),s('bad',8,-5)];
 const o=observedDelivery(rows,now);
 assert.equal(o.sessions,5);assert.equal(o.medianMinutes,60);assert.equal(o.peakHoursPerWeek,3.5);assert.equal(o.avgHoursPerWeek,Math.round(300/12/60*10)/10);
 assert.equal(observedDelivery(rows.slice(0,3),now),null);
});
test('step durations use earliest evidence, skip reversed pairs and refuse thin data; waits ignore unknown dates',()=>{
 const {stepDurations}=loadTs('src/services/digitalTwin/history.ts'),{summariseWaits,median}=loadTs('src/services/digitalTwin/twinTargets.ts');
 const D=86400000,t0=Date.parse('2026-01-01T00:00:00Z');
 const ev=(a,node,days)=>({id:a+node+days,assignmentId:a,node,at:t0+days*D,label:'',participant:'',intervention:'',source:'',synthetic:false});
 const events=[];for(const [a,gap] of [['a',10],['b',12],['c',14],['d',-3]]){events.push(ev(a,'assigned',0),ev(a,'attended',gap))}
 events.push(ev('a','attended',20));// a later duplicate must not replace the earliest
 const d=stepDurations(events);assert.equal(d.attended.n,3);assert.equal(d.attended.medianDays,12);assert.equal(d.delivery,undefined);
 assert.equal(median([1,3,2]),2);assert.equal(median([1,2,3,4]),2.5);assert.equal(median([]),null);
 const now=t0+30*D,w=summariseWaits([t0,t0+20*D,null,now+D],now,7);
 assert.deepEqual(w,{known:2,unknown:2,median:20,oldest:30,pastTarget:2});
});
test('goal-seek finds a sufficient, trimmed change; recognises already-met and unreachable goals',()=>{
 const {suggestForGoal,scenarioAssumptions,clearDay}=loadTs('src/services/digitalTwin/goalSeek.ts');
 const {simulate}=loadTs('src/services/digitalTwin/simulation.ts');
 // 40 evidence records waiting at the centre coordinator, who has 2.5 h/week (30 reviews of 15 min a week is 7.5 h), over a 3 week horizon.
 const units=Array.from({length:40},(_,i)=>({id:'cc'+i,stage:'cc',members:1,releaseDay:0}));
 const snap=snapshot(units),base=assumptions({weeks:3,ccHours:2.5,meHours:50,hodWindows:2});
 const none={hours:0,cc:0,me:0,hod:2,intake:0};
 const before=simulate(snap,scenarioAssumptions(base,none));assert.ok(clearDay(before)===null||clearDay(before)>10);
 const got=suggestForGoal(snap,base,none,9);
 assert.equal(got.status,'found');assert.ok(got.added.cc>0);assert.equal(got.added.hours,undefined);assert.equal(got.added.me,undefined);
 const after=simulate(snap,scenarioAssumptions(base,got.levers,3));assert.equal(after.days[9].backlog,0);
 // Trimmed: one fewer coordinator hour would miss the goal.
 const less=simulate(snap,scenarioAssumptions(base,{...got.levers,cc:got.levers.cc-1},3));assert.ok(less.days[9].backlog>0);
 // Already met with the suggested levers.
 assert.equal(suggestForGoal(snap,base,got.levers,9).status,'already');
 // Work that only arrives after the target day is not waiting yet, so the goal is already met.
 const late=snapshot([{id:'late',stage:'delivery',members:1,releaseDay:12}]);
 assert.equal(suggestForGoal(late,assumptions({weeks:3}),none,5).status,'already');
 // With steady inflow the backlog never reaches zero; the goal is to keep up, i.e. match what maximum capacity achieves.
 const flow=assumptions({weeks:4,inflowPerWeek:15,deliveryHours:5,hodWindows:1,ccHours:1,meHours:1});
 const keep=suggestForGoal(snapshot([]),flow,none,20);assert.equal(keep.status,'found');assert.equal(keep.clearDay,null);
 const kept=simulate(snapshot([]),scenarioAssumptions(flow,keep.levers,4));const maxed=simulate(snapshot([]),scenarioAssumptions(flow,{hours:235,cc:199,me:199,hod:5,intake:0},4));
 assert.ok(kept.days[20].backlog<=maxed.days[20].backlog);
 assert.ok(simulate(snapshot([]),scenarioAssumptions(flow,none,4)).days[20].backlog>maxed.days[20].backlog);
 assert.equal(suggestForGoal(snap,base,none,400).status,'too_far');
});
test('steady inflow adds weekday arrivals to both sides, conserves work and averages the last 12 weeks',()=>{
 const {observedInflow,simulate:sim,DEFAULT_ASSUMPTIONS:D}=loadTs('src/services/digitalTwin/simulation.ts');
 const now=Date.parse('2026-06-01T00:00:00Z'),day=864e5;
 const rows=[...Array.from({length:24},(_,i)=>({assignedAt:new Date(now-(i*3+1)*day).toISOString()})),{assignedAt:'2025-01-01T00:00:00Z'},{assignedAt:'nonsense'},{}];
 const o=observedInflow(rows,now);assert.equal(o.count,24);assert.equal(o.perWeek,2);
 const snap=snapshot([]);
 const none=sim(snap,assumptions({weeks:2,inflowPerWeek:0})),flow=sim(snap,assumptions({weeks:2,inflowPerWeek:5}));
 assert.equal(none.demand,0);assert.equal(flow.demand,10);assert.equal(flow.backlog+flow.verified,flow.demand);
 const frac=sim(snap,assumptions({weeks:4,inflowPerWeek:2.5}));assert.equal(frac.demand,10);
 const off=sim(snap,assumptions({weeks:2,inflowPerWeek:5,closedDates:['2026-01-05']}));assert.equal(off.demand,10);
 assert.throws(()=>sim(snap,assumptions({inflowPerWeek:-1})));
});
test('an intervention needing several sessions waits the minimum gap between them; a shared sitting serves everyone',()=>{
 const {simulate:sim}=loadTs('src/services/digitalTwin/simulation.ts');
 const wide=assumptions({weeks:4,deliveryHours:50,daysBetweenSessions:7});
 const one=sim(snapshot([{id:'multi',stage:'delivery',members:1,releaseDay:0,sessions:3}]),wide);
 assert.equal(one.sessionsDelivered,3);                                                  // three sittings
 assert.equal(one.days[0].delivered,0);assert.equal(one.days[7].delivered,0);assert.equal(one.days[14].delivered,1); // delivered only after the third, a fortnight later
 assert.equal(one.verified,1);assert.equal(one.backlog,0);
 const fast=sim(snapshot([{id:'multi',stage:'delivery',members:1,releaseDay:0,sessions:3}]),{...wide,daysBetweenSessions:1});
 assert.equal(fast.days[1].delivered,0);assert.equal(fast.days[2].delivered,1);          // Monday, Tuesday, Wednesday
 const group=sim(snapshot([{id:'g',stage:'delivery',members:4,releaseDay:0,sessions:2}]),wide);
 assert.equal(group.sessionsDelivered,2);assert.equal(group.delivered,4);                // two sittings for four SMEs
 assert.equal(sim(snapshot([{id:'x',stage:'delivery',members:1,releaseDay:0}]),wide).sessionsDelivered,1); // unspecified means one session
 assert.throws(()=>sim(snapshot([{id:'x',stage:'delivery',members:1,releaseDay:0,sessions:0}]),wide),/Invalid simulation work unit/);
 assert.throws(()=>sim(snapshot([]),{...wide,daysBetweenSessions:0}),/Invalid assumption/);
});
test('facilitators run only so many sessions a day, however many hours there are; extra hours buy extra sessions',()=>{
 const {simulate:sim}=loadTs('src/services/digitalTwin/simulation.ts');
 const units=Array.from({length:10},(_,i)=>({id:'u'+i,stage:'delivery',members:1,releaseDay:0}));
 const centre={delivery:Array.from({length:14},(_,i)=>i%7<5?600:0),cc:Array(14).fill(0)};      // ample minutes on weekdays
 const base={...assumptions({weeks:2,deliveryHours:0,ccHours:0,sessionsPerFacilitatorPerDay:2}),centre,facilitators:2};
 const r=sim(snapshot(units),base);
 assert.deepEqual([0,1,2].map(d=>r.days[d].delivered),[4,8,10]);                         // 2 facilitators x 2 sessions = 4 a day
 assert.equal(sim(snapshot(units),{...base,facilitators:5}).days[0].delivered,10);        // 5 facilitators clear it in a day
 assert.equal(sim(snapshot(units),{...base,deliveryHours:3}).days[0].delivered,5);        // 3 extra hours a week = 0.6 more sessions a day, rounded up
 const noPeople=sim(snapshot(units),{...assumptions({weeks:2,deliveryHours:0,ccHours:0}),centre});assert.equal(noPeople.days[0].delivered,10); // no headcount known: only minutes limit
 assert.equal(sim(snapshot(units),{...base,facilitators:0}).sessionsDelivered,0);          // nobody to deliver
 assert.throws(()=>sim(snapshot(units),{...base,facilitators:-1}),/facilitators/);
});
test('new SMEs join in weekly batches and their interventions open along the pilot curve',()=>{
 const {simulate:sim}=loadTs('src/services/digitalTwin/simulation.ts'),{newSmeInterventionsBy:curve,PILOT}=loadTs('src/services/digitalTwin/pilotCalibration.ts');
 assert.equal(curve(0),0);assert.equal(curve(14),PILOT.departmentsPerSme*1.0);
 assert.ok(Math.abs(curve(28)-7.2)<1e-9);assert.ok(Math.abs(curve(84)-10.8)<1e-9);assert.ok(Math.abs(curve(1000)-11.4)<1e-9); // flat after six months
 const big=assumptions({weeks:13,deliveryHours:400,hodWindows:5,hodWindowMinutes:480,reviewMinutes:1,ccHours:200,meHours:200,intakeWeeks:2,intake:3});
 const r=sim(snapshot([]),big);
 // 3 SMEs in two batches: 2 on day 0 and 1 on day 7. Horizon is 91 days.
 assert.equal(r.demand,Math.floor(2*curve(90)+1e-9)+Math.floor(1*curve(83)+1e-9));
 assert.equal(r.days[0].backlog,0);                                                      // nothing has opened on the day they join
 assert.ok(r.days[6].backlog>0&&r.days[6].backlog<=Math.ceil(2*curve(6)));
 assert.equal(JSON.stringify(sim(snapshot([]),big).days),JSON.stringify(r.days));         // deterministic
 assert.equal(r.verified+r.backlog,r.demand);
 assert.equal(sim(snapshot([]),{...big,intake:0}).demand,0);
});
test('new work needs the recent mix of sessions: about 1.5 an intervention',()=>{
 const {simulate:sim}=loadTs('src/services/digitalTwin/simulation.ts'),{PILOT,meanSessions}=loadTs('src/services/digitalTwin/pilotCalibration.ts');
 assert.ok(Math.abs(meanSessions(PILOT.sessionsMix)-1.5)<0.05);
 const snap={...snapshot([]),sessionMix:PILOT.sessionsMix.map(m=>({...m}))};
 const r=sim(snap,assumptions({weeks:13,inflowPerWeek:10,deliveryHours:400,daysBetweenSessions:1,sessionsPerFacilitatorPerDay:20}));
 assert.equal(r.demand,130);assert.ok(r.delivered>=120);
 const ratio=r.sessionsDelivered/r.delivered;assert.ok(ratio>1.35&&ratio<1.65,'mean sessions '+ratio);
 const single=sim(snapshot([]),assumptions({weeks:13,inflowPerWeek:10,deliveryHours:400}));
 assert.equal(single.sessionsDelivered,single.delivered);                                 // no mix given: one session each
});
test('capture reads planned sessions and falls back to the pilot mix until this programme has enough history',()=>{
 const {PILOT}=loadTs('src/services/digitalTwin/pilotCalibration.ts');
 const inDelivery=(id,planned,assignedAt)=>({id,programId:'p',branchId:'b',participantAcceptanceStatus:'accepted',assigneeCompletionStatus:'pending',participantCompletionStatus:'pending',assignmentStatus:'in-progress',plannedSessions:planned,assignedAt:new Date(assignedAt)});
 const source=emptySources();source.assignedInterventions=[inDelivery('one',undefined,monday),inDelivery('three',3,monday),inDelivery('big',40,monday)];
 const thin=captureSimulation(buildProcessTwin(source,{programId:'p'},monday),'scope',monday);
 const need=Object.fromEntries(thin.units.map(u=>[u.id,u.sessions]));
 assert.deepEqual(need,{'assignment:one':1,'assignment:three':3,'assignment:big':12});   // missing means one; capped at twelve
 assert.equal(thin.sessionMixSource,'pilot');assert.deepEqual(thin.sessionMix,PILOT.sessionsMix.map(m=>({...m})));
 const rich=emptySources();rich.assignedInterventions=Array.from({length:30},(_,i)=>({id:'r'+i,programId:'p',branchId:'b',assignmentStatus:'completed',plannedSessions:i%3===0?2:1,assignedAt:new Date(monday-2*864e5)}));
 const own=captureSimulation(buildProcessTwin(rich,{programId:'p'},monday),'scope',monday);
 assert.equal(own.sessionMixSource,'recent');assert.deepEqual(own.sessionMix,[{key:'1',weight:20},{key:'2',weight:10}]);
 assert.notEqual(thin.id,own.id);
});
test('centre capacity follows the centre calendar: people x opening hours x share, Saturdays when open, operations staff excluded',()=>{
 const {buildCentreCapacity,weeklyOpenHours,describeHours,recentFacilitators}=loadTs('src/services/digitalTwin/centreCapacity.ts');
 const {simulate:sim,DEFAULT_ASSUMPTIONS:D}=loadTs('src/services/digitalTwin/simulation.ts');
 const day=(closed,opens='07:00',closes='15:00')=>({closed,opens,closes});
 const week=(sat)=>({monday:day(false),tuesday:day(false),wednesday:day(false),thursday:day(false),friday:day(false),saturday:sat,sunday:day(true)});
 const hours=week(day(true));
 assert.equal(weeklyOpenHours(hours),40);assert.equal(describeHours(hours),'Mon–Fri 07:00–15:00');
 const cap=buildCentreCapacity([{hours,facilitators:2,centreCoordinators:1}],monday,14,0.5);
 assert.equal(cap.delivery[0],480);assert.equal(cap.cc[0],240);assert.equal(cap.delivery[5],0);assert.equal(cap.delivery[6],0);assert.equal(cap.delivery[7],480);
 // A Saturday-open centre adds delivery capacity on Saturdays.
 const sat=buildCentreCapacity([{hours:week(day(false,'08:00','12:00')),facilitators:1,centreCoordinators:1}],monday,7,1);assert.equal(sat.delivery[5],240);
 // The simulation honours the calendar: with 1 coordinator on 8h days and 60 min sessions, two interventions' 16 SMEs are limited only by capacity.
 const units=Array.from({length:16},(_,i)=>({id:'u'+i,stage:'delivery',members:1,releaseDay:0,key:'k'+i}));
 const base={...assumptions({weeks:2,deliveryHours:0,ccHours:0}),centre:buildCentreCapacity([{hours,facilitators:1,centreCoordinators:1}],monday,14,1)};
 const r=sim(snapshot(units),base);assert.equal(r.days[0].delivered,8);assert.equal(r.days[1].delivered,16);
 const sat2=sim(snapshot(units),{...base,centre:buildCentreCapacity([{hours:week(day(false)),facilitators:1,centreCoordinators:1}],monday,14,1)});assert.ok(sat2.days[5].delivered>=r.days[5].delivered);
 assert.throws(()=>sim(snapshot(units),{...base,centre:{delivery:[1],cc:[1]}}));
 // Facilitators are counted per centre from recent sessions/assignments and exclude operations-role assignees.
 const now=Date.parse('2026-06-01T00:00:00Z'),d=(n)=>new Date(now-n*864e5).toISOString();
 const counted=recentFacilitators({sessions:[{branchId:'b1',assigneeId:'u1',assigneeRole:'coordinator',startAt:d(3)},{branchId:'b1',assigneeId:'u1',startAt:d(5)},{branchId:'b1',assigneeId:'ops',assigneeRole:'operations',startAt:d(4)},{branchId:'b1',assigneeId:'old',startAt:d(400)}],assignments:[{branchId:'b1',assigneeId:'u2',assignedAt:d(10)},{branchId:'b2',assigneeId:'u3',assignedAt:d(10)}]},now);
 assert.equal(counted.get('b1'),2);assert.equal(counted.get('b2'),1);
});
test('run summary: end position, busiest team and peak day, with ties and edge cases handled',()=>{
 const {summariseRun,busiestTeam}=loadTs('src/services/digitalTwin/runSummary.ts');
 const day=(date,backlog,queues={})=>({date,backlog,queues:{delivery:0,hod:0,cc:0,me:0,...queues}});
 const run=(days,used,available)=>({days,minutesUsed:{delivery:0,hod:0,cc:0,me:0,...used},minutesAvailable:{delivery:0,hod:0,cc:0,me:0,...available}});
 const base=run([day('2026-01-05',10),day('2026-01-06',14,{cc:14}),day('2026-01-07',14,{cc:14}),day('2026-01-08',9,{cc:9})],{delivery:30,cc:100,me:50},{delivery:100,cc:100,me:100});
 const change=run([day('2026-01-05',10),day('2026-01-06',12),day('2026-01-07',6),day('2026-01-08',2,{me:2})],{delivery:30,cc:60,me:90},{delivery:100,cc:120,me:100});
 const r=summariseRun(base,change);
 assert.deepEqual(r.endOpen,{ifNothingChanges:9,withChange:2});
 assert.equal(r.busiest.stage,'me');assert.equal(r.busiest.percentBusy,90);               // with the change M&E is closest to its limit
 assert.equal(r.busiestIfNothingChanges.stage,'cc');assert.equal(r.busiestIfNothingChanges.percentBusy,100);
 assert.deepEqual(r.peak.ifNothingChanges,{open:14,dayIndex:1,date:'2026-01-06'});         // the first day the peak is reached
 assert.deepEqual(r.peak.withChange,{open:12,dayIndex:1,date:'2026-01-06'});
 // Tie at 100%: the team with more work still waiting is reported.
 const tie=run([day('2026-01-05',5,{hod:1,cc:4})],{hod:50,cc:50},{hod:50,cc:50});assert.equal(busiestTeam(tie).stage,'cc');
 // A team with work waiting but no time at all outranks every busy team.
 const none=run([day('2026-01-05',3,{me:3})],{cc:100},{cc:100});assert.equal(busiestTeam(none).stage,'me');assert.equal(busiestTeam(none).noCapacity,true);assert.equal(busiestTeam(none).percentBusy,null);
 // Nothing worked on: no busiest team.
 assert.equal(busiestTeam(run([day('2026-01-05',0)],{},{delivery:100})),null);
 // Consistency with a real run.
 const {simulate:sim}=loadTs('src/services/digitalTwin/simulation.ts');
 const real=sim(snapshot(Array.from({length:40},(_,i)=>({id:'c'+i,stage:'cc',members:1,releaseDay:0}))),assumptions({weeks:2,ccHours:2.5,meHours:50}));
 const s=summariseRun(real,real);assert.equal(s.busiest.stage,'cc');assert.equal(s.busiest.percentBusy,100);assert.equal(s.peak.withChange.open,40);assert.equal(s.endOpen.withChange,real.days.at(-1).backlog);
});
