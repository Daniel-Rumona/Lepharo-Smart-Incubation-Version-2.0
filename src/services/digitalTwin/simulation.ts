import { resolveAssignmentLifecycle } from '../assignmentLifecycleService'
import { millis, type ProcessModel } from './processTwin'
import { PILOT, newSmeInterventionsBy } from './pilotCalibration'

export const SIMULATION_VERSION = 'pooled-process-capacity-2.0'
export type WorkStage = 'delivery'|'hod'|'cc'|'me'
export const WORK_STAGES:WorkStage[] = ['delivery','hod','cc','me']
/** One intervention for one SME (or one shared session for several SMEs) moving through delivery, then its evidence reviews. */
export type WorkUnit = {id:string;stage:WorkStage;members:number;releaseDay:number;sessions?:number}
export type SessionMix = Array<{key:string;weight:number}>
export type SimulationSnapshot = {id:string;modelVersion:string;capturedAt:number;startAt:number;scope:string;units:WorkUnit[];excluded:Record<string,number>;synthetic:boolean;sessionMix?:SessionMix;sessionMixSource?:'recent'|'pilot'}
export type Assumptions = {weeks:number;deliveryHours:number;serviceMinutes:number;hodWindows:number;hodWindowMinutes:number;reviewMinutes:number;ccHours:number;meHours:number;intake:number;intakeWeeks:number;inflowPerWeek:number;daysBetweenSessions:number;sessionsPerFacilitatorPerDay:number;closedDates:string[];centre?:{delivery:number[];cc:number[]};facilitators?:number}
export const DEFAULT_ASSUMPTIONS:Assumptions = {weeks:8,deliveryHours:16,serviceMinutes:60,hodWindows:2,hodWindowMinutes:60,reviewMinutes:15,ccHours:2,meHours:2,intake:0,intakeWeeks:4,inflowPerWeek:0,daysBetweenSessions:PILOT.daysBetweenSessions,sessionsPerFacilitatorPerDay:PILOT.sessionsPerFacilitatorPerDay,closedDates:[]}
const DAY=86400000, OFFSET=7200000
/** Deterministic weighted rotation, so new work needs the recent mix of sessions without any randomness. */
function makePicker(mix?:SessionMix){
    const list=mix&&mix.length?mix:[{key:'1',weight:1}],total=list.reduce((n,m)=>n+m.weight,0)||1,credit=list.map(()=>0)
    return ():number=>{list.forEach((m,i)=>{credit[i]+=m.weight/total});let best=0;credit.forEach((c,i)=>{if(c>credit[best]+1e-12)best=i});credit[best]-=1;return Number(list[best].key)}
}
const sessionsNeeded=(planned:unknown)=>Math.min(12,Math.max(1,Math.round(Number(planned)||1)))
const dayStart=(at:number)=>Math.floor((at+OFFSET)/DAY)*DAY-OFFSET
const dateKey=(at:number)=>new Date(at+OFFSET).toISOString().slice(0,10)
export function fingerprint(value:unknown):string {let h=2166136261;for(const c of JSON.stringify(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}

/** Copies only work demand and provenance. Never retains mutable operational records. */
export function captureSimulation(model:ProcessModel,scope:string,now:number):SimulationSnapshot {
    const units:WorkUnit[]=[],excluded:Record<string,number>={}
    const skip=(why:string)=>{excluded[why]=(excluded[why]||0)+1}
    const startAt=dayStart(now)
    const movAssignments=new Set(model.movs.map(m=>m.assignedInterventionId))
    const grouped=new Map<string,WorkUnit>()
    for(const a of model.assignments){
        if(movAssignments.has(a.id))continue
        const lifecycle=resolveAssignmentLifecycle(a)
        if(lifecycle.key!=='in-delivery'){skip(lifecycle.isCompleted?'Completed without review-ready evidence':`Awaiting action: ${lifecycle.label}`);continue}
        const appointments=model.appointments.filter(p=>p.assignedInterventionId===a.id)
        const needed=sessionsNeeded(a.plannedSessions)
        // Sessions already attended come off the total: an intervention stays in Delivery until every planned session is done.
        const attendedCount=new Set(appointments.filter(p=>p.attendance?.status==='attended').map(p=>p.appointmentSessionId||p.id)).size
        if(attendedCount>=needed&&attendedCount>0){skip('Attendance recorded; facilitator action remains');continue}
        const remaining=Math.max(1,needed-attendedCount)
        const planned=appointments.filter(p=>p.status!=='cancelled'&&p.smeConfirmation!=='declined'&&p.attendance?.status!=='attended').map(p=>model.sessions.find(s=>s.id===p.appointmentSessionId)).filter(Boolean).sort((x,y)=>(millis(x!.startAt)||0)-(millis(y!.startAt)||0))[0]
        const id=planned?.sessionType==='group'?`session:${planned.id}`:`assignment:${a.id}`
        const releaseDay=Math.max(0,Math.floor(((millis(planned?.startAt)||startAt)-startAt)/DAY))
        const unit=grouped.get(id)
        if(unit){unit.members++;unit.sessions=Math.max(unit.sessions||1,remaining)}
        else grouped.set(id,{id,stage:'delivery',members:1,releaseDay,sessions:remaining})
    }
    units.push(...grouped.values())
    for(const item of model.items.filter(i=>i.collection==='movDocuments')){
        const stage:WorkStage|undefined = item.stage==='awaiting_hod'?'hod':['hod_approved','in_pack'].includes(item.stage)?'cc':item.stage==='cc_confirmed'?'me':undefined
        if(stage)units.push({id:`mov:${item.id}`,stage,members:1,releaseDay:0})
        else if(!['me_validated','invoice_redeemable'].includes(item.stage))skip(`Evidence not ready: ${item.state}`)
    }
    units.sort((a,b)=>a.id.localeCompare(b.id))
    // How many sessions new work will need: the mix on this programme's own recent assignments, or the pilot's while there is too little history.
    const counts=new Map<number,number>()
    for(const a of model.assignments){const at=millis(a.assignedAt),n=Number(a.plannedSessions);if(at!==null&&at>=now-84*DAY&&at<=now&&n>0)counts.set(sessionsNeeded(n),(counts.get(sessionsNeeded(n))||0)+1)}
    const recent=[...counts.values()].reduce((x,y)=>x+y,0)>=20
    const sessionMix:SessionMix=recent?[...counts].sort((x,y)=>x[0]-y[0]).map(([k,weight])=>({key:String(k),weight})):PILOT.sessionsMix.map(m=>({...m}))
    const payload={modelVersion:SIMULATION_VERSION,startAt,scope,units,excluded,synthetic:model.syntheticCount>0,sessionMix,sessionMixSource:recent?'recent' as const:'pilot' as const}
    return {...payload,id:fingerprint(payload),capturedAt:now}
}

export function validateAssumptions(a:Assumptions){
    const ranges:Record<keyof Omit<Assumptions,'closedDates'|'centre'|'facilitators'>,[number,number,boolean]>={weeks:[1,26,true],deliveryHours:[0,400,false],serviceMinutes:[1,480,false],hodWindows:[0,5,true],hodWindowMinutes:[0,480,false],reviewMinutes:[1,240,false],ccHours:[0,200,false],meHours:[0,200,false],intake:[0,300,true],intakeWeeks:[1,26,true],inflowPerWeek:[0,200,false],daysBetweenSessions:[1,60,true],sessionsPerFacilitatorPerDay:[1,20,true]}
    for(const [key,[min,max,integer]] of Object.entries(ranges)){const value=a[key as keyof typeof ranges];if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new Error(`Invalid assumption: ${key}`)}
    if(a.facilitators!==undefined&&(!Number.isInteger(a.facilitators)||a.facilitators<0||a.facilitators>500))throw new Error('Invalid assumption: facilitators')
    if(a.intake>0&&a.intakeWeeks>a.weeks)throw new Error('Intake period must fit within the simulation horizon.')
    if(a.centre)for(const k of ['delivery','cc'] as const){const v=a.centre[k];if(!Array.isArray(v)||v.length<a.weeks*7||v.some(x=>!Number.isFinite(x)||x<0))throw new Error('Invalid centre capacity calendar.')}
    if(!Array.isArray(a.closedDates)||a.closedDates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new Error('Closed dates must use valid YYYY-MM-DD dates.')
}
export type SimulationDay = {day:number;date:string;backlog:number;verified:number;delivered:number;queues:Record<WorkStage,number>}
export function simulate(snapshot:SimulationSnapshot,input:Assumptions){
    validateAssumptions(input)
    if(snapshot.modelVersion!==SIMULATION_VERSION||!Number.isFinite(snapshot.startAt))throw new Error('Unsupported or invalid simulation snapshot.')
    if(snapshot.units.length>5000)throw new Error('This local model supports at most 5,000 initial work units. Narrow the scope.')
    for(const u of snapshot.units)if(!WORK_STAGES.includes(u.stage)||!Number.isInteger(u.members)||u.members<1||u.members>3000||(u.stage!=='delivery'&&u.members!==1)||!Number.isInteger(u.releaseDay)||u.releaseDay<0||(u.sessions!==undefined&&(!Number.isInteger(u.sessions)||u.sessions<1||u.sessions>12)))throw new Error('Invalid simulation work unit.')
    const a={...input,closedDates:[...input.closedDates]}, units=snapshot.units.map(u=>({...u})), nextSessions=makePicker(snapshot.sessionMix), horizon=a.weeks*7
    // New SMEs join in weekly batches. Each batch's interventions are released along the pilot's measured opening curve:
    // roughly one per department in the first fortnight, then slowly, about 11 per SME by six months.
    if(a.intake>0){
        const base=Math.floor(a.intake/a.intakeWeeks),spare=a.intake%a.intakeWeeks
        for(let batch=0;batch<a.intakeWeeks;batch++){
            const smes=base+(batch<spare?1:0),start=batch*7;let released=0
            for(let d=1;smes>0&&start+d<horizon;d++){
                const target=Math.floor(smes*newSmeInterventionsBy(d)+1e-9)
                while(released<target){units.push({id:`new:${batch}:${released}`,stage:'delivery',members:1,releaseDay:start+d,sessions:nextSessions()});released++}
            }
        }
    }
    // Expected new work keeps arriving on weekdays at a steady rate (fractional rates accumulate deterministically).
    for(let day=0,acc=0,k=0;day<horizon&&a.inflowPerWeek>0;day++){
        const weekday=new Date(snapshot.startAt+day*DAY+OFFSET).getUTCDay()
        if(weekday===0||weekday===6)continue
        acc+=a.inflowPerWeek/5
        while(acc>=1-1e-9){units.push({id:`inflow:${k++}`,stage:'delivery',members:1,releaseDay:day,sessions:nextSessions()});acc-=1}
    }
    const demand=units.reduce((n,u)=>n+u.members,0)
    if(demand>5300)throw new Error('This local model supports at most 5,300 open interventions including new SMEs. Narrow the scope.')
    if(new Set(units.map(u=>u.id)).size!==units.length)throw new Error('Duplicate simulation work-unit IDs.')
    type Job=WorkUnit & {remaining:number;readyDay:number;enteredDay:number;started:boolean;sessionsLeft:number}
    const jobs:Job[]=units.map(u=>({...u,remaining:u.stage==='delivery'?a.serviceMinutes:a.reviewMinutes,readyDay:u.releaseDay,enteredDay:u.releaseDay,started:false,sessionsLeft:u.stage==='delivery'?Math.max(1,u.sessions||1):0}))
    const minutesUsed:Record<WorkStage,number>={delivery:0,hod:0,cc:0,me:0},minutesAvailable={...minutesUsed}
    let verified=0,delivered=0,sessionsDelivered=0,totalWaiting=0,startedJobs=0
    const reviewDays=Array.from({length:a.hodWindows},(_,i)=>Math.ceil((i+1)*5/a.hodWindows))
    const capped=!!a.centre&&a.facilitators!==undefined
    const days:SimulationDay[]=[]
    for(let day=0;day<horizon;day++){
        const date=dateKey(snapshot.startAt+day*DAY), weekday=new Date(snapshot.startAt+day*DAY+OFFSET).getUTCDay()
        // Centre staff (coordinators, centre coordinators) can follow the centre's own calendar, which may include Saturdays; HOD and M&E (operations staff) stay on weekdays.
        const closed=a.closedDates.includes(date),weekdayOpen=weekday>0&&weekday<6&&!closed
        const centreDelivery=a.centre&&!closed?a.centre.delivery[day]||0:0,centreCc=a.centre&&!closed?a.centre.cc[day]||0:0
        if(weekdayOpen||centreDelivery>0||centreCc>0){
            const extra=weekdayOpen?1:0
            const budgets={delivery:centreDelivery+extra*a.deliveryHours*60/5,hod:weekdayOpen&&reviewDays.includes(weekday)?a.hodWindowMinutes:0,cc:centreCc+extra*a.ccHours*60/5,me:extra*a.meHours*60/5}
            // Sessions a day are also limited by people: each facilitator runs a few sessions a day (pilot: up to about 4), plus whatever extra hours can buy.
            const sessionCap=capped?Math.ceil((centreDelivery>0?a.facilitators!*a.sessionsPerFacilitatorPerDay:0)+extra*(a.deliveryHours*60/5)/a.serviceMinutes-1e-9):Infinity
            const sessionsToday=new Set<string>()
            for(const stage of WORK_STAGES){
                let available=budgets[stage];minutesAvailable[stage]+=available
                const eligible=jobs.filter(j=>j.stage===stage&&j.readyDay<=day).sort((x,y)=>x.readyDay-y.readyDay||x.id.localeCompare(y.id))
                for(const job of eligible){
                    if(available<=1e-8)break
                    if(stage==='delivery'&&!sessionsToday.has(job.id)){if(sessionsToday.size>=sessionCap)continue;sessionsToday.add(job.id)}
                    if(!job.started){totalWaiting+=Math.max(0,day-job.enteredDay);startedJobs++;job.started=true}
                    const used=Math.min(available,job.remaining);job.remaining-=used;available-=used;minutesUsed[stage]+=used
                    if(job.remaining>1e-8)continue
                    if(stage==='delivery'){
                        // A session is done. An intervention needing more sessions waits out the gap before the next one.
                        sessionsDelivered++;job.sessionsLeft--
                        if(job.sessionsLeft>0){job.remaining=a.serviceMinutes;job.readyDay=day+a.daysBetweenSessions;continue}
                    }
                    jobs.splice(jobs.indexOf(job),1)
                    if(stage==='me'){verified+=job.members;continue}
                    const next=WORK_STAGES[WORK_STAGES.indexOf(stage)+1]
                    if(stage==='delivery')delivered+=job.members
                    // Every SME needs its own evidence review after a shared delivery.
                    for(let member=0;member<job.members;member++)jobs.push({id:`${job.id}/${next}/${member}`,stage:next,members:1,releaseDay:job.releaseDay,remaining:a.reviewMinutes,readyDay:day+1,enteredDay:day+1,started:false,sessionsLeft:0})
                }
            }
        }
        // Daily view counts only work that has arrived by this day; not-yet-released bookings, new SMEs and new work are not waiting yet.
        const arrived=jobs.filter(j=>j.releaseDay<=day)
        const queues=Object.fromEntries(WORK_STAGES.map(stage=>[stage,arrived.filter(j=>j.stage===stage).reduce((n,j)=>n+j.members,0)])) as Record<WorkStage,number>
        days.push({day,date,backlog:arrived.reduce((n,j)=>n+j.members,0),verified,delivered,queues})
    }
    const backlog=jobs.reduce((n,j)=>n+j.members,0)
    if(backlog+verified!==demand)throw new Error('Work conservation failed.')
    return {version:SIMULATION_VERSION,snapshotId:snapshot.id,demand,verified,backlog,delivered,sessionsDelivered,meanStartedQueueWaitDays:startedJobs?totalWaiting/startedJobs:null,minutesUsed,minutesAvailable,days}
}
export type SimulationResult=ReturnType<typeof simulate>

export type ObservedDelivery = {sessions:number;weeks:number;medianMinutes:number;avgHoursPerWeek:number;peakHoursPerWeek:number}
/**
 * Delivery figures taken from completed appointment sessions in the last `weeks` weeks (a shared session counts once).
 * Observed hours are time actually used, so the busiest week is the best available proxy for capacity, not a measure of it.
 * Review time cannot be derived: nothing records time spent reviewing evidence.
 */
export function observedDelivery(sessions:Array<Record<string,any>>,now:number,weeks=12):ObservedDelivery|null{
    const from=now-weeks*7*DAY,minutes:number[]=[],perWeek=new Map<number,number>()
    for(const s of sessions){
        if(s.status!=='completed')continue
        const start=millis(s.startAt),end=millis(s.endAt)
        if(start===null||end===null||start<from||start>now||end<=start)continue
        const length=(end-start)/60000
        if(length<5||length>480)continue
        minutes.push(length)
        const week=Math.floor((start-from)/(7*DAY))
        perWeek.set(week,(perWeek.get(week)||0)+length)
    }
    if(minutes.length<5)return null
    minutes.sort((a,b)=>a-b)
    const median=minutes.length%2?minutes[(minutes.length-1)/2]:(minutes[minutes.length/2-1]+minutes[minutes.length/2])/2
    const total=minutes.reduce((a,b)=>a+b,0)
    return {sessions:minutes.length,weeks,medianMinutes:Math.round(median),avgHoursPerWeek:Math.round(total/weeks/60*10)/10,peakHoursPerWeek:Math.round(Math.max(...perWeek.values())/60*10)/10}
}

export type ObservedInflow = {perWeek:number;count:number;weeks:number}
/** Average new assignments per week over the last N weeks (12 by default), from explicit assignment dates only. */
export function observedInflow(assignments:Array<Record<string,any>>,now:number,weeks=12):ObservedInflow{
    const from=now-weeks*7*DAY
    const count=assignments.filter(a=>{const at=millis(a.assignedAt);return at!==null&&at>=from&&at<=now}).length
    return {perWeek:Math.round(count/weeks*10)/10,count,weeks}
}
