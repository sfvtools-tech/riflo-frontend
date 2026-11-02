import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkEager({evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,setFixture,getFixture,notifyStream,eventFrame,transcriptionCalls}) {
 const base={eager:true,empty:true,projectState:{preparation:'transcribing'}};
 const batch={id:'eager_batch',intent:'import_transcription',status:'transcribing',slots:[],errorCode:null};
 const getCount=()=>commands.filter(v=>v==='GET /v1/projects/detail_fixture').length;
 const postCount=()=>commands.filter(v=>v==='POST /v1/projects/detail_fixture/generate').length;
 async function assertBlocked(name){
  const before=postCount();
  const launcher=await evaluate(`Boolean(document.querySelector('.create-content-chooser button'))`);
  if(launcher){
   await click('Create content');
   await evaluate(`document.querySelector('[data-format=x_posts]').click()`);
   await waitUntil(`Boolean([...document.querySelectorAll('.create-content-dialog button')].find(b=>/^Generate X posts?$/.test(b.textContent.trim())))`,'generate action rendered');
   assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('.create-content-dialog button')].find(b=>/^Generate X posts?$/.test(b.textContent.trim()));const disabled=b.disabled;b.click();return disabled})()`),true);
   await capture(name+'-generate-disabled');
   await evaluate(`document.querySelector('.create-content-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`);
  }else assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>/^Generate /.test(b.textContent.trim())&&!b.disabled)`),false);
  await sleep(100);assert.equal(postCount(),before,'pending transcript never submits paid generation');
 }
 setFixture({...base,batch,mode:'processing',importing:true,importStatus:'importing',importOperationId:'eager_import',importProgress:{attempt:1,stage:'upload',transferredBytes:10,totalBytes:10}});
 await navigate('/projects/detail_fixture');await waitFor('Processing video');
 await sleep(200);
 assert.equal(await evaluate(`document.querySelectorAll('.generation-transcription-feedback').length`),0,'one import status section');
 await assertBlocked('eager-both-running');await capture('eager-both-running');
 const uploadGeometry=await evaluate(`document.querySelector('.source-activity').getBoundingClientRect().height`);
 getFixture().projectState.preparation='ready';
 notifyStream('/v1/projects/detail_fixture/operations/import/eager_import/events',eventFrame('changed',{projectId:'detail_fixture',kind:'import',id:'eager_import'},{status:'importing',terminal:false,preparation:'ready',importAttempt:1,importUpdatedAt:1,importProgress:getFixture().importProgress}),false);
 await waitFor('Saving video');await assertBlocked('eager-transcript-first');await sleep(220);
 assert.equal(await evaluate(`document.querySelector('.source-activity').getBoundingClientRect().height`),uploadGeometry,'completion ordering preserves layout');
 assert.equal(await evaluate(`document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')`),'100');
 await capture('eager-transcript-first');await reloadDocument();await waitFor('Saving video');await sleep(300);
 getFixture().projectState.preparation='transcribing';
 const before=getCount();
 Object.assign(getFixture(),{importProgress:{attempt:1,stage:'transcribe',transferredBytes:0,totalBytes:null}});
 notifyStream('/v1/projects/detail_fixture/operations/import/eager_import/events',eventFrame('changed',{projectId:'detail_fixture',kind:'import',id:'eager_import'},{status:'importing',terminal:false,preparation:'transcribing',importAttempt:1,importUpdatedAt:2,transcriptionStage:'transcribing',importProgress:getFixture().importProgress}),false);
 await waitFor('Preparing transcript');await sleep(100);assert.equal(getCount(),before,'direct progress does not issue another project GET');
 assert.equal(await evaluate(`document.querySelectorAll('[role=progressbar]').length`),0);
 assert.equal(await evaluate(`document.querySelector('.workspace-empty')===null`),true);
 assert.equal(await evaluate(`document.body.textContent.includes('Generating content')`),false);
 await capture('eager-upload-complete-transcribing');await assertBlocked('eager-upload-complete');
 setFixture({...base,mode:'processing',batch:{id:'eager_batch',intent:'import_transcription',status:'transcribing',slots:[],errorCode:null}});
 await reloadDocument();await waitFor('Preparing transcript');await sleep(150);
 assert.equal(await evaluate(`document.querySelector('.workspace-empty')===null`),true);
 await capture('eager-source-ready-transcribing');await assertBlocked('eager-source-ready');
 await navigate('/projects');await waitFor('Preparing transcript');await capture('eager-library-transcribing');
 setFixture({...base,empty:false,mode:'failed',projectState:{preparation:'failed'}});
 await navigate('/projects/detail_fixture');await waitFor('Retry transcription');
 assert.equal(await evaluate(`document.querySelector('.import-retry')===null`),true);
 await capture('eager-failed-retained-source');
 assert.equal(await evaluate(`document.body.textContent.includes('Preparing transcript…')`),false,'failed canonical transcript cannot show stale preparing');
 await click('Retry transcription');await waitFor('Preparing transcript');
 assert.equal(transcriptionCalls.length,1);
 await sleep(250);
 const generationReads=()=>commands.filter(v=>v==='GET /v1/projects/detail_fixture/generation').length;
 const stageReads=generationReads();
 const preparingFrame=eventFrame('changed',{projectId:'detail_fixture',kind:'generation',id:'transcript_retry_1'},{status:'transcribing',ready:0,failed:0,terminal:false,transcriptReady:false,transcriptionStage:'preparing_audio'});
 try{notifyStream('/v1/projects/detail_fixture/retry-transcription',preparingFrame,false)}catch{notifyStream('/v1/projects/detail_fixture/operations/generation/transcript_retry_1/events',preparingFrame,false)}
 await waitFor('Preparing audio for transcription.');
 const stageFrame=eventFrame('changed',{projectId:'detail_fixture',kind:'generation',id:'transcript_retry_1'},{status:'transcribing',ready:0,failed:0,terminal:false,transcriptReady:false,transcriptionStage:'transcribing'});
 try{notifyStream('/v1/projects/detail_fixture/retry-transcription',stageFrame,false)}catch{notifyStream('/v1/projects/detail_fixture/operations/generation/transcript_retry_1/events',stageFrame,false)}
 await waitFor('Transcribing your video.');
 assert.equal(generationReads(),stageReads,'retry stages merge without extra canonical reads');await capture('eager-retry-stage');

 getFixture().mode='ready';getFixture().projectState.preparation='ready';
 const terminal=eventFrame('terminal',{projectId:'detail_fixture',kind:'generation',id:'transcript_retry_1'},{status:'completed',ready:0,failed:0,terminal:true,outcome:'succeeded'});
 try{notifyStream('/v1/projects/detail_fixture/retry-transcription',terminal,true)}catch{notifyStream('/v1/projects/detail_fixture/operations/generation/transcript_retry_1/events',terminal,true)}
 await waitFor('Transcript ready.');await capture('eager-retry-ready');
 getFixture().retentionAvailability={transcriptAvailable:false,sourceAvailable:false,transcriptExpiresAt:new Date(Date.now()-1000).toISOString(),transcription:{status:'unavailable',retryAvailable:false,reason:'requires_reimport'}};
 await evaluate(`window.dispatchEvent(new Event('focus'))`);
 await waitUntil(`!document.body.textContent.includes('Transcript ready.')`,'expired transcript success banner removed');
 await waitFor('Saved detail content stays readable.');await capture('eager-transcript-expired-saved-content');
 setFixture({mode:'ready',empty:true});await reloadDocument();await waitFor('Give this video a new form.');await capture('eager-legacy-ready');
 await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'eager-checks.json'),JSON.stringify({passed:true,scenarios:['both-running','transcript-first-upload-pending','reload-transcript-first','upload-done-asr-pending','source-ready-asr-pending','library-preparation','retained-source-failure','explicit-retry-success','mounted-transcript-expiry-preserves-saved-content','legacy-ready'],commands},null,2));
}
