const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('../../../scripts/digital-twin/validate.cjs');
const {buildFacts,ruleSummary}=loadTs('src/services/digitalTwin/projectionSummary.ts');
// A minimal result: only what the summary reads (daily backlog, end queues, minutes used and available).
const result=(backlogs,queues,used)=>({days:backlogs.map((b,i)=>({date:`2026-10-${String(12+i).padStart(2,'0')}`,backlog:b,queues:i===backlogs.length-1?queues:{delivery:0,hod:0,cc:0,me:0}})),minutesUsed:used,minutesAvailable:{delivery:100,hod:100,cc:100,me:100}});
const base=result([6,5,4],{delivery:0,hod:0,cc:0,me:4},{delivery:0,hod:0,cc:0,me:100});
const better=result([6,3,0],{delivery:0,hod:0,cc:0,me:0},{delivery:0,hod:0,cc:40,me:60});
test('facts hold only numbers and short labels, with the differences worked out',()=>{
    const f=buildFacts(base,better,['+8 facilitator hours a week'],8);
    assert.equal(f.ifNothing.endOpen,4);assert.equal(f.withChange.endOpen,0);assert.equal(f.endDifference,-4);
    assert.equal(f.ifNothing.busiestTeam,'M&E quality check');assert.equal(f.ifNothing.busiestPercent,100);
    assert.equal(f.withChange.clearsOn,'14 Oct');assert.equal(f.ifNothing.clearsOn,null);
    assert.equal(f.ifNothing.peakOpen,6);assert.equal(f.ifNothing.peakDate,'12 Oct');
    assert.ok(!JSON.stringify(f).match(/Enterprise|participant/i),'no record names');
});
test('the built-in wording says only what the numbers say',()=>{
    const none=ruleSummary(buildFacts(base,base,[],8));
    assert.match(none,/If nothing changes, 4 open interventions are left after 8 weeks/);assert.match(none,/Turn a dial/);
    const changed=ruleSummary(buildFacts(base,better,['+8 facilitator hours a week'],8));
    assert.match(changed,/With \+8 facilitator hours a week, 0 open interventions are left after 8 weeks: 4 fewer than the 4 left if nothing changes\./);
    assert.match(changed,/Everything clears on 14 Oct/);
    const worse=ruleSummary(buildFacts(base,result([6,8,9],{delivery:0,hod:0,cc:0,me:9},{delivery:0,hod:0,cc:0,me:100}),['30 new SMEs'],8));
    assert.match(worse,/5 more than the 4 left if nothing changes/);
});
