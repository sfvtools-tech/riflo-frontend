import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkProjectReads({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,setFixture,getFixture,setRegression,setRetryFixture,retryCalls,regressionCalls,transcriptionCalls,notifyStream,eventFrame,publicBatchResponses}) {
  const uuid7=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const forbidden=['/v1/usage','/v1/brand','/v1/drive/connection','/v1/capabilities'];
  // This mode signs in directly on a project: include requests dispatched before this callback.
  const first=0;
  const checks=[];
  const noAccountReads=label=>{
    assert.deepEqual(commands.slice(first).filter(call=>forbidden.some(path=>call===`GET ${path}`)),[],label);
    checks.push(label);
  };
  const edit=async(id,value)=>evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const openChoices=async()=>{await waitUntil(`!!document.querySelector('.create-content-chooser')`,'chooser');await evaluate(`document.querySelector('.create-content-chooser').open=true`);};
  const openPreferences=async()=>{await openChoices();await evaluate(`document.querySelector('.writing-preferences').open=true`);await waitUntil(`!document.getElementById('creation-audience').disabled`,'local writing fields');};
  const shots=async(name,choices=false)=>{
    for(const width of [375,1440]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove();window.scrollTo(0,0)`);
      if(choices)await openChoices();
      await capture(`project-reads-${name}-${width}`);
    }
  };
  const open=async state=>{setFixture(state);await navigate('/projects/detail_fixture');await waitFor('Saved detail content stays readable.');await openChoices();await sleep(150);};
  await waitFor('Saved detail content stays readable.');await openChoices();await waitUntil(`!!document.querySelector('[aria-label="Create X post"]')&&!document.querySelector('[aria-label="Create X post"]').disabled`,'backend eligibility');
  noAccountReads('cold direct project entry has no account/profile/connection reads');
  assert.ok(commands.includes('GET /v1/projects/detail_fixture'));
  for(const suffix of ['/generation','/outputs','/generation/availability'])assert.ok(commands.includes(`GET /v1/projects/detail_fixture${suffix}`));
  assert.equal(await evaluate(`/\b\d+ remaining\b/.test(document.querySelector('.generation-choices').textContent)`),false,'remaining-count labels removed');
  await openPreferences();
  assert.equal(await evaluate(`document.getElementById('creation-audience').value`),'');
  assert.equal(await evaluate(`document.getElementById('creation-language').selectedOptions[0].textContent`),'Use saved preference');
  await edit('creation-audience','Temporary audience');await edit('creation-language','');await edit('creation-spelling','');
  noAccountReads('opening and editing preferences does not fetch saved defaults');
  await shots('preferences',true);

  // A retained legacy request must keep explicit empty overrides, not inherit new defaults.
  const legacy={key:'legacy-clear-project-request',selection:{x_posts:2,linkedin_posts:2},brand:{mode:'saved',overrides:{audience:'',voice:'',language:'',spelling:''}}};
  await evaluate(`(()=>{const key=Object.keys(sessionStorage).find(key=>key.startsWith('riflo:batch:'));if(key)sessionStorage.removeItem(key);})()`);
  setFixture(null);setRegression({id:'regression_sparse',replies:['lost']});
  await navigate('/projects/regression_sparse');await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');await openPreferences();
  await edit('creation-audience','Temporary audience');await edit('creation-voice','');await edit('creation-language','');await edit('creation-spelling','');
  await evaluate(`document.querySelector('[aria-label="Create X post"]').click()`);await waitFor('We couldn’t confirm whether it started.');
  const initial=regressionCalls.at(-1);
  assert.match(initial.headers['Idempotency-Key']??initial.headers['idempotency-key'],uuid7,'new generation uses UUID v7');
  assert.deepEqual(JSON.parse(initial.postData).brand,{mode:'saved',overrides:{audience:'Temporary audience',language:'',spelling:''}});
  await reloadDocument();await waitFor('Retry request');await click('Retry request');await waitFor('Saved regression output remains available.');
  const replay=regressionCalls.at(-1);
  assert.equal(replay.postData,initial.postData);assert.equal(replay.headers['Idempotency-Key'],initial.headers['Idempotency-Key']);
  noAccountReads('generation acceptance, completion and exact replay use only project resources');
  await openChoices();await waitUntil(`document.querySelector('[aria-label="Create X post"]')&&!document.querySelector('[aria-label="Create X post"]').disabled`,'ready after settlement');
  await evaluate(`document.querySelector('[aria-label="Create X post"]').click()`);await sleep(400);
  assert.equal(JSON.parse(regressionCalls.at(-1).postData).brand,undefined,'untouched preferences are omitted for backend saved resolution');
  await openPreferences();await evaluate(`document.querySelector('.writing-preferences-toggle input').click()`);await sleep(50);
  await evaluate(`document.querySelector('[aria-label="Create LinkedIn post"]').click()`);await sleep(400);
  assert.deepEqual(JSON.parse(regressionCalls.at(-1).postData).brand,{mode:'none'});

  // Reload exact old payloads through the same persisted namespace as production.
  setRegression({id:'regression_legacy_clears',replies:[]});
  await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');sessionStorage.setItem('riflo:batch:'+firebaseAuth().currentUser.uid+':regression_legacy_clears',JSON.stringify(${JSON.stringify(legacy)}));})()`);
  await navigate('/projects/regression_legacy_clears');await waitFor('Retry request');await click('Retry request');await waitFor('Saved regression output remains available.');
  const oldReplay=regressionCalls.at(-1);
  assert.deepEqual(JSON.parse(oldReplay.postData),{outputs:legacy.selection,brand:legacy.brand},'legacy counts and explicit empty overrides replay unchanged');
  assert.equal(oldReplay.headers['Idempotency-Key']??oldReplay.headers['idempotency-key'],legacy.key);

  setRegression(null);
  const saved={id:'detail_saved',feature:'x_posts',status:'ready',errorCode:null};
  for(const [name,status,slots,message] of [
    ['ready','completed',[saved],null],
    ['partial','partial',[saved,{id:'failed_blog',feature:'blogs',status:'failed',errorCode:'provider_unavailable'}],'Some content could not finish.'],
    ['failed','failed',[{...saved,status:'failed',errorCode:'provider_unavailable'}],'Couldn’t create your content.'],
    ['reset','failed',[{...saved,status:'failed',errorCode:'generation_reset'}],'Previous generation was reset. You can create again.'],
    ['duplicate','failed',[{...saved,status:'failed',errorCode:'duplicate_generated_output'}],'The result repeated existing content. Try another focus.'],
  ]) {
    // Deliberate old storage extras verify only the JSON response boundary changes.
    await open({mode:'ready',batch:{id:'public_'+name,status,slots:slots.map((slot,ordinal)=>({...slot,ordinal,attempts:2})),selection:{x_posts:1},createdAt:'private-created',updatedAt:'private-updated',brand:{status:'applied',privateSnapshot:'removed'}}});
    if(message)await waitFor(message);
    assert.equal(await evaluate(`document.querySelectorAll('.output-index button').length`),1,'status slots never create phantom saved outputs');
    await shots('generation-'+name,true);
  }
  await open({mode:'failed',job:true});await waitFor('The transcript could not be prepared.');
  assert.equal(await evaluate(`document.querySelectorAll('.generation-format.is-generating').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('.output-index button').length`),1,'failed zero-slot ASR adds no saved output');
  await shots('transcription-failed-batch',true);
  checks.push('minimal public generation snapshots render ready, partial, failed, reset, duplicate and zero-slot ASR without phantom outputs');

  setRegression(null);await open({mode:'failed'});await waitFor('Retry transcription');getFixture().lost=true;
  await click('Retry transcription');await waitFor('Check retry status');
  await reloadDocument();await waitFor('Check retry status');
  await waitUntil(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Check retry status'&&!button.disabled)`,'transcription replay enabled after availability refresh');
  await click('Check retry status');await waitFor('Preparing transcript…');
  const retries=transcriptionCalls.slice(-2),key=item=>item.headers['Idempotency-Key']??item.headers['idempotency-key'];
  assert.match(key(retries[0]),uuid7,'new transcription retry uses UUID v7');
  assert.equal(key(retries[0]),key(retries[1]));
  getFixture().mode='ready';notifyStream('/v1/projects/detail_fixture/retry-transcription',eventFrame('terminal',{projectId:'detail_fixture',kind:'generation',id:'transcript_retry_1'},{status:'completed',ready:0,failed:0,terminal:true,outcome:'succeeded'}),true);
  await waitFor('Transcript ready.');noAccountReads('transcription retry, uncertain reload and terminal settlement have no forbidden reads');

  setFixture(null);setRetryFixture({id:'project_reads_import',status:'failed',availableAt:Date.now()-1,replies:['lost','ok']});
  await navigate('/projects/project_reads_import');await waitFor('Retry import');await click('Retry import');await waitFor('Check import status');
  await click('Check import status');await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
  const imports=retryCalls.slice(-2);assert.match(key(imports[0]),uuid7,'new import retry uses UUID v7');assert.equal(key(imports[0]),key(imports[1]));
  noAccountReads('manual import retry and same-key replay do not check account or Drive status');setRetryFixture(null);

  await open({mode:'ready',configurationMissing:true});await waitFor('Generation is currently unavailable.');
  assert.equal(await evaluate(`document.querySelector('.output-paper').textContent.includes('Saved detail content stays readable.')`),true);await shots('not-configured',true);
  await open({mode:'failed',configurationMissing:true});await waitFor('Transcription is currently unavailable.');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Retry transcription')`),false);await shots('transcription-not-configured',true);
  await open({mode:'ready',accessExpired:true});await waitFor('Your access has expired.');await shots('expired',true);
  await open({mode:'ready',unimplemented:'short_videos'});await waitFor('This format is currently unavailable.');
  await open({mode:'ready',availabilityBroken:true});await waitFor('Retry availability check');
  assert.equal(await evaluate(`document.querySelector('.output-paper').textContent.includes('Saved detail content stays readable.')`),true);await shots('availability-error',true);
  getFixture().availabilityBroken=false;await click('Retry availability check');await waitUntil(`!!document.querySelector('[aria-label="Create X post"]')&&!document.querySelector('[aria-label="Create X post"]').disabled`,'availability recovers');
  await open({mode:'expired'});await waitFor('The stored video copy has expired.');await shots('source-expired',true);
  const costs=Object.fromEntries(['x_posts','linkedin_posts','blogs','newsletters','carousels','short_videos'].map(key=>[key,key==='short_videos'?4:key==='carousels'?2:1]));
  await open({mode:'ready',credits:{remaining:3,costs}});await waitFor('3 creation credits remaining.');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Create Carousel"]').disabled`),false);
  assert.equal(await evaluate(`document.querySelectorAll('.generation-format')[5].querySelector('button').disabled`),true);
  await waitFor('Not enough creation credits.');await shots('shared-credits',true);
  await open({mode:'ready',limit:true,credits:{remaining:120,costs}});await waitFor('120 creation credits remaining.');
  await waitFor('An allowance limit prevents new creation. Your saved content is still available.');
  assert.equal(await evaluate(`document.querySelector('.generation-restriction strong').textContent`),'Allowance limit reached.');
  assert.equal(await evaluate(`document.querySelector('.generation-choices').textContent.includes('Not enough creation credits.')`),false,'source allowance rejection does not claim credit exhaustion');
  assert.equal(await evaluate(`[...document.querySelectorAll('.generation-format button')].filter(button=>button.textContent==='Create').every(button=>button.disabled)`),true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="View saved X post"]').disabled`),false);
  await shots('source-allowance-with-credits',true);
  checks.push('source allowance rejection with 120 creation credits uses neutral allowance wording and preserves saved View');
  await open({mode:'ready',credits:{remaining:0,costs}});await waitFor('0 creation credits remaining.');
  await waitFor('Not enough creation credits.');
  assert.equal(await evaluate(`[...document.querySelectorAll('.generation-format button')].filter(button=>button.textContent==='Create').every(button=>button.disabled)`),true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="View saved X post"]').disabled`),false);
  await shots('shared-credits-exhausted',true);
  checks.push('shared credits show backend prices and balance; unaffordable formats are disabled while saved View remains available');
  const deadline=new Date(Date.now()+1800).toISOString();
  const lifecycle={trial:{state:'active',startsAt:new Date(Date.now()-86400000).toISOString(),expiresAt:deadline},paid:{state:'active',plan:'lower',startsAt:new Date(Date.now()-3600000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),cancelAtPeriodEnd:false,nextPlan:null},nextChangeAt:deadline};
  await open({mode:'ready',credits:{remaining:3,costs},lifecycle});
  await waitFor('3 creation credits remaining.');
  const beforeDeadline=commands.filter(call=>call==='GET /v1/projects/detail_fixture/generation/availability').length;
  getFixture().credits={remaining:0,costs};
  await waitUntil(`document.querySelector('.generation-choices').textContent.includes('0 creation credits remaining.')`,'trial deadline refreshes availability during paid access');
  assert.ok(commands.filter(call=>call==='GET /v1/projects/detail_fixture/generation/availability').length>beforeDeadline);
  assert.equal(await evaluate(`document.querySelector('[aria-label="View saved X post"]').disabled`),false);
  noAccountReads('trial deadline during paid access refreshes only project availability and keeps saved View');
  noAccountReads('all project states preserve the four-request exclusion');
  const projectRequests=commands.slice(first);
  assert.ok(publicBatchResponses.length>0);
  for(const {body} of publicBatchResponses) {
    assert.deepEqual(Object.keys(body).sort(),['id','status','slots','errorCode',...(body.intent?['intent']:[]),...(body.brand?['brand']:[])].sort());
    for(const slot of body.slots)assert.deepEqual(Object.keys(slot).sort(),['id','feature','status','errorCode'].sort());
    if(body.brand)assert.deepEqual(Object.keys(body.brand),['status']);
    if(body.status!=='failed')assert.equal(body.errorCode,null);
  }
  assert.ok(publicBatchResponses.some(({body})=>body.intent==='transcription_retry'&&body.status==='failed'&&body.slots.length===0&&body.errorCode==='provider_unavailable'));
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'public-generation-responses.json'),JSON.stringify(publicBatchResponses,null,2));

  setFixture(null);await navigate('/usage');await waitFor('CURRENT ACCESS PERIOD');
  assert.ok(commands.slice(first).includes('GET /v1/usage'),'usage endpoint remains on Usage');
  await navigate('/connections');await waitFor('Your source, connected.');assert.ok(commands.slice(first).includes('GET /v1/drive/connection'));
  await navigate('/settings/brand');await waitFor('Who is your content for?');assert.ok(commands.slice(first).includes('GET /v1/brand'));assert.ok(commands.slice(first).includes('GET /v1/capabilities'));
  checks.push('new generation, transcription retry and import retry use UUID v7; exact lost-response and legacy keys survive reload');
  checks.push('other pages retain their account/brand/connection endpoints');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'project-reads-checks.json'),JSON.stringify({checks,forbiddenProjectReads:[],projectRequests,otherPageRequests:commands.slice(first+projectRequests.length)},null,2));
  console.log('PASS: Single project uses project resources only, sparse overrides and exact retry recovery; other pages retain account endpoints.');
}
