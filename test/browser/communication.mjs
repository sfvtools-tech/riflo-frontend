import assert from 'node:assert/strict';
import {writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {eventFrame,notifyStream,streamEvidence,closeStreams} from './stream-fixture.mjs';

export async function checkCommunication({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,commands,setRegression,getRegression,getRegressionCalls,batch,artifacts}) {
  const checks=[];
  try {
  if(process.env.RIFLO_SMOKE_IMPORT_COMMUNICATION_ONLY!=='1') {
  const id='regression_stream';
  const operation={projectId:id,kind:'generation',id:batch.id};
  const post=`/v1/projects/${id}/generate`;
  const observation=`/v1/projects/${id}/operations/generation/${batch.id}/events`;
  setRegression({id,replies:['held'],saved:true});
  await navigate(`/projects/${id}`);await waitFor('Saved regression output remains available.');
  await waitUntil(`Boolean(document.querySelector('.generation-format button:not(:disabled)'))`,'generation available');
  const rowGeometry=()=>evaluate(`Array.from(document.querySelectorAll('.generation-format')).map(element=>{const r=element.getBoundingClientRect(),b=element.querySelector('button').getBoundingClientRect();return {left:r.left,top:r.top+scrollY,width:r.width,height:r.height,buttonWidth:b.width,buttonHeight:b.height}})`);
  await sleep(350);
  const readyGeometry=await rowGeometry();
  // Holding the actual request before headers makes the sending-state assertion independent of timing.
  await evaluate(`document.querySelector('.generation-format button').click()`);
  await waitUntil(`Array.from(document.querySelectorAll('.generation-format button')).every(button=>button.disabled)`,'sending feedback');
  assert.deepEqual(await rowGeometry(),readyGeometry,'Sending preserves action-row geometry');
  while(!getRegression().heldRequestId)await sleep(20);
  getRegression().active=true;getRegression().queued=true;
  const {streamReply}=await import('./stream-fixture.mjs');
  await command('Fetch.continueRequest',{requestId:getRegression().heldRequestId,url:streamReply(post,eventFrame('accepted',operation,{refresh:true,status:'queued',terminal:false}),true)});
  await waitFor('Your content is in the queue.');
  assert.deepEqual(await rowGeometry(),readyGeometry,'Queued progress preserves action-row geometry');
  assert.equal(await evaluate(`document.querySelector('.generation-status[role=status][aria-live=polite]')?.textContent.includes('queue')`),true,'Queued progress has an accessible live status');
  assert.equal(streamEvidence.findLast(item=>item.path===post).closed,false,'Queued UI renders before the POST stream closes');
  assert.ok(streamEvidence.findLast(item=>item.path===post).chunks.length>=4,'Real HTTP response delivered separate byte chunks');
  checks.push('real fetch renders accepted queued state while POST byte stream remains open');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`stream-queued-${width}`);
  }
  const readCount=()=>commands.filter(value=>value===`GET /v1/projects/${id}/generation`).length;
  assert.equal(streamEvidence.some(item=>item.path===observation),false,'Healthy command stream owns observation without parallel GET stream');
  const beforeHealthy=readCount();await sleep(3400);
  assert.equal(readCount(),beforeHealthy,'Healthy stream has no parallel polling');
  assert.equal(commands.filter(value=>value===`POST ${post}`).length,1,'One deliberate command');
  checks.push('healthy stream does not poll or submit again');
  notifyStream(post,eventFrame('stream_error',operation,{code:'observation_unavailable'}),true);
  await waitUntil(`document.body.innerText.includes('Your content is in the queue.')`,'disconnect preserves queued business state');
  for(let attempt=0;attempt<120&&!streamEvidence.some(item=>item.path===observation);attempt++)await sleep(50);
  assert.ok(streamEvidence.some(item=>item.path===observation),'Reconnect uses read-only GET operation route');
  assert.equal(commands.filter(value=>value===`POST ${post}`).length,1);
  checks.push('observation error preserves queued state and reconnects with GET only');
  await reloadDocument();await waitFor('Your content is in the queue.');
  for(let attempt=0;attempt<120&&!streamEvidence.findLast(item=>item.path===observation&&!item.closed);attempt++)await sleep(50);
  assert.ok(streamEvidence.findLast(item=>item.path===observation&&!item.closed),'Reload attaches active operation');
  assert.equal(commands.filter(value=>value===`POST ${post}`).length,1);
  checks.push('reload reads canonical active state and observes without a new command');
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))`);
  for(let attempt=0;attempt<120&&streamEvidence.some(item=>item.path===observation&&!item.closed);attempt++)await sleep(50);
  assert.equal(streamEvidence.some(item=>item.path===observation&&!item.closed),false,'Hidden tab closes observation');
  const hiddenReads=readCount();await sleep(3400);assert.equal(readCount(),hiddenReads,'Hidden tab has no polling');
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))`);
  for(let attempt=0;attempt<120&&!streamEvidence.some(item=>item.path===observation&&!item.closed);attempt++)await sleep(50);
  assert.ok(streamEvidence.some(item=>item.path===observation&&!item.closed),'Visible tab resynchronizes and observes');
  assert.ok(readCount()>hiddenReads,'Visible tab reads canonical state');
  checks.push('hidden-tab lifecycle closes observation and timers; return reads state and reattaches');
  // Keep a stale active snapshot in flight while a committed terminal notification arrives.
  getRegression().holdProgressOnce=true;
  notifyStream(observation,eventFrame('changed',operation,{status:'queued',terminal:false,refresh:true}));
  for(let attempt=0;attempt<120&&!getRegression().heldProgress;attempt++)await sleep(50);
  assert.ok(getRegression().heldProgress,'Canonical read held before subsequent notification');
  // The final read fails once at its canonical endpoint, then recovers independently.
  getRegression().active=false;getRegression().progressFailures=1;
  notifyStream(observation,eventFrame('terminal',operation,{terminal:true,status:'partial',outcome:'partial'}),true);
  const held=getRegression().heldProgress;
  await command('Fetch.fulfillRequest',{requestId:held.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({data:held.body})).toString('base64')});
  await waitFor('Some content is ready.');await waitFor('Saved regression output remains available.');
  assert.equal(getRegression().progressFailures,0,'Final canonical read failure was exercised');
  assert.equal(commands.filter(value=>value===`POST ${post}`).length,1);
  checks.push('notification arriving during a stale canonical read forces a follow-up read');
  checks.push('terminal partial outcome retries a failed canonical final read without new paid work');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`stream-partial-${width}`);
  }
  const idleReads=readCount();await sleep(3400);assert.equal(readCount(),idleReads,'Terminal operation does not poll');
  checks.push('terminal operation releases observation and idle timers');
  }
  const importId='regression_stream_import';
  setRegression({id:importId,import:true,importActive:true,replies:[]});
  await navigate('/projects');await waitFor('All projects');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('New project')).click()`);await waitFor('Paste a Google Drive video link');
  await evaluate(`(()=>{const input=document.querySelector('#drive-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://drive.google.com/file/d/test_video/view?resourcekey=original_key');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Import video')).click()`);
  await waitFor('Waiting to import');
  assert.equal(await evaluate('location.pathname'),`/projects/${importId}`,'Accepted import navigates without waiting for terminal');
  assert.equal(commands.filter(value=>value==='POST /v1/projects').length,1);
  assert.ok(streamEvidence.some(item=>item.path==='/v1/projects'),'Import used a real POST SSE response');
  assert.equal(await evaluate(`Object.keys(sessionStorage).some(key=>key.startsWith('riflo:import:'))`),false,'Acceptance resolves persisted import identity before navigation');
  checks.push('import accepted notification navigates before terminal, resolves exact intent, and observes queued work');
  getRegression().importActive=false;
  const importObservation=`/v1/projects/${importId}/operations/import/import_initial/events`;
  for(let attempt=0;attempt<120&&!streamEvidence.some(item=>item.path===importObservation&&!item.closed);attempt++)await sleep(50);
  notifyStream(importObservation,eventFrame('terminal',{projectId:importId,kind:'import',id:'import_initial'},{terminal:true,status:'source_ready',outcome:'succeeded'}),true);
  await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
  checks.push('import committed terminal state enables generation without creating it automatically');
  const supersededId='regression_superseded_import';
  setRegression({id:supersededId,import:true,replies:['lost','superseded']});
  await navigate('/projects');await waitFor('All projects');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('New project')).click()`);await waitFor('Paste a Google Drive video link');
  await evaluate(`(()=>{const input=document.querySelector('#drive-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://drive.google.com/file/d/test_video/view?resourcekey=original_key');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Import video')).click()`);await waitFor('Check import status');
  const pendingBefore=await evaluate(`Object.fromEntries(Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).map(key=>[key,sessionStorage.getItem(key)]))`);
  assert.equal(Object.keys(pendingBefore).length,1,'Unknown acceptance retains durable original identity and payload');
  await reloadDocument();await waitFor('Check import status');
  if(!await evaluate(`Boolean(document.querySelector('#drive-link'))`)) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Check import status')).click()`);
    await waitUntil(`Boolean(document.querySelector('#drive-link'))`,'restored import dialog');
  }
  assert.deepEqual(await evaluate(`Object.fromEntries(Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')).map(key=>[key,sessionStorage.getItem(key)]))`),pendingBefore,'Reload keeps exact original import intent');
  await evaluate(`sessionStorage.setItem('riflo:batch:unrelated-project','keep-unrelated-intent');Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Check import status')).click()`);
  await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
  assert.equal(await evaluate('location.pathname'),`/projects/${supersededId}`);
  assert.equal(await evaluate(`Object.keys(sessionStorage).some(key=>key.startsWith('riflo:import:'))`),false,'Accepted superseded response resolves matching intent');
  assert.equal(await evaluate(`sessionStorage.getItem('riflo:batch:unrelated-project')`),'keep-unrelated-intent','Unrelated pending intent remains');
  const recovered=getRegressionCalls().slice(-2);
  assert.equal(recovered[0].headers['Idempotency-Key'],recovered[1].headers['Idempotency-Key'],'Recovery replays original request key');
  assert.equal(recovered[0].postData,recovered[1].postData,'Recovery replays exact original input');
  assert.deepEqual(JSON.parse(recovered[1].postData),{fileId:'test_video',resourceKey:'original_key'});
  checks.push('lost import acceptance survives reload with exact original payload; superseded accepted 409 resolves matching request only');
  } finally {
  closeStreams();
  const files=await readdir(artifacts);
  const screenshots=[];
  for(const name of files.filter(name=>name.endsWith('.png')&&name.startsWith('stream-'))) {
    const bytes=await readFile(join(artifacts,name));screenshots.push({name,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const sourceHashes=[];
  for(const path of ['src/shared/api/client.ts','src/shared/api/operation-stream.ts','src/features/projects/GenerationPanel.tsx','src/features/projects/LiveProjectDetail.tsx','src/features/projects/observe-operation.ts','src/features/projects/ImportVideo.tsx','src/features/projects/ImportRetry.tsx']) {
    try {sourceHashes.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await writeFile(join(artifacts,'communication-checks.json'),JSON.stringify({checks,screenshots,sourceHashes,transport:streamEvidence,requests:commands},null,2));
  }
  console.log(process.env.RIFLO_SMOKE_IMPORT_COMMUNICATION_ONLY==='1' ? 'PASS: direct import POST real HTTP SSE acceptance/navigation, terminal completion and superseded exact replay.' : 'PASS: real HTTP SSE byte chunks, mid-flight queued feedback, one command, read-only reconnect/reload, healthy stream excludes polling, final saved-state retry, partial results, terminal cleanup, 375/1440 light/dark screenshots.');
}
