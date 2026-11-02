import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkProjects({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setState,setRegression,regressionCalls}) {
  const evidence=[];
  const uuid7=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const shots=async state=>{await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`projects-${state}-${width}`);}};
  const fill=async value=>evaluate(`(()=>{const input=document.querySelector('.link-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const key=async(key,code,number)=>{for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:number,...(key==='Enter'?{text:'\r'}:{})});};
  async function checkAvailability() {
    setState({imported:true});await navigate('/projects');
  setState({driveMode:'error',youtubeOnly:true});await reloadDocument();await waitFor('A conversation worth keeping');
  assert.equal(await evaluate(`!!document.querySelector('.library-row')`),true,'cold project list renders while Drive returns 503 and is unconfigured');
  await click('New project');await waitFor('Paste a YouTube video link');
  assert.equal(await evaluate(`document.querySelector('input[value=drive]').disabled`),true,'only unavailable source is disabled');
  setState({accessFails:true});await reloadDocument();await waitFor('Retry access check');await waitFor('A conversation worth keeping');
  assert.equal(await evaluate(`document.querySelector('[aria-controls="project-import"]').disabled`),true,'missing capabilities disable new work, not saved projects');
  setState({listMode:'error'});await reloadDocument();await waitFor('Refresh projects');
  assert.equal(await evaluate(`!!document.querySelector('.library-error[role=alert]')`),true,'genuine list failure remains visible with Drive and capabilities unavailable');
  setState({accessFails:false,driveMode:'ok',youtubeOnly:false,listMode:'ok'});await reloadDocument();await waitFor('A conversation worth keeping');
  evidence.push('cold Drive 503/unconfigured leaves projects readable and YouTube import available; cold access failure preserves projects with imports disabled; genuine projects failure stays visible');
  }
  if (process.env.RIFLO_SMOKE_PROJECTS_AVAILABILITY_ONLY === '1') {
    await checkAvailability();
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'projects-availability-checks.json'),JSON.stringify(evidence,null,2));
    console.log('PASS: Projects remain readable with Drive and access checks unavailable; imports stay gated and genuine list errors remain visible.');
    return;
  }
  await command('Page.bringToFront');await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  holdReads.add('/v1/projects');await navigate('/projects');await waitUntil(`!!document.querySelector('[aria-label="Loading projects"]')`,'cold project list');await shots('loading');await releaseReads();await waitFor('Start with something worth sharing.');await shots('empty');
  await evaluate(`document.querySelector('[aria-controls="project-import"]').focus()`);await key('Enter','Enter',13);await waitFor('Paste a Google Drive video link');
  assert.equal(await evaluate(`document.activeElement.name`),'video-source');await key('ArrowRight','ArrowRight',39);await waitFor('Paste a YouTube video link');assert.equal(await evaluate(`document.querySelector('input[value=youtube]').checked`),true);
  await key('Escape','Escape',27);assert.equal(await evaluate(`document.activeElement.getAttribute('aria-controls')`),'project-import');assert.equal(await evaluate(`!!document.querySelector('#project-import')`),false);
  await key('Enter','Enter',13);await waitFor('Paste a Google Drive video link');
  await fill('https://example.com/not-drive');await click('Import video');await waitUntil(`document.querySelector('.link-field input')?.getAttribute('aria-invalid')==='true'`,'invalid Drive link');
  assert.equal(await evaluate(`document.querySelector('.link-field input').labels.length`),1);
  assert.equal(await evaluate(`document.querySelector('.link-field input').getAttribute('aria-describedby').split(' ').every(id=>!!document.getElementById(id))`),true);await shots('invalid');
  const beforeStorageFailure=commands.filter(call=>call==='POST /v1/projects').length;
  await fill('https://drive.google.com/file/d/test_video/view');
  await evaluate(`window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('riflo:import:'))throw new DOMException('Local fixture full','QuotaExceededError');return window.__originalSetItem.call(this,key,value)}`);
  await click('Import video');await waitUntil(`!!document.querySelector('.form-feedback[role=alert]')`,'pending storage failure');
  assert.equal(commands.filter(call=>call==='POST /v1/projects').length,beforeStorageFailure,'storage failure prevents submission');
  assert.equal(await evaluate(`document.querySelector('.link-field input').disabled||document.querySelector('fieldset.source-choice').disabled`),false,'unsent storage failure remains editable');
  assert.equal(await evaluate(`!!document.querySelector('.source-confirm')`),false,'unsent storage failure does not offer replay');
  await evaluate(`Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem`);
  evidence.push('fresh persistence failure sends no command and keeps editable draft without replay lock');
  await fill('https://drive.google.com/file/d/test_video/view?resourcekey=original_key');
  await shots('draft');
  for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});assert.equal(await evaluate(`Array.from(document.querySelectorAll('.import-fields button,.library-heading button,.link-field input')).every(el=>el.getBoundingClientRect().height>=44)`),true);assert.equal(await evaluate(`getComputedStyle(document.querySelector('.link-field input')).fontFamily.includes('Inter')`),true);if(width===375)assert.equal(await evaluate(`getComputedStyle(document.querySelector('.link-field input')).fontSize`),'16px');}
  await evaluate(`document.querySelector('.link-field input').focus()`);await key('ArrowRight','ArrowRight',39);await sleep(200);assert.equal(await evaluate(`document.activeElement.matches(':focus-visible')`),true);assert.match(await evaluate(`getComputedStyle(document.activeElement).boxShadow`),/3px/);await shots('focus');
  await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`),'solid');await command('Emulation.setEmulatedMedia',{features:[]});
  const beforeClearFailure=regressionCalls.length;
  setRegression({id:'projects_clear_failure',import:true,replies:[[403,'allowance_exceeded']]});
  await evaluate(`window.__clearUnhandled=[];window.__clearUnhandledListener=event=>window.__clearUnhandled.push(String(event.reason));window.addEventListener('unhandledrejection',window.__clearUnhandledListener);window.__originalRemoveItem=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(key.startsWith('riflo:import:'))throw new DOMException('Local fixture blocked','SecurityError');return window.__originalRemoveItem.call(this,key)}`);
  await click('Import video');await waitFor('We couldn’t clear the saved request in this browser.');await sleep(100);
  assert.deepEqual(await evaluate(`window.__clearUnhandled`),[],'failed persistence cleanup does not reject the event handler');
  assert.equal(regressionCalls.length,beforeClearFailure+1);
  const uncleared=await evaluate(`JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key=>key.startsWith('riflo:import:'))))`);
  assert.equal(uncleared.key,regressionCalls.at(-1).headers['Idempotency-Key']);
  assert.deepEqual(uncleared.input,JSON.parse(regressionCalls.at(-1).postData));
  assert.equal(await evaluate(`document.querySelector('.link-field input').disabled&&document.querySelector('fieldset.source-choice').disabled`),true,'failed cleanup preserves the lock');
  assert.equal(await evaluate(`document.querySelector('.source-confirm button')?.textContent.includes('Check import status')`),true);
  await evaluate(`Storage.prototype.removeItem=window.__originalRemoveItem;delete window.__originalRemoveItem;window.removeEventListener('unhandledrejection',window.__clearUnhandledListener);Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);
  evidence.push('failed saved-request cleanup retains exact payload/key and recovery lock without an unhandled rejection');
  await navigate('/projects');await click('New project');await fill('https://drive.google.com/file/d/test_video/view?resourcekey=original_key');
  const importFixture={id:'projects_import_test',import:true,replies:['held',[403,'allowance_exceeded']]};setRegression(importFixture);
  await evaluate(`(()=>{const form=document.querySelector('.import-fields form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);await waitFor('Checking video…');for(let attempt=0;attempt<120&&!importFixture.heldRequestId;attempt++)await sleep(50);assert.ok(importFixture.heldRequestId);assert.equal(regressionCalls.length,beforeClearFailure+2,'duplicate submit is blocked');assert.equal(await evaluate(`document.querySelector('.link-field > button').disabled`),true);await shots('starting');await click('Close import');assert.equal(await evaluate(`Object.keys(sessionStorage).some(key=>key.startsWith('riflo:import:'))`),true,'closing during an unanswered request retains its intent');await command('Fetch.failRequest',{requestId:importFixture.heldRequestId,errorReason:'Failed'}).catch(()=>undefined);await click('Check import status');await waitFor('Your selection is saved while we confirm');await shots('uncertain');
  await click('Close import');await click('Check import status');await waitFor('Your selection is saved while we confirm');assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true);
  await reloadDocument();await click('Check import status');await waitFor('Your selection is saved while we confirm');await click('Check import status');await waitFor('Check usage');
  const replayCalls=regressionCalls.slice(beforeClearFailure+1);
  assert.match(replayCalls[0].headers['Idempotency-Key'],uuid7,'new source import uses UUID v7');
  assert.equal(replayCalls.length,2);assert.equal(new Set(replayCalls.map(r=>r.headers['Idempotency-Key'])).size,1);assert.equal(new Set(replayCalls.map(r=>r.postData)).size,1);assert.deepEqual(JSON.parse(replayCalls[1].postData),{fileId:'test_video',resourceKey:'original_key'});assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true,'later rejection cannot release uncertain intent');await shots('limit-after-uncertain');
  // New fixture session for a definite first rejection, with no ambiguous prior operation.
  await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);setRegression({id:'projects_import_quota',import:true,replies:[[403,'allowance_exceeded']]});await navigate('/projects');await click('New project');await fill('https://drive.google.com/file/d/test_video/view');await click('Import video');await waitFor('Check usage');assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),false);assert.equal(await evaluate(`!!document.querySelector('.source-confirm')`),false);await shots('limit');
  for(const [status,code,message] of [[403,'trial_identity_required','verified Google account'],[403,'trial_already_used','already used its trial'],[429,'trial_rate_limited','Try again in 37 seconds.']]) {
    await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);
    setRegression({id:'projects_'+code,import:true,replies:[[status,code,37]]});await navigate('/projects');await click('New project');await fill('https://drive.google.com/file/d/test_video/view');await click('Import video');await waitFor(message);
    assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),false,'definite trial rejection allows choosing a source');
    assert.equal(await evaluate(`!!document.querySelector('.source-confirm')`),false);
    assert.equal(await evaluate(`document.querySelector('.form-feedback[role=alert]').textContent.includes('private provider')`),false);
  }
  await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);
  setRegression({id:'projects_trial_uncertain',import:true,replies:['lost',[429,'trial_rate_limited',37]]});await navigate('/projects');await click('New project');await fill('https://drive.google.com/file/d/test_video/view');await click('Import video');await waitFor('Your selection is saved while we confirm');await click('Check import status');await waitFor('Try again in 37 seconds.');
  assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true,'trial rate rejection preserves earlier uncertain submission');
  assert.equal(regressionCalls.at(-1).headers['Idempotency-Key'],regressionCalls.at(-2).headers['Idempotency-Key']);
  assert.equal(regressionCalls.at(-1).postData,regressionCalls.at(-2).postData);
  await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);
  evidence.push('safe trial identity/used/rate alerts; server Retry-After feedback; definite rejection versus unchanged uncertain key/payload');
  // Picker is a local SDK fixture: no Google script, credentials or network are used.
  setRegression({id:'projects_picker',import:true,replies:[[403,'allowance_exceeded'],[403,'allowance_exceeded']]});
  await navigate('/projects');await click('New project');
  await evaluate(`(()=>{
    window.__pickerDoc={id:'picked_B',resourceKey:'key_B'};
    window.gapi={load:(_name,options)=>options.callback()};
    class Builder {addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setCallback(cb){this.cb=cb;return this}build(){const cb=this.cb;return {setVisible:visible=>{if(visible)queueMicrotask(()=>cb({action:'picked',docs:[window.__pickerDoc]}))},dispose(){}}}}
    window.google={picker:{PickerBuilder:Builder,DocsView:class {setMode(){return this}},DocsViewMode:{LIST:'list'},ViewId:{DOCS_VIDEOS:'videos'}}};
    const append=document.head.append.bind(document.head);document.head.append=(...nodes)=>{if(nodes[0]?.src==='https://apis.google.com/js/api.js'){queueMicrotask(()=>nodes[0].onload());return;}return append(...nodes)};
  })()`);
  await fill('https://drive.google.com/file/d/draft_A/view?resourcekey=key_A');
  const beforePicker=commands.filter(call=>call==='POST /v1/projects').length;
  await click('Choose from Drive');await waitUntil(`document.querySelector('#drive-link')?.value.includes('picked_B')`,'Picker replaces draft A with B');
  assert.equal(await evaluate(`document.querySelector('#drive-link').value`),'https://drive.google.com/file/d/picked_B/view?resourcekey=key_B');
  assert.equal(commands.filter(call=>call==='POST /v1/projects').length,beforePicker,'Picker selection only changes draft');
  assert.equal(await evaluate(`!!document.querySelector('.source-confirm')`),false,'Picker does not insert a metadata confirmation gate');
  await shots('picked');await click('Import video');await waitFor('Check usage');
  assert.deepEqual(JSON.parse(regressionCalls.at(-1).postData),{fileId:'picked_B',resourceKey:'key_B'});
  await click('Choose from Drive');await waitUntil(`!document.querySelector('.link-field > button').disabled`,'Picker finished');
  await fill('https://drive.google.com/file/d/edited_C/view?resourcekey=key_C');await click('Import video');await waitFor('Check usage');
  assert.deepEqual(JSON.parse(regressionCalls.at(-1).postData),{fileId:'edited_C',resourceKey:'key_C'},'editing picked URL invalidates B and its resource key');
  evidence.push('Picker B replaces visible draft A without validation/import; B key preserved; editing to C invalidates B');

  // Raw YouTube URL survives malformed response, reload, and a later definite rejection.
  const rawYoutube='https://youtu.be/abcdefghijk?si=Exact_CASE&t=17';
  const youtubeRegressionStart=regressionCalls.length;
  setRegression({id:'projects_raw_youtube',import:true,replies:['malformed',[422,'youtube_video_unavailable'],'lost']});
  await navigate('/projects');await click('New project');await evaluate(`document.querySelector('input[value=youtube]').click()`);await fill(rawYoutube);await click('Import video');await waitFor('Your selection is saved while we confirm');
  const rawSaved=await evaluate(`JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key=>key.startsWith('riflo:import:'))))`);
  assert.equal(rawSaved.submittedURL,rawYoutube);assert.deepEqual(rawSaved.input,{source:'youtube',url:rawYoutube});
  await reloadDocument();await click('Check import status');await waitFor('Your selection is saved while we confirm');
  assert.equal(await evaluate(`document.querySelector('#youtube-link').value`),rawYoutube);
  await click('Check import status');await waitFor('This YouTube video is unavailable.');
  assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true);
  const rawCalls=regressionCalls.slice(youtubeRegressionStart);assert.equal(rawCalls.length,2);assert.equal(rawCalls[0].postData,rawCalls[1].postData);assert.equal(rawCalls[0].headers['Idempotency-Key'],rawCalls[1].headers['Idempotency-Key']);
  await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);
  evidence.push('YouTube exact raw URL and UUID survive malformed response/reload/later provider rejection');
  setRegression(null);setState({imported:true});await navigate('/projects');await waitFor('A conversation worth keeping');assert.equal(await evaluate(`document.querySelector('.library-row').getAttribute('href')`),'/projects/test_project');await shots('loaded');
  await checkAvailability();
  setState({listMode:'error'});await navigate('/projects');await waitFor('Refresh projects');await shots('error');setState({listMode:'ok'});await click('Refresh projects');await waitFor('A conversation worth keeping');
  setState({driveMode:'error'});await navigate('/projects');await click('New project');await waitFor('Google Drive status is unavailable');await shots('drive-unavailable');setState({driveMode:'ok'});await click('Retry connection status');await waitFor('Paste a Google Drive video link');
  await evaluate(`document.querySelector('input[value=youtube]').click()`);await fill('https://youtu.be/abcdefghijk');await click('Import video');await waitUntil(`!!document.querySelector('.form-feedback[role=alert]')`,'denied YouTube source');assert.equal(await evaluate(`document.querySelector('.form-feedback').textContent.includes('private fixture')`),false);await shots('youtube-denied');await click('Import video');await waitFor('Your selection is saved while we confirm');await shots('youtube-uncertain');
  const youtubeSaved=await evaluate(`JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key=>key.startsWith('riflo:import:'))))`);assert.deepEqual(youtubeSaved.input,{source:'youtube',url:'https://youtu.be/abcdefghijk'});assert.equal(youtubeSaved.submittedURL,'https://youtu.be/abcdefghijk');
  await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).forEach(key=>sessionStorage.removeItem(key))`);
  setState({youtubeOnly:true});await navigate('/projects');await click('New project');await waitFor('Paste a YouTube video link');assert.equal(await evaluate(`document.querySelector('input[value=drive]').disabled`),true);await shots('youtube-only');
  setState({expired:true});await navigate('/projects');await waitFor('Active account access is needed');assert.equal(await evaluate(`document.querySelector('[aria-controls="project-import"]').disabled`),true);await shots('expired');
  const eligible={trial:{state:'eligible',startsAt:null,expiresAt:null},paid:{state:'none',plan:null,startsAt:null,expiresAt:null,cancelAtPeriodEnd:false,nextPlan:null},nextChangeAt:null};
  setState({lifecycleCapabilities:{lifecycle:eligible,subscription:{active:false,reason:'trial_eligible',expiresAt:null},intake:{available:false,reason:'trial_activation_disabled'}}});
  await navigate('/projects');await waitUntil(`document.querySelector('[aria-controls="project-import"]')?.disabled===true`,'eligible account respects disabled activation gate');
  setState({lifecycleCapabilities:{lifecycle:eligible,subscription:{active:true,reason:'active',expiresAt:null},intake:{available:false,reason:'intake_unavailable'}}});
  await navigate('/projects');await waitUntil(`document.querySelector('[aria-controls="project-import"]')?.disabled===true`,'explicit unavailable intake overrides active subscription');
  setState({lifecycleCapabilities:{lifecycle:eligible,subscription:{active:false,reason:'trial_eligible',expiresAt:null},intake:{available:true,reason:'trial_eligible'}}});
  const beforePreparation=commands.length;
  await navigate('/projects');await waitUntil(`document.querySelector('[aria-controls="project-import"]')?.disabled===false`,'eligible account can prepare import');
  await click('New project');await waitFor('Paste a YouTube video link');await fill('https://youtu.be/abcdefghijk');
  assert.equal(await evaluate(`document.querySelector('.link-field > button').disabled`),false,'eligible draft can be submitted');
  assert.deepEqual(commands.slice(beforePreparation).filter(call=>call.startsWith('POST ')),[],'browsing and drafting send no import or activation command');
  assert.equal(eligible.trial.startsAt,null);
  await click('Close import');
  // Deliberately leave lifecycle identity unchanged: copy follows the server's effective bounds.
  for (const [maxSourceSeconds,maxSourceBytes,copy] of [[1800,3e9,'30 minutes · 3 GB'],[2700,5e9,'45 minutes · 5 GB'],[3600,6e9,'60 minutes · 6 GB'],[1800,2*1024**3,'30 minutes · 2.147 GB']]) {
    setState({lifecycleCapabilities:{lifecycle:eligible,subscription:{active:false,reason:'trial_eligible',expiresAt:null},intake:{available:true,reason:'trial_eligible'},operationalLimits:{maxSourceSeconds,maxSourceBytes}}});
    await reloadDocument();await click('New project');
    await waitUntil(`!!document.querySelector('.source-limits')`,'fresh backend source bounds');
    assert.equal((await evaluate(`document.querySelector('.source-limits').textContent`)).replace(/\s+/g,' ').trim(),`Up to ${copy}`);
    await click('Close import');
  }
  evidence.push('server-selected trial/lower/higher/legacy source bounds rendered with decimal GB, independently of lifecycle identity');
  setState({lifecycleCapabilities:null});
  evidence.push('eligible activation-disabled gate; enabled drafting without import/activation command');
  evidence.push('cold loading/empty/loaded/error/retry','native source arrow keys','keyboard open and Escape focus return','associated label and inline errors','44px targets and mobile 16px input','forced-color input focus','same-frame submission duplicate guards','close during held request preserves unknown outcome; exact replay across reload including resource key','backend allowance first rejection versus uncertain rejection','Drive unavailable/retry','YouTube denied/retry and Drive unconfigured','desktop/mobile light/dark');
  assert.equal(commands.some(call=>call.endsWith('/validate')),false,'direct import makes no metadata precheck request');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'projects-checks.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: Projects list and import controls, direct submission, duplicate guards, exact replay, source recovery, backend gates, keyboard/focus and desktop/mobile light/dark.');
}
