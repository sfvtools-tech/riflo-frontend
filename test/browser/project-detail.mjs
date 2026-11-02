import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkProjectDetail({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setFixture,getFixture,transcriptionCalls,notifyStream,eventFrame}) {
  const shots=[];
  async function screenshots(name,chooser=false) {
    for(const width of [1440,375]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove();document.querySelector('.create-content-chooser')?.removeAttribute('open')`);
      if(chooser) await evaluate(`document.querySelector('.create-content-chooser').open=true`);
      await sleep(250);await capture(`detail-${name}-${width}`);shots.push(`${name}-${width}`);
    }
  }
  async function open(fixture) {setFixture(fixture);await navigate('/projects/detail_fixture');await waitUntil(`Boolean(document.querySelector('.source-activity'))`,'loaded source');if((!fixture.importing && !fixture.importFailed) || !fixture.empty)await waitUntil(`Boolean(document.querySelector('.create-content-chooser') || document.querySelector('.project-first-generation'))`,'loaded content state');await sleep(250);}
  if(process.env.RIFLO_SMOKE_DETAIL_FOCUS_ONLY!=='1') {
  setFixture({mode:'ready',empty:true});holdReads.add('/v1/projects/detail_fixture');await navigate('/projects/detail_fixture');
  await waitUntil(`Boolean(document.querySelector('.project-state-skeleton'))`,'cold project stage');await screenshots('cold');
  assert.ok(await evaluate(`document.querySelector('.project-state-skeleton').getBoundingClientRect().height>=300`),'cold skeleton reserves primary state geometry');
  await releaseReads(['/v1/projects/detail_fixture']);
  await open({mode:'failed'});await waitFor('Retry transcription');
  assert.equal(await evaluate(`document.querySelectorAll('.generation-feedback').length`),1);
  await screenshots('transcript-failed');await screenshots('failed-chooser',true);
  await evaluate(`document.querySelector('.create-content-chooser')?.removeAttribute('open')`);
  getFixture().lost=true;await click('Retry transcription');await waitFor('Check retry status');
  assert.equal(transcriptionCalls.length,1);
  assert.equal(await evaluate(`document.querySelector('.generation-transcription-feedback .generation-spinner')===null`),true,'uncertain retry has no processing animation');
  assert.equal(await evaluate(`document.querySelector('.generation-transcription-feedback').getAttribute('aria-busy')`),'false');await screenshots('uncertain');
  await reloadDocument();await waitFor('Check retry status');
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check retry status');b.click();b.click()})()`);
  await waitFor('Preparing transcript…');await sleep(300);
  assert.equal(transcriptionCalls.length,2,'rapid replay admits one request');
  const key=request=>request.headers['Idempotency-Key']??request.headers['idempotency-key'];
  assert.equal(key(transcriptionCalls[0]),key(transcriptionCalls[1]),'reload and lost reply reuse exact key');
  assert.deepEqual(JSON.parse(transcriptionCalls[1].postData),{});
  assert.equal(await evaluate(`document.querySelectorAll('.generation-format.is-generating').length`),0,'transcription has no output-format loading claims');
  await screenshots('transcript-processing');await screenshots('processing-chooser',true);
  await evaluate(`document.querySelector('.create-content-chooser')?.removeAttribute('open')`);
  getFixture().mode='ready';
  const terminal=eventFrame('terminal',{projectId:'detail_fixture',kind:'generation',id:'transcript_retry_1'},{status:'completed',ready:0,failed:0,terminal:true,outcome:'succeeded'});
  try { notifyStream('/v1/projects/detail_fixture/retry-transcription',terminal,true); }
  catch { notifyStream('/v1/projects/detail_fixture/operations/generation/transcript_retry_1/events',terminal,true); }
  await waitFor('Transcript ready.');await sleep(300);
  assert.equal(await evaluate(`document.body.textContent.includes('Your new content is ready.')`),false);
  assert.equal(await evaluate(`document.querySelector('#saved-content-heading').textContent.includes('1 output')`),true);
  await screenshots('transcript-ready');await screenshots('ready-chooser',true);
  const stable=commands.length;await sleep(1300);assert.equal(commands.length,stable,'terminal operation does not poll forever');
  await open({mode:'permanent',empty:true});await waitFor('This video could not be transcribed.');await screenshots('permanent-empty');
  await open({mode:'permanent'});await waitFor('This video could not be transcribed.');await screenshots('permanent');await screenshots('permanent-chooser',true);
  assert.equal(await evaluate(`document.body.textContent.includes('Retry transcription')`),false);
  assert.equal(await evaluate(`document.querySelector('.generation-transcription-feedback .source-recovery-link')?.getAttribute('href')`),'https://drive.google.com/file/d/test_video/view','permanent transcript failure exposes original only for recovery');
  await open({mode:'expired'});await screenshots('expired-chooser',true);
  await open({mode:'ready',limit:true});await screenshots('allowance-chooser',true);
  assert.equal(await evaluate(`[...document.querySelectorAll('.generation-format button')].some(b=>b.textContent==='View')`),true);
  for(const theme of ['light','dark']) {
    await evaluate(`document.documentElement.dataset.theme='${theme}'`);
    await open({mode:'ready',empty:true});await screenshots(`empty-${theme}`);await screenshots(`empty-chooser-${theme}`,true);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'empty creation chooser fits mobile viewport');
    await evaluate(`document.querySelector('.create-content-chooser').open=false`);
    assert.equal(await evaluate(`document.querySelector('.workspace-empty')!==null`),true,'ready video has deliberate creation empty state');
    await open({mode:'ready',empty:true,batch:{id:'first_content',status:'generating',slots:[{id:'first_post',feature:'x_posts',status:'pending',errorCode:null}],errorCode:null}});
    await waitFor('Generating X post');await screenshots(`first-generation-${theme}`);
    assert.equal(await evaluate(`document.querySelector('.workspace-empty')===null`),true,'first generation replaces passive empty state');
    await open({mode:'ready',importFailed:true,empty:true,projectState:{errorCode:'drive_access_denied',importRetry:{available:true,reason:'source_access_required',availableAt:null}}});
    await waitFor('Retry import');await waitFor('Reconnect Google Drive');assert.equal(await evaluate(`document.querySelector('.source-activity .source-recovery-link')?.getAttribute('href')`),'https://drive.google.com/file/d/test_video/view','failed import offers original video directly');await screenshots(`import-failed-${theme}`);
    assert.equal(await evaluate(`document.querySelector('.create-content-chooser')===null`),true,'failed empty source keeps attention on recovery');
    await open({mode:'expired',projectState:{importRetry:{available:true,reason:'source_access_required',availableAt:null},sourceRestore:{available:true,reason:'revalidation_required',availableAt:null}}});
    assert.equal(await evaluate(`document.querySelector('.source-activity .source-recovery-link')?.getAttribute('href')`),'https://drive.google.com/file/d/test_video/view','expired source access failure offers original recovery');
    assert.equal(await evaluate(`Boolean(document.querySelector('.output-paper'))`),true,'expired source recovery retains saved outputs');
    await open({mode:'expired',projectState:{sourceRestore:{available:true,reason:'revalidation_required',availableAt:null}}});
    await waitFor('Restore source');await screenshots(`expired-saved-${theme}`);
    assert.equal(await evaluate(`Boolean(document.querySelector('.output-paper'))`),true,'source expiry preserves saved reader');
    await open({mode:'ready',importing:true,projectState:{importIntent:'source_restore'}});await screenshots(`restoring-saved-${theme}`);
    assert.equal(await evaluate(`Boolean(document.querySelector('.output-paper'))`),true,'source restoration preserves saved reader');
    await open({mode:'failed',importing:true,empty:true});await screenshots(`importing-${theme}`);
    assert.equal(await evaluate(`document.querySelector('.create-content-chooser')===null && document.querySelector('.workspace-empty')===null`),true,'pending source has no unavailable generation workspace');
  }
  }
  await open({mode:'ready',empty:true,acceptCreation:true,batch:{id:'transcript_previous',intent:'transcription_retry',status:'completed',slots:[],errorCode:null}});
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);
  await waitUntil(`[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Create X post' && !b.disabled)`,'first format is available');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Create X post').focus()`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`),'Create X post','first creation button owns focus');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor('Generating X post');
  assert.equal(await evaluate(`document.activeElement.matches('.generation-feedback')`),true,`keyboard creation hands focus from removed empty chooser to progress: ${await evaluate('document.activeElement.outerHTML.slice(0,500)')}`);
  await evaluate(`document.querySelector('.back-link').focus()`);
  getFixture().batch={id:'first_content',status:'failed',slots:[{id:'first_post',feature:'x_posts',status:'failed',errorCode:'provider_unavailable'}],errorCode:null};
  const failedFrame=eventFrame('terminal',{projectId:'detail_fixture',kind:'generation',id:'first_content'},{status:'failed',ready:0,failed:1,terminal:true,outcome:'failed'});
  try { notifyStream('/v1/projects/detail_fixture/generate',failedFrame,true); }
  catch { notifyStream('/v1/projects/detail_fixture/operations/generation/first_content/events',failedFrame,true); }
  await waitFor('Couldn’t create your content.');
  assert.equal(await evaluate(`document.activeElement.matches('.back-link')`),true,'later generation failure does not steal focus');
  await open({mode:'ready',empty:true,rejectCreation:true,batch:{id:'transcript_previous',intent:'transcription_retry',status:'completed',slots:[],errorCode:null}});
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);
  await waitUntil(`[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Create X post' && !b.disabled)`,'retry format available');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Create X post').click()`);
  await waitUntil(`Boolean(document.querySelector('.project-workspace .inline-notice[role=alert]'))`,'definitive rejection remains visible');
  assert.equal(await evaluate(`document.body.textContent.includes('Transcript ready.')`),false,'historical transcript success does not obscure new rejection');
  assert.equal(await evaluate(`document.body.textContent.includes('We couldn’t confirm whether it started.')`),false,'definitive rejection clears uncertain request');
  if(process.env.RIFLO_SMOKE_DETAIL_FOCUS_ONLY==='1'){await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'detail-focus-checks.json'),JSON.stringify({priorTranscriptRetry:true,keyboardFirstCreation:true,laterFailurePreservesFocus:true,definitiveRejectionVisible:true},null,2));console.log('PASS: First creation after transcript retry preserves keyboard focus through progress and later failure.');return;}
  const sourceGeometry=[];
  for(const theme of ['light','dark']) for(const width of [375,600,601,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<601});
    await open({mode:'ready',importing:true});
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('.create-content-chooser')?.removeAttribute('open')`);
    const sourceRect=()=>evaluate(`(()=>{const h=document.querySelector('#source-activity-heading'),a=document.querySelector('.source-activity'),s=document.querySelector('.project-source-summary');return {headingHeight:h?.getBoundingClientRect().height??0,headingFont:h?getComputedStyle(h).fontSize:null,headingDisplay:h?getComputedStyle(h).display:null,bandHeight:a.getBoundingClientRect().height,padding:getComputedStyle(a).padding,rowGap:getComputedStyle(s).rowGap,summaryHeight:s.getBoundingClientRect().height}})()`);
    const importing=await sourceRect();getFixture().importing=false;
    notifyStream('/v1/projects/detail_fixture/operations/import/import_initial/events',eventFrame('terminal',{projectId:'detail_fixture',kind:'import',id:'import_initial'},{status:'source_ready',terminal:true,outcome:'succeeded'}),true);
    await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');await sleep(250);
    const ready=await sourceRect();
    assert.equal(ready.headingDisplay,null,'completed source has no success heading');
    assert.equal(ready.bandHeight,0,'completed source leaves no status strip');
    assert.equal(await evaluate(`Boolean(document.querySelector('.output-paper'))`),true,'saved content stays readable during import and completion');
    sourceGeometry.push({theme,width,importing,ready});
  }
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'source-motion-geometry.json'),JSON.stringify(sourceGeometry,null,2));
  await open({mode:'ready'});await evaluate(`navigator.clipboard.writeText=async text=>{window.__detailCopied=text}`);await click('Copy text');await waitFor('Copied to clipboard.');
  await click('Download TXT');await sleep(250);
  assert.equal(await readFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'downloads','x_posts.txt'),'utf8'),'Saved detail content stays readable.');
  assert.equal(await evaluate(`document.querySelector('.output-paper .state-error')===null`),true);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Copy text').focus()`);await sleep(180);
  assert.equal(await evaluate(`document.activeElement.matches(':focus-visible')`),true);
  assert.match(await evaluate(`getComputedStyle(document.activeElement).boxShadow`),/3px/);
  await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`),'solid');
  await command('Emulation.setEmulatedMedia',{features:[]});
  await screenshots('loaded');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.create-content-chooser summary')).backgroundColor===getComputedStyle(document.body).backgroundColor`),false,'create disclosure keeps visible primary surface');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'detail-checks.json'),JSON.stringify({shots,retryCalls:transcriptionCalls.length,exactReplay:true,duplicateGuard:true,zeroOutputRetry:true,finiteTerminal:true,copyDownload:true},null,2));
  console.log('PASS: Project detail retry intent, exact replay/reload, duplicate guard, zero outputs, finite SSE, source restrictions and desktop/mobile light/dark.');
}
