const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('../../../scripts/digital-twin/validate.cjs');
const {parseScenarioIntent,normaliseIntent}=loadTs('src/services/digitalTwin/scenarioIntent.ts');
const ctx={hoursPerCentreStaff:35,hoursPerMe:40,hodWindows:2};
const read=text=>parseScenarioIntent(text,ctx);
test('hours, people, days and SMEs are read into the right levers',()=>{
    assert.deepEqual(read('add 8 facilitator hours').levers,{hours:8});
    assert.deepEqual(read('2 more centre coordinators').levers,{cc:70});
    assert.deepEqual(read('1 more hour for M&E').levers,{me:1});
    assert.deepEqual(read('30 new SMEs').levers,{intake:30});
    assert.deepEqual(read('HOD reviews 3 days a week').levers,{hod:3});
    assert.deepEqual(read('one more review day').levers,{hod:3},'"more" adds to today');
});
test('a horizon is taken from weeks or months and removed from the rest of the sentence',()=>{
    const i=read('20 new SMEs over 12 weeks');
    assert.equal(i.weeks,12);assert.deepEqual(i.levers,{intake:20});
    assert.equal(read('next 3 months').weeks,12);
    assert.equal(read('8 hours a week').weeks,undefined,'"a week" is a rate, not a horizon');
});
test('several changes in one sentence, with the conversion stated',()=>{
    const i=read('add 8 facilitator hours, 1 more centre coordinator and two new SMEs over 8 weeks');
    assert.deepEqual(i.levers,{hours:8,cc:35,intake:2});assert.equal(i.weeks,8);
    assert.ok(i.understood.some(u=>/≈ \+35 hours a week/.test(u)),'people are shown as the hours they were turned into');
});
test('anything it cannot use is reported, never guessed',()=>{
    const i=read('make everything faster');
    assert.deepEqual(i.levers,{});assert.deepEqual(i.ignored,['make everything faster']);
    assert.match(read('2 more sessions a week').ignored[0],/sessions are not a lever/);
    assert.deepEqual(read('add 9999 facilitator hours').levers,{hours:160},'limited to what the page allows');
});

test('an answer from the assistant is checked before it is used',()=>{
    const i=normaliseIntent({levers:{hours:9999,cc:'x',bogus:5,hod:3,intake:-4},weeks:400,understood:['+8 hours',7,' '],ignored:['not a change']});
    assert.deepEqual(i.levers,{hours:160,hod:3,intake:0},'unknown or non-numeric levers are dropped and the rest are limited');
    assert.equal(i.weeks,26);assert.deepEqual(i.understood,['+8 hours']);assert.deepEqual(i.ignored,['not a change']);
    assert.deepEqual(normaliseIntent(null),{levers:{},weeks:undefined,understood:[],ignored:[]});
});
