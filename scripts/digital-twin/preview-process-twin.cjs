// Isolated browser fixture for the real page. No credentials or Firebase network calls.
// Usage: node scripts/digital-twin/preview-process-twin.cjs <absolute path to playwright package>
require('../node26-shim.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {generate,encode,RUN}=require('./dataset.cjs');
const {build}=require('./seed-walkins.cjs');
async function main(){
    const root=path.resolve(__dirname,'../..'), out=path.join(root,'tmp/process-twin-preview'), artifacts=path.join(root,'artifacts/digital-twin');
    fs.mkdirSync(out,{recursive:true});fs.mkdirSync(artifacts,{recursive:true});
    const fixture=generate(), rows=[...fixture.records,...build(fixture.records).records,...(process.env.TWIN_REMOTE?require('./seed-remote.cjs').build(fixture.records).records:[])];
    const sources={};for(const r of rows){const collection=r.path.split('/')[0];(sources[collection]??=[]).push(r.data)}
    // Centre operating hours and a centre coordinator (projectadmin) per branch; Springs also opens on Saturday mornings.
    const {BRANCHES}=require('./dataset.cjs'),day=(closed,opens='07:00',closes='15:00')=>({closed,opens,closes}),week=sat=>({monday:day(false),tuesday:day(false),wednesday:day(false),thursday:day(false),friday:day(false),saturday:sat,sunday:day(true)});
    sources.branches=BRANCHES.map((b,i)=>({id:b.id,name:b.name,operatingHours:week(i===1?day(false,'08:00','12:00'):day(true))}));
    sources.users=BRANCHES.map(b=>({id:'pa_'+b.id,role:'projectadmin',assignedBranch:b.id}));
    const data=JSON.stringify(encode(sources));
    const mocks={
        '@/hooks/useFullIdentity':`export const useFullIdentity=()=>({user:window.testUser||{uid:'preview',role:'projectadmin',assignedBranch:'yYA7BNWDc6muS0FnhiaO'}})`,
        '@/firebase':`export const db={}; export const functions={}`,
        'firebase/auth':`export const getAuth=()=>({currentUser:null})`,
        'firebase/functions':`export const httpsCallable=(f,name)=>async data=>{(window.__reminders=window.__reminders||[]).push({name,data});return{data:{owner:'SME',audience:'SME'}}}`,
        'firebase/firestore':`export const doc=(db,name,id)=>({name,id}); export const getDoc=async q=>{const row=(window.fixture[q.name]||[]).find(r=>r.id===q.id);return{exists:()=>!!row,id:q.id,data:()=>row}}; export const collection=(db,name)=>name; export const where=(...args)=>args; export const query=(name,...constraints)=>({name,constraints}); export const getDocs=async q=>{if(location.search.includes('headcountError')&&['coordinators','users'].includes(q.name))throw new Error('permission-denied');return({docs:(window.fixture[q.name]||[]).filter(r=>q.constraints.every(([field,op,value])=>{const v=field.split('.').reduce((x,k)=>x?.[k],r);return op==='array-contains'?Array.isArray(v)&&v.includes(value):v===value})).map(r=>({id:r.id,data:()=>r}))})}; export const onSnapshot=(q,options,next,error)=>{let active=true; const timer=setTimeout(async()=>{if(!active)return;if(window.testError){error(new Error('fixture denied'));return}const snap=await getDocs(q);if(active)next({...snap,metadata:{fromCache:false}})},25);return()=>{active=false;clearTimeout(timer)}};`,
    };
    await require('esbuild').build({absWorkingDir:root,stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Page from './src/routes/oversight/digital-twin';import {GuideProvider,GuideLauncher} from './src/components/guide-me';import {ThemeProvider} from './src/contexts/ThemeContext';import 'antd/dist/reset.css';window.__ACTIVE_PROGRAM_ID__=window.__ACTIVE_PROGRAM_ID__||'dtseed_20261009_v1_program_0';window.fixture=JSON.parse(${JSON.stringify(data)},(k,v)=>v&&v.$timestamp?new Date(v.$timestamp):v);createRoot(document.getElementById('root')).render(<ThemeProvider><BrowserRouter><GuideProvider><div style={{padding:8,textAlign:"right"}}><GuideLauncher/></div><Page/></GuideProvider></BrowserRouter></ThemeProvider>);`,loader:'tsx',resolveDir:root},bundle:true,outfile:path.join(out,'main.js'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-fixture',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'ts',resolveDir:root}))}}],logLevel:'silent'});
    const server=http.createServer((req,res)=>{const filename=req.url==='/main.js'?'main.js':req.url==='/main.css'?'main.css':null;res.setHeader('Content-Type',filename?.endsWith('.js')?'text/javascript':filename?'text/css':'text/html');res.end(filename?fs.readFileSync(path.join(out,filename)):'<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script src="/main.js"></script></body></html>')});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let browser;
    try{
        const {chromium}=require(process.argv[2]||'playwright');
        browser=await chromium.launch({headless:true,channel:'msedge'});
        {const open=browser.newPage.bind(browser);browser.newPage=async(...args)=>{const p=await open(...args);await p.addInitScript(()=>{try{localStorage.setItem('twinTopRow','show')}catch{}});return p}}
        const page=await browser.newPage({viewport:{width:1440,height:1050}}), errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        const base=`http://127.0.0.1:${server.address().port}/projectadmin/digital-twin`, url=`${base}?program=ignored-old-url-scope`;
        const ready=p=>p.getByRole('region',{name:'Intervention overview',exact:true}).waitFor();
        const tab=async(p,name)=>{if(!(await p.locator('.ov-actions').isVisible()))await p.locator('.twin-bar').getByRole('button',{name:/Overview/}).click();await p.locator('.ov-actions').getByRole('button',{name:new RegExp(name)}).click()};
        const chip=(p,text)=>p.locator('.sc-chip',{hasText:text});
        const fits=(p,what)=>p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth).then(over=>assert.equal(over,false,`${what} must fit mobile`));
        const checks={};

        // ---- Current state, app-wide Guide Me, drill-downs ----
        await page.goto(url);await ready(page);
        await page.locator('.ts-module').first().waitFor();
        const place=await page.evaluate(()=>{const w=document.querySelector('.ts-stage').getBoundingClientRect(),c=t=>{const r=[...document.querySelectorAll('.ts-stage .ts-card')].find(e=>e.textContent.includes(t)).getBoundingClientRect();return{centre:(r.left+r.width/2-w.left)/w.width,left:(r.left-w.left)/w.width,right:(r.right-w.left)/w.width}};return{smes:c('SMEs'),hod:c('Head of dept'),cc:c('Centre coordinator')}});
        assert.ok(place.smes.right<place.hod.left&&place.hod.right<place.cc.left,'the SMEs, HOD and CC cards sit side by side without overlapping');assert.ok(place.smes.left>0,'the SMEs card is inside the page');
        assert.equal(await page.locator('.ts-top .ov-alert').count(),1,'the critical notice is a chip in the top row');assert.equal(await page.locator('.ts-stage .ts-alert').count(),0);
        {const ctx=await browser.newContext({viewport:{width:1440,height:1050}}),plain=await ctx.newPage();plain.on('pageerror',e=>errors.push(e.message));await plain.goto(url);await plain.locator('.ts-module').first().waitFor();
        assert.equal(await plain.locator('.ts-top').count(),0,'the view buttons and the notice are hidden for users for now');assert.equal(await plain.locator('.ts-core-delta').innerText(),'','no hint line under the core');assert.equal(await plain.locator('[aria-label="Full screen"]').count(),0,'no full-screen button');
        await plain.waitForTimeout(400);await plain.screenshot({path:path.join(artifacts,'process-twin-overview-user.png'),animations:'disabled'});await ctx.close()}
        assert.equal(await page.locator('.ts-module').count(),4,'four simulated teams around the core');assert.equal(await page.locator('.ts-outside').count(),1,'one step outside the model');assert.equal(await page.locator('.ts-smes').count(),1,'one SMEs card');assert.equal(await page.locator('.ov-team, .ov-look').count(),0,'the cards look is gone');
        assert.equal(await page.locator('.twin-tabs, .twin-header, .twin-bar').count(),0,'the overview has no header or tab bar');assert.equal(await page.locator('.ov-actions button').count(),3,'three view actions above the field');assert.equal(await page.getByText(/Select a team to see who is holding work up/).count(),0);
        await page.screenshot({path:path.join(artifacts,'process-twin-overview.png'),fullPage:true,animations:'disabled'});
        // The notice above the health circle cycles on its own, has no pagination dots, and "Look" opens that intervention with a reminder footer.
        const firstAlert=await page.locator('.ov-alert-text strong').first().innerText();assert.ok(firstAlert.length>5,'a notification is showing above the circle');
        await page.waitForFunction(first=>document.querySelector('.ov-alert-text strong')?.textContent!==first,firstAlert,{timeout:9000});checks.alertCycles=true;
        assert.equal(await page.locator('.ov-alert-dots').count(),0,'no pagination dots');
        await page.getByRole('button',{name:'Look at this intervention'}).click();await page.getByText('Intervention details',{exact:true}).waitFor();
        await page.locator('.iv-foot').waitFor();await page.waitForTimeout(500);
        await page.screenshot({path:path.join(artifacts,'process-twin-detail-compact.png'),animations:'disabled'});
        const remind=page.getByRole('button',{name:/Remind (SME|HOD|CC|M&E|Facilitator)/});assert.equal(await remind.count(),1,'the footer offers a reminder for this stage');await remind.click();await page.getByRole('button',{name:/Reminded today/}).waitFor();
        assert.equal(await page.evaluate(()=>window.__reminders.length),1);assert.equal(await page.evaluate(()=>window.__reminders[0].name),'remindMovOwner');
        await page.locator('.twin-record-modal .ant-modal-close').click();await page.getByText('Intervention details',{exact:true}).waitFor({state:'hidden'});checks.alertOpensDetails=true;checks.reminderSent=true;
        // Nothing on the scene opens on hover or on click except the Needs attention pill.
        const firstPile=page.locator('.ts-module').nth(0);await firstPile.hover({force:true});await page.waitForTimeout(500);assert.equal(await page.locator('.ts-peek, .ant-tooltip:not(.ant-tooltip-hidden)').count(),0,'hovering a pile shows nothing');
        await firstPile.click({force:true});assert.equal(await page.getByRole('dialog').count(),0,'clicking a pile opens no pop-up');assert.equal(await page.locator('button.ts-smes, .ts-smes[role=button]').count(),0,'the SMEs card is not clickable');
        checks.overview=true;
        await page.waitForTimeout(500);await page.screenshot({path:path.join(artifacts,'process-twin-overview-scene.png'),animations:'disabled'});
        // Today is the same in both runs: a dial changes the future, never the starting position.
        const smeDial=page.locator('.ts-intake .ant-slider-handle');await smeDial.focus();await smeDial.press('ArrowRight',{delay:0});for(let i=0;i<24;i++)await smeDial.press('ArrowRight');
        await page.locator('.ts-core-delta').getByText(/Same as if nothing changes/).waitFor();
        const timeline=page.locator('.ts-slide .ant-slider-handle');await timeline.focus();await timeline.press('End');
        await page.locator('.ts-core-delta').getByText(/If nothing changes/).waitFor();
        await page.waitForTimeout(600);await page.screenshot({path:path.join(artifacts,'process-twin-overview-scene-future.png'),animations:'disabled'});
        await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await page.waitForTimeout(300);await page.screenshot({path:path.join(artifacts,'process-twin-overview-scene-dark.png'),animations:'disabled'});await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
        await page.getByRole('button',{name:'Reset dials'}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>/Reset dials/.test(b.textContent))?.disabled);checks.overviewScene=true;
        assert.equal(await page.getByRole('combobox',{name:'Twin programme'}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Guide me',exact:true}).count(),0,'The in-page Guide me button must not exist');
        await page.getByRole('button',{name:/Guide Me/i}).click();
        for(const title of ['Current state: where work is stuck','History: replay recorded milestones','Projection: test a change'])await page.getByText(title,{exact:true}).waitFor();
        await page.getByText('Projection: test a change',{exact:true}).click();
        await page.locator('.driver-popover').getByText('What this window shows',{exact:true}).waitFor();
        for(let i=0;i<6;i++)await page.locator('.driver-popover-next-btn').click();      // starting point, levers, goal, live results, then the result
        await page.locator('.driver-popover').getByText('Read the result',{exact:true}).waitFor();
        await page.locator('.driver-popover-close-btn').click();
        checks.guideTours=true;if(await page.locator('.twin-projection-modal').isVisible())await page.locator('.twin-projection-modal .ant-modal-close').click();
        await tab(page,'Current state');
        await page.screenshot({path:path.join(artifacts,'process-twin-desktop.png'),fullPage:true,animations:'disabled'});
        await page.getByRole('button',{name:/^Delivery done: /}).click();
        await page.getByRole('button',{name:'View details',exact:true}).first().click();
        await page.getByText('Intervention details',{exact:true}).waitFor();
        await page.getByRole('heading',{name:'Appointments',exact:true}).waitFor();
        assert.equal(await page.getByRole('dialog').count(),1);
        await page.screenshot({path:path.join(artifacts,'process-twin-detail.png'),fullPage:true,animations:'disabled'});
        await page.getByRole('button',{name:/Back to stage list/}).click();
        await page.getByRole('dialog',{name:'Delivery completed',exact:true}).waitFor();
        await page.getByRole('button',{name:'View details',exact:true}).first().waitFor();
        assert.equal(await page.getByRole('dialog').count(),1);
        assert.equal(await page.locator('.ant-drawer').count(),0);
        checks.desktop=true;checks.recordDrilldown=true;

        // ---- History: replay, the three attendance routes, plain wording ----
        await page.goto(url);await ready(page);
        await tab(page,'History');
        assert.equal(await page.getByRole('button',{name:/Refresh history/}).count()+await page.getByRole('radiogroup',{name:'Playback speed'}).count()+await page.locator('.hv-feed, .hv-typ').count(),0,'History keeps only play, restart and the timeline');
        assert.equal(await page.locator('.history-v2 .ant-slider-handle').getAttribute('aria-valuemax'),await page.locator('.history-v2 .ant-slider-handle').getAttribute('aria-valuenow'),'History opens on the finished picture');
        await page.locator('.twin-chip.warn').click();await page.locator('.att').waitFor();if(await page.locator('.att-groups .ant-collapse-header').count())await page.locator('.att-groups .ant-collapse-header').first().click();await page.waitForTimeout(700);assert.equal(await page.locator('.att table').count(),0,'attention list is grouped, not one row per record');await page.screenshot({path:path.join(artifacts,'process-twin-attention.png'),animations:'disabled'});await page.locator('.ant-modal-close').last().click();await page.locator('.att').waitFor({state:'hidden'});checks.attentionSummary=true;
        await page.getByRole('button',{name:'Play history',exact:true}).click();
        await page.waitForFunction(()=>Number(document.querySelector('.history-v2 .ant-slider-handle')?.getAttribute('aria-valuenow'))>=2);assert.equal(await page.locator('.hv-feed').count(),0,'the Latest activity table is gone');
        await page.getByRole('button',{name:'Pause',exact:true}).click();
        const seek=page.locator('.history-v2 .ant-slider-handle');await seek.focus();await seek.press('End');
        for(const route of ['In person','Virtual','Telephonic'])await page.locator('.hv-route',{hasText:route}).waitFor();
        assert.ok(!/Arrived at reception|work items?/i.test(await page.locator('.history-v2').innerText()),'History must use the current wording');
        await page.screenshot({path:path.join(artifacts,'process-twin-history.png'),fullPage:true,animations:'disabled'});
        checks.historyPlayPauseSeek=true;

        // ---- Projection window: dials on the left, chart on the right, the same dials as the scene ----
        await tab(page,'Projection');
        await page.locator('.twin-projection-modal .ps-card').waitFor();
        assert.ok(!/Doing nothing|work items?|\bitems\b/i.test(await page.locator('.sc-two').innerText()),'the window must say "open interventions" and "If nothing changes"');
        assert.equal(await page.locator('.sc-dial.on').count(),0,'the projection opens with no change applied');assert.equal(await page.locator('.sc-dial').count(),5,'five dials');
        assert.equal(await page.locator('.bl-headline').count(),0,'the result cards say it, so there is no sentence repeating them');
        assert.equal(await page.locator('.sc-result-row, .bl-note').count(),0,'the top metrics and the shaded-columns note are gone');
        const summary=page.locator('.ps-card');assert.match(await summary.innerText(),/If nothing changes, [0-9]+ open interventions? (is|are) left after 8 weeks/);assert.match(await summary.locator('.ps-tag').innerText(),/Summary/);
        assert.equal(await page.locator('.sc-trust-pill').count(),0,'no placeholders pill');
        await page.getByRole('textbox',{name:'Describe a change'}).fill('add 30 new SMEs');await page.getByRole('button',{name:'Apply this change'}).click();
        await page.locator('.sc-dial.on').waitFor();await page.locator('.sc-ask-note').getByText(/Applied: 30 new SMEs/).waitFor();await page.locator('.sc-ask-note .src').waitFor();checks.describeAChange=true;
        await page.getByRole('spinbutton',{name:'Extra facilitator hours per week',exact:true}).fill('8');
        await page.waitForFunction(()=>document.querySelectorAll('.sc-dial.on').length===2);
        await page.locator('.sc-dial.on .sc-dial-sub .on').first().waitFor();
        await page.waitForFunction(()=>/(more|fewer) than the [0-9]+ left if nothing changes|the same as the [0-9]+ left/i.test(document.querySelector('.ps-card')?.textContent||''));
        await page.waitForTimeout(500);await page.screenshot({path:path.join(artifacts,'process-twin-scenarios.png'),animations:'disabled'});
        assert.ok(/If nothing changes/.test(await page.locator('.bl-key').innerText()),'the dashed line is labelled "If nothing changes"');
        const chart=page.getByRole('img',{name:/Baseline and scenario backlog over the simulation horizon/});
        await chart.focus();await chart.press('End');
        assert.ok(await page.locator('.bl-date button[aria-label="Next day"]').isDisabled(),'End reads the last day');
        await chart.press('Home');
        assert.ok(await page.locator('.bl-date button[aria-label="Previous day"]').isDisabled(),'Home reads the first day');
        const box=await chart.boundingBox();await page.mouse.move(box.x+box.width*300/720,box.y+box.height/2);
        assert.ok(!(await page.locator('.bl-date button[aria-label="Previous day"]').isDisabled()),'hovering the chart moves the day');
        assert.ok(/open interventions/.test(await page.locator('.bl-total').innerText()));
        await page.locator('.bl-row',{hasText:'Centre coordinator'}).click();assert.equal(await page.locator('.bl-row.on').count(),1);
        await page.locator('.bl-row',{hasText:'Centre coordinator'}).click();

        await page.getByRole('button',{name:'Settings'}).click();                          // settings
        const settings=page.locator('.sc-settings-modal').filter({hasText:'Horizon and starting capacity'});await settings.waitFor();
        for(const label of ['Sessions per facilitator per day','Days between sessions of one intervention','Expected new interventions'])await settings.getByText(label,{exact:true}).waitFor();
        for(const gone of ['Sessions per intervention per day','SMEs per shared session'])assert.equal(await settings.getByText(gone,{exact:true}).count(),0,`${gone} was removed`);
        const centre=settings.locator('.sc-centre').first();await centre.waitFor();
        assert.match(await centre.innerText(),/from staff records/);
        await settings.getByRole('button',{name:'Done'}).click();
        await page.getByRole('button',{name:'What this model assumes'}).click();
        const notes=page.locator('.sc-settings-modal').filter({hasText:'What it compares'});await notes.waitFor();
        assert.match(await notes.innerText(),/If nothing changes/);assert.match(await notes.innerText(),/open interventions/);
        await notes.getByRole('button',{name:'Done'}).click();
        await page.getByRole('button',{name:'Set a goal'}).click();
        await page.getByRole('button',{name:/Suggest a change/}).click();
        await page.locator('.sc-goal-result').waitFor();
        // The dials are shared: closing the window leaves the scene showing the same change.
        await page.locator('.twin-projection-modal .ant-modal-close').click();await page.locator('.twin-projection-modal').waitFor({state:'hidden'});
        await page.locator('.ts-intake').getByText('+30').waitFor();assert.ok(await page.getByRole('button',{name:'Reset dials'}).isEnabled(),'the scene shows the dials set in the projection');
        await page.getByRole('button',{name:'Reset dials'}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>/Reset dials/.test(b.textContent))?.disabled);
        // and the other way round: a dial turned on the scene is already set when the projection opens
        const sceneSme=page.locator('.ts-intake .ant-slider-handle');await sceneSme.focus();await sceneSme.press('ArrowRight');await sceneSme.press('ArrowRight');
        await tab(page,'Projection');await page.locator('.sc-dial.on').waitFor();assert.equal(await page.getByRole('spinbutton',{name:'Additional SMEs',exact:true}).inputValue(),'2','the projection opens with the scene dials');
        await page.locator('.twin-projection-modal .ant-modal-close').click();await page.locator('.twin-projection-modal').waitFor({state:'hidden'});await page.getByRole('button',{name:'Reset dials'}).click();
        checks.scenarioLiveComparison=true;checks.scenarioSettingsAndGoal=true;checks.wordingGuard=true;

        // ---- Headcounts: refused reads fall back and say so ----
        const refused=await browser.newPage({viewport:{width:1440,height:1050}});refused.on('pageerror',e=>errors.push(e.message));
        await refused.goto(`${base}?view=scenarios&headcountError=1`);await refused.locator('.twin-projection-modal .ps-card').waitFor();
        await refused.getByRole('button',{name:'Settings'}).click();
        const fallback=refused.locator('.sc-centre').first();await fallback.waitFor();
        assert.match(await fallback.innerText(),/counted from recent sessions/);assert.match(await fallback.innerText(),/assumed, please check/);
        await refused.close();checks.headcountFallback=true;

        // ---- Scope changes and denials ----
        await page.goto(url);await ready(page);
        await page.evaluate(()=>{window.__ACTIVE_PROGRAM_ID__='all';window.dispatchEvent(new CustomEvent('program-filter-changed',{detail:{programId:'all'}}))});
        await page.getByText('Choose one programme in the universal programme filter above to explore its twin.',{exact:true}).waitFor();
        await page.evaluate(()=>{window.__ACTIVE_PROGRAM_ID__='dtseed_20261009_v1_program_1';window.dispatchEvent(new CustomEvent('program-filter-changed',{detail:{programId:window.__ACTIVE_PROGRAM_ID__}}))});
        await page.getByText('The programme selected in the universal filter is outside your centre or no longer available.',{exact:true}).waitFor();
        checks.universalProgrammeSwitch=true;checks.foreignCentreDenied=true;

        // ---- Phone width ----
        await page.goto(url);await page.setViewportSize({width:390,height:844});await ready(page);
        await page.locator('.ts-core-text').waitFor();await page.waitForTimeout(300);await fits(page,'Overview');await page.screenshot({path:path.join(artifacts,'process-twin-overview-mobile.png'),fullPage:true,animations:'disabled'});await tab(page,'Current state');await fits(page,'Current state');
        await page.screenshot({path:path.join(artifacts,'process-twin-mobile.png'),fullPage:true,animations:'disabled'});
        await tab(page,'History');await fits(page,'History');
        await tab(page,'Projection');await page.locator('.twin-projection-modal .ps-card').waitFor();await fits(page,'Projection');
        assert.ok(await page.evaluate(()=>{const c=document.querySelector('.bl-body svg').getBoundingClientRect().top,r=document.querySelector('.ps-card').getBoundingClientRect().top;return c<r}),'the chart comes before the written summary on a phone');checks.mobileChartHeightPx=Math.round((await page.getByRole('img',{name:/Baseline and scenario backlog over the simulation horizon/}).boundingBox()).height); // informational: the chart is small on a phone
        await page.screenshot({path:path.join(artifacts,'process-twin-scenarios-mobile.png'),fullPage:true,animations:'disabled'});
        checks.mobileAllViews=true;

        const failed=await browser.newPage();await failed.addInitScript(()=>{window.testError=true});await failed.goto(url);
        await failed.getByText(/partial results are hidden/).waitFor();assert.equal(await failed.getByRole('region',{name:'Intervention process map',exact:true}).count(),0);await failed.close();
        checks.subscriptionErrorHidesPartialData=true;
        await page.addInitScript(()=>{window.testUser={uid:'unauthorised',role:'incubatee'}});await page.goto(url);
        await page.getByText('Intervention Twin is not available for this account',{exact:true}).waitFor();
        checks.unauthorisedUiDenied=true;
        assert.deepEqual(errors,[]);
        checks.runtimeErrors=errors;
        fs.writeFileSync(path.join(artifacts,'process-twin-browser-checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
    }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error(e);process.exitCode=1});
