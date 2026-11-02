import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkUsage({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,click,commands,usage,holdReads,releaseReads,setMode,setExpired}) {
  const evidence=[];
  await command('Page.bringToFront');
  await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  const screenshot=async name=>{await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`usage-${name}-${width}`);}};
  const refresh=()=>evaluate(`document.querySelector('.usage-page .page-heading [data-slot=button]').click()`);
  const ready=()=>waitUntil(`document.querySelector('.usage-page')?.getAttribute('aria-busy')==='false'`,'usage settled');
  assert.equal(await evaluate(`document.querySelector('.usage-page .page-heading button').disabled`),true);
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.skeleton'),'::after').animationName`),'none');
  await command('Emulation.setEmulatedMedia',{features:[]});
  await releaseReads();await waitFor('CURRENT ACCESS PERIOD');await ready();
  await waitFor('2m 5.25s');await waitFor('56m 54.75s');
  await screenshot('loaded');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.usage-page section.mt-4')).borderLeftWidth`),'0px');
  for(const theme of ['light','dark']) {
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('.usage-page .page-heading button').focus()`);
    for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await evaluate(`document.querySelector('.usage-page .page-heading button').blur();document.querySelector('.usage-page .page-heading button').focus()`);
    await sleep(220);
    const audit=await evaluate(`(()=>{const b=document.querySelector('.usage-page .page-heading button');return{height:b.getBoundingClientRect().height,focus:getComputedStyle(b).boxShadow,font:getComputedStyle(b).fontFamily,visible:b.matches(':focus-visible'),slot:b.dataset.slot,rows:document.querySelectorAll('.usage-page article').length,counts:document.querySelectorAll('.usage-page article dd').length}})()`);
    assert.ok(audit.height>=44);assert.equal(audit.visible,true);assert.match(audit.focus,/3px/);assert.ok(audit.font.includes('Inter'));assert.equal(audit.slot,'button');assert.equal(audit.rows,7);assert.equal(audit.counts,21);assert.equal(await evaluate(`getComputedStyle(document.querySelector('.usage-page dt')).display`),'block');evidence.push({theme,...audit});
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`usage-focus-${theme}-1440.png`),Buffer.from(shot.data,'base64'));
  }
  holdReads.add('/v1/usage');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor('Refreshing usage…');assert.equal(await evaluate(`document.querySelector('.usage-page .page-heading button').disabled`),true);
  const requests=commands.filter(r=>r==='GET /v1/usage').length;
  await refresh();await sleep(100);assert.equal(commands.filter(r=>r==='GET /v1/usage').length,requests);
  await screenshot('refreshing');setMode('error');await releaseReads();await waitFor('Showing the last loaded allowance.');await screenshot('cached-error');
  setMode('');await click('Try again');await ready();await waitUntil(`!document.querySelector('.usage-page [role=alert]')`,'retry recovers');
  for(const mode of ['error','malformed']) {
    setMode(mode);await navigate('/usage');await waitFor('A little interruption.');await ready();
    assert.equal(await evaluate(`document.querySelectorAll('.usage-page .allowance-count').length`),0,'invalid response shows no invented counts');
    await screenshot(mode);setMode('');await click('Try again');await waitFor('CURRENT ACCESS PERIOD');await ready();
  }
  const previous=structuredClone(usage);
  for(const field of ['consumed','reserved'])for(const key of Object.keys(usage[field]))usage[field][key]=0;
  usage.remaining={...usage.limits};await refresh();await ready();await screenshot('unused');
  Object.assign(usage,previous);
  Object.assign(usage,{accounting:{mode:'shared_credits',periodId:'paid_period_1'},limits:{sourceSeconds:18000,creationCredits:120},consumed:{sourceSeconds:70.5,creationCredits:5},reserved:{sourceSeconds:60,creationCredits:4},remaining:{sourceSeconds:17869.5,creationCredits:111}});
  await refresh();await ready();await waitFor('Creation credits');
  assert.equal(await evaluate(`document.querySelectorAll('.usage-page article').length`),2);
  assert.equal(await evaluate(`document.querySelector('#allowance-creationCredits').parentElement.textContent.includes('120 included')`),true);
  assert.equal(await evaluate(`document.querySelector('[aria-labelledby="allowance-creationCredits"] .remaining strong').textContent.trim()`),'111');
  await screenshot('shared-credits');
  delete usage.accounting;Object.assign(usage,previous);
  setExpired(true);const before=commands.filter(r=>r==='GET /v1/usage').length;
  await navigate('/usage');await waitFor('ACCESS PAUSED');assert.equal(await evaluate(`document.querySelectorAll('.usage-page .allowance-count').length`),0);assert.equal(await evaluate(`document.querySelector('.usage-page a[href="/projects"]').dataset.slot`),'button');
  await screenshot('expired');await ready();holdReads.add('/v1/capabilities');await click('Refresh access');await waitFor('Refreshing access…');assert.equal(await evaluate(`document.querySelector('.usage-page .page-heading button').disabled`),true);await screenshot('refreshing-access');await releaseReads();await ready();assert.ok(commands.filter(r=>r==='GET /v1/usage').length>before,'inactive usage is read without activating access');
  const counts={sourceSeconds:2700,creationCredits:15},zero={sourceSeconds:0,creationCredits:0};
  const lifecycle={trial:{state:'eligible',startsAt:null,expiresAt:null},paid:{state:'none',plan:null,startsAt:null,expiresAt:null,cancelAtPeriodEnd:false,nextPlan:null},nextChangeAt:null};
  Object.assign(usage,{accounting:{mode:'shared_credits'},lifecycle,periods:[],startsAt:null,expiresAt:null,limits:zero,consumed:zero,reserved:zero,remaining:zero});
  const beforeReadOnly=commands.length;
  await navigate('/usage');await waitFor('TRIAL NOT STARTED');await ready();await waitFor('No allowance period has started.');
  assert.equal(await evaluate(`document.querySelectorAll('.usage-page article').length`),0);
  assert.deepEqual(commands.slice(beforeReadOnly).filter(call=>call.startsWith('POST ')),[],'viewing inactive usage never starts a trial');
  await screenshot('trial-unstarted');
  const trial={kind:'trial',active:false,accounting:{mode:'shared_credits',periodId:'trial_period_1'},startsAt:'2026-10-01T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z',limits:counts,consumed:{sourceSeconds:200,creationCredits:10},reserved:zero,remaining:zero};
  const paid={...trial,kind:'paid',active:true,accounting:{mode:'shared_credits',periodId:'paid_period_1'},startsAt:'2026-10-03T00:00:00Z',expiresAt:'2026-11-03T00:00:00Z',limits:{sourceSeconds:18000,creationCredits:120},consumed:zero,remaining:{sourceSeconds:18000,creationCredits:120}};
  Object.assign(lifecycle,{trial:{state:'expired',startsAt:trial.startsAt,expiresAt:trial.expiresAt},paid:{state:'active',plan:'lower',startsAt:paid.startsAt,expiresAt:paid.expiresAt,cancelAtPeriodEnd:true,nextPlan:'lower'}});
  Object.assign(usage,{periods:[trial,paid],startsAt:paid.startsAt,expiresAt:paid.expiresAt,limits:paid.limits,consumed:zero,reserved:zero,remaining:paid.remaining});
  setExpired(false);await navigate('/usage');await waitFor('TRIAL ALLOWANCE PERIOD');await waitFor('PAID ALLOWANCE PERIOD');await ready();
  assert.equal(await evaluate(`document.querySelectorAll('.usage-page article').length`),4);
  assert.equal(await evaluate(`document.querySelectorAll('.usage-page [id]').length===new Set([...document.querySelectorAll('.usage-page [id]')].map(el=>el.id)).size`),true,'separate meters have unique labels');
  await waitFor('Expired allowance');await waitFor('Cancellation is scheduled.');await screenshot('trial-paid-separate');
  const lifecycleStates=[];
  for(const scenario of [
    {name:'trial-only',trialState:'active',paidState:'none',active:true,kinds:['trial'],badge:'Active allowance'},
    {name:'paid-only',trialState:'unavailable',paidState:'active',active:true,kinds:['paid'],badge:'Active allowance'},
    {name:'trial-paid-active',trialState:'active',paidState:'active',active:true,kinds:['trial','paid'],badge:'Active allowance'},
    {name:'expired',trialState:'expired',paidState:'expired',active:false,kinds:['trial','paid'],badge:'Expired allowance'},
    {name:'withdrawn',trialState:'unavailable',paidState:'withdrawn',active:false,kinds:['paid'],badge:'Access withdrawn'},
    {name:'scheduled',trialState:'unavailable',paidState:'scheduled',active:false,kinds:['paid'],badge:'Scheduled allowance'},
  ]) {
    usage.lifecycle={trial:{state:scenario.trialState,startsAt:scenario.trialState==='unavailable'?null:trial.startsAt,expiresAt:scenario.trialState==='unavailable'?null:trial.expiresAt},paid:{state:scenario.paidState,plan:scenario.paidState==='none'?null:'lower',startsAt:scenario.paidState==='none'?null:paid.startsAt,expiresAt:scenario.paidState==='none'?null:paid.expiresAt,cancelAtPeriodEnd:false,nextPlan:null},nextChangeAt:null};
    usage.periods=scenario.kinds.map(kind=>{const original=kind==='trial'?trial:paid;const active=(kind==='trial'?scenario.trialState:scenario.paidState)==='active';return {...original,active,remaining:active?(kind==='trial'?{sourceSeconds:2500,creationCredits:5}:original.remaining):zero};});
    setExpired(!scenario.active);const before=commands.length;
    await navigate('/usage');await waitFor(scenario.badge);await ready();
    assert.equal(await evaluate(`document.querySelectorAll('.usage-page article').length`),scenario.kinds.length*2,scenario.name);
    assert.equal(await evaluate(`document.querySelectorAll('.usage-page article').length===[...document.querySelectorAll('.usage-page article')].filter(el=>!!document.getElementById(el.getAttribute('aria-labelledby'))).length`),true,'every meter has an accessible label');
    assert.deepEqual(commands.slice(before).filter(call=>call.startsWith('POST ')),[],scenario.name+' remains read-only');
    if(!scenario.active)assert.equal(await evaluate(`document.querySelector('.usage-page a[href="/projects"]').textContent`),'View saved projects');
    if(!scenario.active)assert.equal(await evaluate(`[...document.querySelectorAll('.usage-page .remaining strong')].every(el=>el.textContent.trim()==='0'||el.textContent.trim()==='0m')`),true,'inactive history has zero spendable balances');
    lifecycleStates.push(scenario.name);
  }
  // A malformed lifecycle refresh retains clearly marked last-good usage and recovers.
  setExpired(false);usage.lifecycle.paid.state='active';usage.periods[0].active=true;
  await navigate('/usage');await waitFor('PAID ALLOWANCE PERIOD');await ready();
  const goodLifecycle=structuredClone(usage.lifecycle);
  const goodPeriods=structuredClone(usage.periods);
  for(const malformed of [
    {lifecycle:{...goodLifecycle,paid:{...goodLifecycle.paid,cancelAtPeriodEnd:'invalid'}}},
    {lifecycle:{...goodLifecycle,nextChangeAt:'2026-02-30T00:00:00Z'}},
    {lifecycle:{...goodLifecycle,trial:{...goodLifecycle.trial,state:['active']}}},
    {lifecycle:{...goodLifecycle,paid:{...goodLifecycle.paid,state:['active']}}},
    {periods:goodPeriods.map(period=>({...period,kind:['paid']}))},
  ]) {
    Object.assign(usage,malformed);
    await refresh();await waitFor('Showing the last loaded allowance.');await ready();
    assert.equal(await evaluate(`!!document.querySelector('.usage-page [role=alert]')`),true);
    assert.equal(await evaluate(`document.querySelectorAll('.usage-page article').length`),2,'last-good meters survive malformed refresh');
    usage.lifecycle=goodLifecycle;usage.periods=goodPeriods;await click('Try again');await ready();
    assert.equal(await evaluate(`!!document.querySelector('.usage-page [role=alert]')`),false);
  }
  delete usage.lifecycle;delete usage.periods;delete usage.accounting;Object.assign(usage,previous);
  setExpired(false);
  const beforeColdUsage = commands.length;
  await navigate('/usage');await waitFor('CURRENT ACCESS PERIOD');await ready();
  const coldUsageRequests = commands.slice(beforeColdUsage).filter(call => call.startsWith('GET '));
  assert.deepEqual(coldUsageRequests.sort(), ['GET /v1/capabilities', 'GET /v1/usage'], 'cold Usage reads only its access and allowance');
  assert.equal(await evaluate(`document.body.innerText.includes('Checking Google Drive')`), false);
  const beforeConnections = commands.length;
  await evaluate(`document.querySelector('a[href="/connections"]').click()`);
  await waitUntil(`document.querySelector('.connection-status')?.textContent==='Connected'`, 'fresh Drive status after Usage');
  const connectionRequests = commands.slice(beforeConnections).filter(call => call === 'GET /v1/drive/connection');
  assert.equal(connectionRequests.length, 1, 'entering Connections after Usage still checks Drive freshly');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'usage-performance.json'),JSON.stringify({coldUsageRequests,connectionRequests},null,2));
  await navigate('/usage?preview=true&state=expired');await waitFor('ACCESS PAUSED');assert.equal(await evaluate(`document.querySelector('.usage-page a').getAttribute('href')`),'/projects?preview=true');
  await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await evaluate(`document.querySelector('.usage-page a').focus()`);assert.ok(await evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));await command('Emulation.setEmulatedMedia',{features:[]});
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'usage-checks.json'),JSON.stringify({evidence,lifecycleStates,states:['cold','loaded','refreshing','cached-error','error','malformed','unused','shared-credits','expired'],keyboard:true,disabledWhilePending:true,backendCounts:true,previewLink:true,reducedMotion:true,forcedColors:true},null,2));
  console.log('PASS: Usage native shadcn actions, pending deduplication, keyboard/focus, backend counts, error/malformed recovery, cached allowance, unused/expired access, preview link, desktop/mobile light/dark, reduced motion and forced colors.');
}
