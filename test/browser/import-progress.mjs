import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkImportProgress({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,commands,setFixture,getFixture,notifyStream,eventFrame}) {
  const MiB=1024**2;
  const path='/v1/projects/detail_fixture';
  const progress=(stage,transferredBytes=0,totalBytes=null,attempt=1)=>({attempt,stage,transferredBytes,totalBytes});
  const state=()=>evaluate(`(()=>{const p=document.querySelector('.import-transfer [role=progressbar]');return {heading:document.querySelector('#source-activity-heading')?.textContent,detail:document.querySelector('.import-transfer-detail')?.textContent,value:p?.getAttribute('aria-valuenow')??null,label:p?.getAttribute('aria-label'),valueText:p?.getAttribute('aria-valuetext'),bars:document.querySelectorAll('.import-transfer [role=progressbar]').length,pageAnimations:document.querySelector('.project-workspace-page')?.getAnimations().filter(a=>a.playState==='running').length,bandAnimations:document.querySelector('.source-activity')?.getAnimations().filter(a=>a.playState==='running').length,headingTransform:document.querySelector('#source-activity-heading')?getComputedStyle(document.querySelector('#source-activity-heading')).transform:null,wrapperHeight:document.querySelector('.source-stage-motion')?.getBoundingClientRect().height,height:document.querySelector('.source-activity')?.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  async function open(overrides={}) {
    setFixture({mode:'ready',importing:true,empty:true,importStatus:'importing',...overrides});
    await navigate('/projects/detail_fixture');await waitUntil(`Boolean(document.querySelector('#source-activity-heading'))`,'source stage loaded');await sleep(220);
  }
  let revision=1;
  async function update(change,terminal=false) {
    const operation={projectId:'detail_fixture',kind:'import',id:getFixture().importOperationId??'import_initial'};
    Object.assign(getFixture(),change);
    const before=commands.filter(value=>value===`GET ${path}`).length;
    notifyStream(`${path}/operations/import/${operation.id}/events`,eventFrame(terminal?'terminal':'changed',operation,{status:getFixture().importStatus,terminal,...(!terminal&&getFixture().importProgress?{importAttempt:getFixture().importProgress.attempt,importUpdatedAt:++revision,importProgress:getFixture().importProgress}:{}),...(terminal?{outcome:getFixture().importStatus==='failed'?'failed':'succeeded'}:{})}),terminal);
    await waitUntil(`true`,'fixture notice');
    if(terminal) for(let i=0;i<100&&commands.filter(value=>value===`GET ${path}`).length===before;i++)await sleep(20);
    await sleep(40);
    if(!terminal) assert.equal(commands.filter(value=>value===`GET ${path}`).length,before,'progress frames do not refetch the project');
  }
  await open();await waitFor('Importing video');
  assert.equal(await evaluate(`document.querySelector('.create-content-chooser')===null && document.querySelector('.workspace-empty')===null`),true,'pending source has no irrelevant creation workspace');
  assert.equal(await evaluate(`document.querySelectorAll('a.source-original-link').length`),0,'original link lives in project settings');
  assert.equal((await state()).value,null,'older project without progress remains indeterminate');
  await update({importProgress:progress('download',84*MiB)});await waitFor('Downloading video');await waitFor('84 MB received');
  assert.equal((await state()).value,null);assert.equal((await state()).bars,0);
  await reloadDocument();await waitFor('84 MB received');await sleep(180);
  assert.equal((await state()).value,null,'reload restores unknown-total bytes without percentage');
  await update({importProgress:progress('download',84*MiB,168*MiB)});await waitFor('84 MB received');
  assert.equal((await state()).bars,0);assert.doesNotMatch((await state()).detail,/%|168 MB/);
  const known=await state();
  await update({importProgress:progress('download',100*MiB,168*MiB)});await waitFor('100 MB');
  assert.equal((await state()).height,known.height,'byte updates preserve source status geometry');
  await update({importProgress:progress('download',40*MiB,168*MiB)});
  assert.match((await state()).detail,/100 MB/,'older bytes do not regress a live attempt');
  await update({importProgress:progress('prepare')});await waitFor('Preparing video');
  assert.equal((await state()).value,null);assert.equal((await state()).bars,0);assert.equal((await state()).height,known.height,'preparation preserves the transfer area');assert.doesNotMatch((await state()).detail??'',/%|received|sent/);
  await update({importProgress:progress('upload',42*MiB,84*MiB)});await waitFor('Uploading to storage');await waitFor('50%');
  assert.equal((await state()).value,'50');assert.equal((await state()).height,known.height,'upload preserves the transfer area');
  await update({importProgress:progress('upload',84*MiB,84*MiB)});await waitFor('100%');await waitFor('Waiting for storage confirmation.');
  assert.match((await state()).valueText,/100%.*queued for upload.*Waiting for storage confirmation/);
  await capture('import-progress-upload-confirmation');
  assert.equal((await state()).heading,'Uploading to storage','queueing every byte is not storage confirmation');
  await update({importProgress:progress('download',84*MiB,84*MiB)});
  assert.equal((await state()).heading,'Uploading to storage','older stages do not regress');
  await update({importProgress:undefined,importStatus:'source_ready',importing:false},true);await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
  assert.equal((await state()).bars,0,'confirmed completion clears transfer details');
  await open({importProgress:progress('upload',20*MiB)});await waitFor('20 MB queued for upload');
  await update({importProgress:undefined,importStatus:'failed',importing:false},true);await waitFor('Import failed');
  assert.equal((await state()).bars,0,'failure clears previous transfer');
  await open({importOperationId:'import_retry',importStatus:'queued'});await waitFor('Waiting to import');
  assert.doesNotMatch((await state()).detail??'',/20 MB/,'retry queue does not reuse bytes');
  await update({importStatus:'importing',importProgress:progress('download',2*MiB,null,2)});await waitFor('2 MB received');
  assert.equal((await state()).value,null,'new attempt begins with its own bytes');
  const geometry=[], transitions=[];
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await open({importStatus:'queued'});await waitFor('Waiting to import');
    assert.equal(await evaluate(`Boolean(document.querySelector('.source-activity .generation-spinner'))`),true,'queued import signals live waiting');
    await capture(`import-queued-${width}`);
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(80);assert.equal(await evaluate(`document.querySelector('.source-activity').getAnimations({subtree:true}).filter(a=>a.playState==='running').length`),0,'queued liveness respects reduced motion');await command('Emulation.setEmulatedMedia',{features:[]});
  }
  await open({importProgress:progress('download',2*MiB,null,2)});
  assert.equal(await evaluate(`Boolean(document.querySelector('.import-transfer-detail .generation-spinner'))`),true,'download signals live transfer without fake progress');

  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);
    await capture(`import-progress-${width}`);
    const snapshot=await state();assert.equal(snapshot.overflow,false);assert.equal(snapshot.bars,0,'download has no progressbar');geometry.push({width,...snapshot});
  }
  await update({importProgress:progress('download',2*MiB,4*MiB,2)});await waitFor('2 MB received');assert.equal((await state()).bars,0);
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`import-progress-known-${width}`);
  }
  for(const theme of ['light','dark']) for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await open({importProgress:progress('download',2*MiB,4*MiB)});
    await evaluate(`document.documentElement.dataset.theme='${theme}'`);
    await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove();document.querySelector('.back-link').focus()`);
    const initial=await state();
    await update({importProgress:progress('download',3*MiB,4*MiB)});await waitFor('3 MB received');
    const bytes=await state();assert.equal(bytes.height,initial.height);assert.equal(bytes.pageAnimations,0);assert.equal(bytes.bandAnimations,0);assert.equal(bytes.headingTransform,'none');
    assert.equal(await evaluate(`document.activeElement.matches('.back-link')`),true,'byte updates preserve keyboard focus');
    for(const stage of ['prepare','upload']) {
      await update({importProgress:progress(stage,stage==='upload'?2*MiB:0,stage==='upload'?4*MiB:null)});
      await waitFor(stage==='prepare'?'Preparing video':'Uploading to storage');
      const frame=await state();assert.equal(frame.height,initial.height);assert.equal(frame.pageAnimations,0);assert.equal(frame.bandAnimations,0);transitions.push({width,stage,...frame});
      const png=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`import-${stage}-intermediate-${theme}-${width}.png`),Buffer.from(png.data,'base64'));
      await capture(`import-${stage}-${theme}-${width}`);
    }
    await update({importProgress:progress('upload',4*MiB,4*MiB)});await waitFor('Waiting for storage confirmation.');assert.equal((await state()).height,initial.height);
    await capture(`import-confirming-${theme}-${width}`);
    await update({importProgress:undefined,importStatus:'source_ready',importing:false},true);await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
    const completing=await state();assert.ok(completing.height<initial.height,'ready status is secondary to creation');assert.ok(completing.wrapperHeight>completing.height && completing.wrapperHeight<initial.wrapperHeight,'wrapper smoothly collapses between real stage heights');transitions.push({width,stage:'ready-intermediate',...completing});
    const completedPng=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`import-ready-intermediate-${theme}-${width}.png`),Buffer.from(completedPng.data,'base64'));
    if(width===375){await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);assert.ok((await state()).height<initial.height,'ready status stays compact with reduced motion');assert.equal(await evaluate(`document.querySelector('.source-stage-motion').getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length`),0);await command('Emulation.setEmulatedMedia',{features:[]});}
    await capture(`import-ready-${theme}-${width}`);const completed=await state();assert.ok(completed.height<initial.height);transitions.push({width,stage:'ready',...completed});
  }
  await open({importProgress:progress('upload',2*MiB,4*MiB)});
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate(`document.querySelector('.import-transfer').getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length`),0,'reduced motion disables progress animation');
  await update({importProgress:undefined,importStatus:'source_ready',importing:false},true);await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');assert.equal((await state()).height,0,'ready status is removed with reduced motion');
  assert.equal(await evaluate(`document.querySelector('.source-stage-motion').getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length`),0,'reduced motion disables stage and height motion');
  await command('Emulation.setEmulatedMedia',{features:[]});
  const stable=commands.length;await sleep(1100);assert.equal(commands.length,stable,'progress observation adds no polling');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'import-progress-checks.json'),JSON.stringify({geometry,transitions,knownAndUnknownTotals:true,reload:true,outOfOrder:true,prepareIndeterminate:true,storageConfirmation:true,failureAndRetry:true,noPolling:true,commands},null,2));
  console.log('PASS: Import transfer bytes, truthful totals, stage ordering, reload, completion, failure/retry, mobile/themes and reduced motion.');
}
