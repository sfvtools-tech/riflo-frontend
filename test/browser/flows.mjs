import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {streamReply, eventFrame, streamEvidence, closeStreams, notifyStream} from './stream-fixture.mjs';

const artifacts=process.env.RIFLO_SMOKE_ARTIFACTS;
const pages=await (await fetch('http://127.0.0.1:9248/json')).json();
const socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
await new Promise(resolve=>socket.onopen=resolve);
let sequence=0;
const pending=new Map();
const commands=[];
const brandEvidence=[];
function command(method,params={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command stalled: ${method}`))},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject,method});
    socket.send(JSON.stringify({id,method,params}));
  });
}
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function evaluate(expression) {
  // Format actions live in a disclosure; open it before real interaction or geometry checks.
  if(expression.includes('.generation-format')) await command('Runtime.evaluate',{expression:"document.querySelector('.create-content-chooser')?.setAttribute('open','')"});
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(text,attempts=120) {
  for(let attempt=0;attempt<attempts;attempt++) {
    try {if((await evaluate('document.body?.innerText ?? ""')).includes(text))return;} catch(cause) {if(!/navigated or closed|context was destroyed|Cannot find context/.test(cause.message))throw cause;}
    await sleep(50);
  }
  throw Error(`Missing ${text}: ${await evaluate('document.body?.innerText ?? ""')}`);
}
async function waitUntil(expression,description) {
  for(let attempt=0;attempt<120;attempt++) {
    try {if(await evaluate(expression))return;} catch(cause) {if(!/navigated or closed|context was destroyed|Cannot find context/.test(cause.message))throw cause;}
    await sleep(50);
  }
  throw Error(`Missing ${description}: ${await evaluate('document.body?.innerText ?? ""')}`);
}
async function click(text) {
  await waitFor(text);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes(${JSON.stringify(text)})).click()`);
}
async function navigate(path) {
  await command('Page.navigate',{url:`http://127.0.0.1:5188${path}`});
}
async function reloadDocument() {
  await evaluate('window.__reloading = true');
  await command('Page.reload');
  await waitUntil('!window.__reloading', 'reloaded document');
}
async function capture(name) {
  if(process.env.RIFLO_SMOKE_DETAIL_REGRESSIONS_ONLY==='1') return;
  const expectedWidth = Number(name.match(/-(375|768|1440)$/)?.[1]);
  for(const theme of ['light','dark']) {
    await evaluate(`(()=>{const radio=document.querySelector('input[name=appearance][value="'+${JSON.stringify(theme)}+'"]');if(radio){radio.click();return;}const select=document.querySelector('[aria-label=Appearance]');if(select){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(theme)});select.dispatchEvent(new Event('change',{bubbles:true}));return;}document.documentElement.dataset.appearance=${JSON.stringify(theme)};try{localStorage.setItem('riflo:appearance',${JSON.stringify(theme)});}catch{}window.dispatchEvent(new Event('riflo:appearance'));})()`);
    await sleep(300);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.page-skeleton [aria-hidden] *')).every(element=>{const rect=element.getBoundingClientRect();return rect.left>=-1&&rect.right<=(${expectedWidth || 'document.documentElement.clientWidth'})+1})`),true,`${name}: cold layout stays within device viewport`);
    if (process.env.RIFLO_SMOKE_BRAND_ONLY === '1') {
      const audit = await evaluate(`(()=>{
        const probe=document.createElement('span');document.body.append(probe);
        const role=name=>{probe.style.color='var(--'+name+')';return getComputedStyle(probe).color};
        const copper=role('editorial'), blue=role('primary'), warning=role('warning');probe.remove();
        const rows=Array.from(document.querySelectorAll('.brand-dot,.accent-text,.format-number,.output-format-label,.output-index button:not([aria-pressed="true"]):not(:hover) span,.editorial-text,.stack-back > span:first-child')).map(el=>{
          let parent=el,background='';
          while(parent){const bg=getComputedStyle(parent).backgroundColor;if(!bg.endsWith(', 0)')&&bg!=='transparent'){background=bg;break;}parent=parent.parentElement;}
          return {text:el.textContent.trim(),color:getComputedStyle(el).color,background};
        });
        const surfaces=Array.from(document.querySelectorAll('body,.sidebar,.page,.signin-story,.signin-form,.stack-card,.output-paper,.connection-mark')).map(el=>({name:el.className||el.tagName,color:getComputedStyle(el).backgroundColor}));
        return {copper,blue,warning,rows,surfaces,exit:document.querySelector('.preview-bar a')?getComputedStyle(document.querySelector('.preview-bar a')).color:null};
      })()`);
      const lum=color=>{const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
      for (const row of audit.rows) {
        assert.equal(row.color,audit.copper,`${name}: ${row.text} uses visible editorial copper`);
        const a=lum(row.color),b=lum(row.background);
        assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${name}: ${row.text} contrast`);
      }
      assert.notEqual(audit.copper,audit.blue);assert.notEqual(audit.copper,audit.warning);
      if(audit.exit)assert.equal(audit.exit,audit.blue,'preview exit is an action');
      for(const surface of audit.surfaces){const c=surface.color.match(/[\d.]+/g).map(Number);assert.equal(c[0],c[1],surface.name);assert.equal(c[1],c[2],surface.name);}
      brandEvidence.push({name,theme,...audit});
    }
    if (process.env.RIFLO_SMOKE_FEEDBACK_ONLY === '1') {
      const feedback=await evaluate(`(()=>{
        const probe=document.createElement('span');document.body.append(probe);
        const role=name=>{probe.style.color='var(--'+name+')';return getComputedStyle(probe).color};
        const roles={success:role('success'),error:role('error'),warning:role('warning')};probe.remove();
        return Array.from(document.querySelectorAll('.state-success,.state-error,.state-warning')).map(el=>{
          let parent=el,background='';while(parent){const bg=getComputedStyle(parent).backgroundColor;if(!bg.endsWith(', 0)')&&bg!=='transparent'){background=bg;break;}parent=parent.parentElement;}
          const tone=['success','error','warning'].find(t=>el.classList.contains('state-'+t));
          return {text:el.textContent.trim(),tone,actual:getComputedStyle(el).color,expected:roles[tone],background};
        });
      })()`);
      const lum=color=>{const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
      for(const row of feedback){assert.equal(row.actual,row.expected,`${name}: ${row.text} semantic color`);const a=lum(row.actual),b=lum(row.background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${name}: ${row.text} contrast`);}
      brandEvidence.push({name,theme,feedback});
    }
    const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    const pngBytes = Buffer.from(screenshot.data,'base64');
    if (expectedWidth) assert.equal(pngBytes.readUInt32BE(16), expectedWidth, `${name}: screenshot width matches device viewport`);
    await writeFile(join(artifacts,`${name}-${theme}.png`),pngBytes);
  }
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${name}: horizontal page overflow`);
}
const formats=['x_posts','linkedin_posts','blogs','newsletters','carousels','short_videos'];
const counts=value=>Object.fromEntries(['sourceSeconds',...formats].map(key=>[key,value]));
const usage={startsAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',limits:counts(10),consumed:counts(2),reserved:counts(1),remaining:counts(7)};
usage.limits.sourceSeconds=3600;usage.consumed.sourceSeconds=125.25;usage.reserved.sourceSeconds=60;usage.remaining.sourceSeconds=3414.75;
const source={fileId:'test_video',name:'A conversation worth keeping — test fixture.mp4',mimeType:'video/mp4',bytes:50000000,durationSeconds:75};
const youtubeSource={source:'youtube',videoId:'abcdefghijk',name:'A YouTube conversation — test fixture',mimeType:'video/mp4',bytes:null,durationSeconds:null};
const project={id:'test_project',importOperationId:'import_initial',status:'source_ready',source,createdAt:'2026-10-18T00:00:00Z',sourceExpiresAt:'2026-10-25T00:00:00Z',attempts:1,errorCode:null};
function publicProjectFixture(value) {
  if(Array.isArray(value))return value.map(publicProjectFixture);
  if(!value?.id||!value.status||!value.source?.name)return value;
  const {attempts,updatedAt,source:details,...fields}=value;
  const metadata={name:details.name,bytes:details.bytes,durationSeconds:details.durationSeconds};
  return {...fields,errorCode:value.status==='failed'?value.errorCode:null,source:details.source==='youtube'?{source:'youtube',videoId:details.videoId,...metadata}:{source:'drive',fileId:details.fileId,...metadata}};
}
const publicBatchResponses=[];
const publicOutputResponses=[];
function publicBatchFixture(value) {
  if(!value?.id||!Array.isArray(value.slots))return value;
  const slots=value.slots.map(({id,feature,status,errorCode,credits,maxCredits,deliveredPosts})=>({id,feature,status,errorCode:status==='failed'?errorCode??null:null,...(credits!==undefined?{credits}:{}),...(maxCredits!==undefined?{maxCredits}:{}),...(deliveredPosts!==undefined?{deliveredPosts}:{})}));
  const failures=slots.filter(slot=>slot.status==='failed');
  const errorCode=value.status!=='failed'?null:value.intent==='transcription_retry'?value.errorCode??null:failures.length&&failures.every(slot=>slot.errorCode===failures[0].errorCode)?failures[0].errorCode:null;
  return {id:value.id,...(value.intent?{intent:value.intent}:{}),status:value.status,slots,errorCode,...(value.brand?{brand:{status:value.brand.status}}:{}),...(value.controls?{controls:value.controls}:{})};
}
const youtubeProject={...project,id:'test_youtube_project',source:{...youtubeSource,bytes:12000,durationSeconds:75}};
const batch={id:'batch_initial',status:'partial',slots:formats.map((feature,index)=>({id:`slot${index}`,feature,status:index===2?'failed':'ready',errorCode:index===2?'test_provider_failure':null}))};
const threadOptions = {
  version:1,available:true,threadAvailable:true,focusMaxCharacters:500,defaultsStatus:'resolved',
  defaults:{x_posts:{mode:'thread',maxPosts:10,numbering:'include'}},builtins:{x_posts:{length:'auto',mode:'single'}},
  choices:{x_posts:{length:['auto','short','standard'],mode:['single','thread'],maxPosts:[2,3,4,5,6,7,8,9,10],numbering:['include','exclude']},
    linkedin_posts:{length:['auto','short','medium','long']},blogs:{length:['auto','short','medium','long']},newsletters:{length:['auto','short','medium','long']},
    carousels:{density:['auto','standard','light'],theme:['auto','dark','light']},short_videos:{duration:['auto',15,30,45,60],editing:['auto','continuous'],captions:['clean','off']}}
};
const controlsFixture = {
  available:true, defaults:{}, defaultsStatus:'resolved', settingsReadFails:false, settingsSaveFails:false,
  settingsCalls:[], generationCalls:[], replies:[], accepted:new Map(), batch:null, outputs:[],
  builtins:{x_posts:{length:'auto',mode:'single'},linkedin_posts:{length:'auto'},blogs:{length:'auto'},newsletters:{length:'auto'},
    carousels:{density:'auto',theme:'auto'},short_videos:{duration:'auto',editing:'auto',captions:'off'}},
};
const threadOutputs = [6,1].map(count => {
  const posts=Array.from({length:count},(_,index)=>`Supported thought ${index+1} in a ${count}-post result.`);
  return {id:`thread_${count}`,feature:'x_posts',text:posts.map((post,index)=>`${index+1}/${count} ${post}`).join('\n\n'),expiresAt:'2030-01-01T00:00:00Z',
    data:{kind:'thread',status:'ok',posts,numbering:'include'},deliveredPosts:count,credits:count,requestedMaxPosts:10};
});
const output=(id,feature,text)=>({id,feature,text,expiresAt:'2026-11-18T00:00:00Z'});
const outputs=[
  output('text','x_posts','A useful test fixture thought. <script>literal only</script>'),
  {...output('slides','carousels',''),assets:[{id:'slide1',contentType:'image/png',downloadPath:'/v1/projects/test_project/outputs/slides/assets/slide1/download'}]},
  {...output('clip','short_videos',''),assets:[{id:'clip1',contentType:'video/mp4',downloadPath:'/v1/projects/test_project/outputs/clip/assets/clip1/download'}]},
];
const youtubeOutputs=formats.map((feature,index)=>feature==='carousels'||feature==='short_videos'?{...outputs.find(item=>item.feature===feature),assets:outputs.find(item=>item.feature===feature).assets.map(asset=>({...asset,downloadPath:asset.downloadPath.replace('test_project','test_youtube_project')}))}:output(`youtube-${index}`,feature,`YouTube source fixture · ${feature}`));
const youtubeBatch={id:'batch_youtube',status:'completed',slots:formats.map((feature,index)=>({id:`yt-slot${index}`,feature,status:'ready',errorCode:null}))};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZp8AAAAASUVORK5CYII=','base64');
let mp4;
let youtubeOnly=false;
let driveStatusMode='ok';
const heldDriveRequests=[];
let youtubeDenied=true;
let youtubeImported=false;
let youtubeGenerated=false;
const youtubeGenerations=[];
const youtubeImports=[];
const youtubeValidations=[];
let generated=false;
let imported=false;
let expired=false;
let lifecycleCapabilities=null;
let disconnected=false;
let connectionDeleteFailure=false;
let failUsage=false;
let failTextDownload=false;
const imports=[];
const generations=[];
const downloads=[];
let regression=null;
let allowanceMode='ok';
const retryCalls=[];
let retryFixture=null;
let detailFixture=null;
let projectListMode='ok';
const transcriptionCalls=[];
const regressionCalls=[];
const holdReads = new Set();
const heldReads = [];
let brandProfile = null;
let brandFails = false;
let sharedAccessFails = false;
let brandSaveFails = false;
const brandCalls = [];
const brandLimits = {name:120,description:2000,audience:1000,voice:1000,language:80,spelling:80,writingExample:8000,avoidPhrases:{count:30,length:120},colours:{count:8,length:7},fonts:{count:5,length:100}};
async function releaseReads(paths = [...holdReads]) {
  for (const path of paths) holdReads.delete(path);
  for (const event of heldReads.splice(0)) {
    try { await respond(event); }
    catch (error) {
      // Route changes abort old reads while Chrome still lists their paused fixtures.
      if (!error.message.includes('Invalid InterceptionId')) throw error;
    }
  }
}
async function respond({request,requestId}) {
  const path=new URL(request.url).pathname;
  if (request.method === 'GET' && holdReads.has(path)) { heldReads.push({request,requestId}); return; }
  assert.match(request.headers.Authorization??request.headers.authorization,/^Bearer /,`${request.method} ${path} requires fixture authentication`);
  commands.push(`${request.method} ${path}`);
  let body,status=200,contentType='application/json';
  const extraHeaders=[];
  if(detailFixture && path.startsWith('/v1/projects/detail_fixture')) {
    const f=detailFixture;
    const active=f.mode==='processing';
    const permanent=f.mode==='permanent';
    const ready=f.mode==='ready';
    const unavailable=f.mode==='expired';
    const operation={projectId:'detail_fixture',kind:'generation',id:'transcript_retry_1'};
    const transcript=f.importing&&!f.eager?{status:'not_started',retryAvailable:false,reason:'source_not_ready'}:{status:ready?'ready':active?'processing':unavailable?'unavailable':'failed',retryAvailable:!ready&&!active&&!permanent&&!unavailable,reason:ready?'transcript_ready':active?'generation_in_progress':permanent?'transcription_not_retryable':unavailable?'requires_reimport':'available',errorCode:permanent?'no_audio':'provider_unavailable'};
    if(request.method==='DELETE' && path==='/v1/projects/detail_fixture') {
      const reply=f.deleteReplies?.shift();
      if(reply==='held'){f.deleteRequestId=requestId;return;}
      if(reply==='lost'){f.deleted=true;await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
      if(reply==='malformed')body={deleted:'yes',cleanup:'pending'};
      else if(reply==='setup'){status=503;body={error:{code:'intake_not_configured'}};}
      else if(reply==='error'){status=503;body={error:{code:'service_unavailable',message:'private provider details'}};}
      else {f.deleted=true;body={deleted:true,cleanup:'pending'};}
    } else if(f.deleted){status=404;body={error:{code:'project_not_found'}};}
    else if(f.projectBroken && path==='/v1/projects/detail_fixture'){status=503;body={error:{code:'service_unavailable'}};}
    else if(path.endsWith('/retry-transcription')) {
      transcriptionCalls.push(request);
      if(f.lost){f.lost=false;await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
      f.job=true;f.mode='processing';
      await command('Fetch.continueRequest',{requestId,url:streamReply(path,eventFrame('accepted',operation,{status:'queued',ready:0,failed:0}),true)});return;
    } else if(request.method==='POST' && path.endsWith('/generate') && f.rejectCreation) {
      status=403;body={error:{code:'allowance_exceeded'}};
    } else if(request.method==='POST' && path.endsWith('/generate') && f.acceptCreation) {
      f.batch={id:'first_content',status:'generating',slots:[{id:'first_post',feature:'x_posts',status:'pending',errorCode:null}],errorCode:null};
      await command('Fetch.continueRequest',{requestId,url:streamReply(path,eventFrame('accepted',{projectId:'detail_fixture',kind:'generation',id:f.batch.id},{status:'generating',ready:0,failed:0}),true)});return;
    } else if(f.importing && path.includes('/operations/import/')) {
      await command('Fetch.continueRequest',{requestId,url:streamReply(path,eventFrame('changed',{projectId:'detail_fixture',kind:'import',id:f.importOperationId??'import_initial'},{status:f.importStatus??'queued',terminal:false}),true)});return;
    } else if(f.batch && path.includes('/operations/')) {
      await command('Fetch.continueRequest',{requestId,url:streamReply(path,eventFrame('changed',{projectId:'detail_fixture',kind:'generation',id:f.batch.id},{status:f.batch.status,ready:0,failed:0,terminal:false}),true)});return;
    } else if(path.includes('/operations/')) {
      const frames=eventFrame(active?'changed':'terminal',operation,{status:active?'transcribing':'completed',ready:0,failed:0,terminal:!active,...(!active?{outcome:'succeeded'}:{})});
      await command('Fetch.continueRequest',{requestId,url:streamReply(path,frames,active)});return;
    } else if(path.endsWith('/generation/availability')) {
      if(f.availabilityBroken){status=503;body={error:{code:'service_unavailable'}};}
      else body={sourceAvailable:!unavailable&&!f.importing,transcriptAvailable:ready,sourceExpiresAt:null,transcriptExpiresAt:null,activeBatch:active,transcription:transcript,outputs:Object.fromEntries(formats.map(feature=>[feature,{available:!f.importing&&!active&&!permanent&&!unavailable&&!f.limit&&(!f.projectState?.preparation||ready),reason:f.importing?'source_not_ready':active?'generation_in_progress':permanent?'transcription_not_retryable':unavailable?'requires_reimport':f.limit?'allowance_exceeded':f.projectState?.preparation&&!ready?'transcript_not_ready':'available'}]))};
    } else if(path.endsWith('/generation')) {
      if(f.batch)body=f.batch;else if(f.job)body={id:operation.id,intent:'transcription_retry',status:active?'transcribing':ready?'completed':'failed',slots:[],errorCode:!active&&!ready?transcript.errorCode:null};else{status=404;body={error:{code:'generation_not_found'}};}
    } else if(path.endsWith('/download')) {contentType=path.includes('slide1')?'image/png':'text/plain';body=contentType==='image/png'?png:Buffer.from('Saved detail content stays readable.');}
    else if(path.endsWith('/outputs')) body=f.savedOutputs??(f.empty?[]:[output('detail_saved','x_posts','Saved detail content stays readable.')]);
    else body={...project,id:'detail_fixture',sourceUrl:'https://drive.google.com/file/d/test_video/view',status:f.importStatus??(f.importFailed?'failed':unavailable?'source_expired':f.importing?'queued':'source_ready'),...(f.importProgress?{importProgress:f.importProgress}:{}),...(f.importOperationId?{importOperationId:f.importOperationId}:{}),...(f.projectState??{})};
  } else if(process.env.RIFLO_SMOKE_CONTROLS_ONLY === '1' && path==='/v1/generation-defaults') {
    controlsFixture.settingsCalls.push(request);
    if((request.method==='GET'&&controlsFixture.settingsReadFails)||(request.method==='PUT'&&controlsFixture.settingsSaveFails)) {
      status=503;body={error:{code:'generation_defaults_unavailable'}};
    } else {
      if(request.method==='PUT') controlsFixture.defaults=JSON.parse(request.postData);
      body={defaults:controlsFixture.defaults,controls:{version:1,available:controlsFixture.available,choices:threadOptions.choices,builtins:controlsFixture.builtins}};
    }
  } else if(process.env.RIFLO_SMOKE_CONTROLS_ONLY === '1' && path.startsWith('/v1/projects/controls_fixture')) {
    const f=controlsFixture;
    const availabilityExpiry=f.availabilityExpiry ?? null;
    const expiredAvailabilityFailure=f.failExpiredAvailability && availabilityExpiry && Date.parse(availabilityExpiry)<=Date.now();
    if(path.endsWith('/generation/availability') && f.delayAvailability)await sleep(f.delayAvailability);
    if(path.endsWith('/generation/availability') && (f.availabilityBroken || expiredAvailabilityFailure)) {status=503;body={error:{code:'service_unavailable'}};}
    else if(path.endsWith('/generation/availability')) body={sourceAvailable:true,transcriptAvailable:true,sourceExpiresAt:availabilityExpiry,transcriptExpiresAt:null,activeBatch:false,
      credits:{remaining:f.remaining ?? 100,costs:{x_posts:1,linkedin_posts:1,blogs:1,newsletters:1,carousels:3,short_videos:6}},
      controls:{...threadOptions,available:f.available,threadAvailable:f.available,builtins:f.builtins,defaults:f.defaultsStatus==='unavailable'?{}:f.defaults,defaultsStatus:f.defaultsStatus},
      outputs:Object.fromEntries(formats.map(format=>[format,{available:true,reason:'available'}]))};
    else if(path.endsWith('/generate')) {
      f.generationCalls.push(request);
      if(f.delayGeneration)await sleep(f.delayGeneration);
      const input=JSON.parse(request.postData);
      const key=request.headers['Idempotency-Key'];
      if(!f.accepted.has(key)) {
        const fields={},origins={};
        for(const format of Object.keys(input.outputs)) {
          const defaults=f.defaultsStatus==='unavailable'?{}:f.defaults[format]??{};
          const explicit=input.controls?.formats?.[format]??{};
          fields[format]={...f.builtins[format],...defaults,...explicit};
          origins[format]=Object.fromEntries(Object.keys(fields[format]).map(field=>[field,Object.hasOwn(explicit,field)?'explicit':Object.hasOwn(defaults,field)?'saved':'builtin']));
        }
        const number=f.accepted.size+1;
        const feature=Object.keys(input.outputs)[0];
        const id=`controls_output_${number}`;
        const controls={version:1,status:f.defaultsStatus,formats:fields,origins,...(input.controls?.focus?{focus:input.controls.focus}:{}),...(input.controls?.sourceWindow?{sourceWindow:input.controls.sourceWindow}:{})};
        f.batch={id:`controls_batch_${number}`,status:'completed',slots:[{id,feature,status:'ready',errorCode:null}],brand:{status:feature==='short_videos'?'not_applicable':input.brand?.mode==='none'?'none':'applied'},controls};
        f.accepted.set(key,structuredClone(f.batch));
        f.outputs.push({id,feature,text:`Saved ${feature} result ${number}.`,expiresAt:'2030-01-01T00:00:00Z'});
      }
      f.batch=structuredClone(f.accepted.get(key));
      if(f.replies.shift()==='lost') {await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
      body=f.batch;
    } else if(path.endsWith('/generation')) {
      if(f.resultsBroken){status=503;body={error:{code:'service_unavailable'}};}
      else if(f.batch)body=f.batch;else{status=404;body={error:{code:'generation_not_found'}};}
    } else if(path.endsWith('/outputs')) {if(f.delayOutputs)await sleep(f.delayOutputs);body=f.outputs;}
    else if(path.endsWith('/download')) {contentType='text/plain';body=Buffer.from(f.outputs.find(output=>path.includes(`/outputs/${output.id}/`)).text);}
    else if(path.includes('/operations/')) {
      const frames=eventFrame('terminal',{projectId:'controls_fixture',kind:'generation',id:f.batch.id},{status:'completed',ready:1,failed:0,terminal:true,outcome:'succeeded'});
      await command('Fetch.continueRequest',{requestId,url:streamReply(path,frames,false)});return;
    } else body={...project,id:'controls_fixture'};
  } else if(process.env.RIFLO_SMOKE_THREADS_ONLY === '1' && path.startsWith('/v1/projects/thread_fixture')) {
    if(path.endsWith('/outputs')) body=threadOutputs;
    else if(path.endsWith('/generation/availability')) body={sourceAvailable:true,transcriptAvailable:true,sourceExpiresAt:null,transcriptExpiresAt:null,activeBatch:false,
      credits:{remaining:8,costs:Object.fromEntries(formats.map(format=>[format,1]))},controls:threadOptions,outputs:Object.fromEntries(formats.map(format=>[format,{available:true,reason:'available'}]))};
    else if(path.endsWith('/generation')) {status=404;body={error:{code:'generation_not_found'}};}
    else if(path.endsWith('/download')) {contentType='text/plain';body=Buffer.from(threadOutputs.find(output=>path.includes(`/outputs/${output.id}/`)).text);}
    else body={...project,id:'thread_fixture'};
  } else if(path==='/v1/generation-defaults' && process.env.RIFLO_SMOKE_GENERATION_DEFAULTS_ONLY === '1') {
    body={defaults:{blogs:{length:'short'}},controls:{version:1,available:true,builtins:controlsFixture.builtins,choices:{
      x_posts:{length:['auto','short','standard'],mode:['single','thread'],maxPosts:[2,3,4,5,6,7,8,9,10],numbering:['include','exclude']},
      linkedin_posts:{length:['auto','short','medium','long']},blogs:{length:['auto','short','medium','long']},newsletters:{length:['auto','short','medium','long']},
      carousels:{density:['auto','standard','light'],theme:['auto','dark','light']},short_videos:{duration:['auto',15,30,45,60],editing:['auto','continuous'],captions:['clean','off']},
    }}};
  } else if(path==='/v1/generation-defaults') {
    body={defaults:{},controls:{version:1,available:false,builtins:controlsFixture.builtins,choices:threadOptions.choices}};
  } else if(path==='/v1/brand') {
    brandCalls.push(request);
    if ((request.method==='PUT'&&brandSaveFails)||(request.method==='GET'&&brandFails)) { status=503;body={error:{code:'brand_unavailable'}}; }
    else { if(request.method==='PUT')brandProfile=JSON.parse(request.postData);body=brandProfile; }
  } else if(path.match(/\/operations\/(import|generation)\/[A-Za-z0-9_-]+\/events$/)) {
    const [, projectId, kind, id] = path.match(/\/projects\/([^/]+)\/operations\/([^/]+)\/([^/]+)\/events$/);
    const operation={projectId,kind,id};
    const active=kind==='generation' ? !!regression?.active : !!regression?.importActive||retryFixture?.status==='queued';
    const progress=kind==='generation'?{ready:active?0:batch.slots.filter(slot=>slot.status==='ready').length,failed:active?0:batch.slots.filter(slot=>slot.status==='failed').length}:{};
    const frames=eventFrame('changed',operation,{...progress,refresh:true,status:active?'queued':'completed',terminal:!active})+(active?'':eventFrame('terminal',operation,{...progress,status:'completed',terminal:true,outcome:'succeeded'}));
    await command('Fetch.continueRequest',{requestId,url:streamReply(path,frames,active)});return;
  } else if(retryFixture&&path===`/v1/projects/${retryFixture.id}/retry-import`) {
    retryCalls.push(request);
    const reply=retryFixture.replies.shift();
    if(reply==='lost') {retryFixture.status='queued';await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
    if(reply==='cooldown') {status=429;body={error:{code:'retry_cooldown'}};extraHeaders.push({name:'Retry-After',value:'1'});}
    else if(reply==='quota') {status=403;body={error:{code:'allowance_exceeded',message:'private server text',allowance:{requiredSeconds:1025,remainingSeconds:775}}};}
    else {retryFixture.status='source_ready';body={...project,id:retryFixture.id};}
  } else if(retryFixture&&path===`/v1/projects/${retryFixture.id}`) {
    body={...project,id:retryFixture.id,status:retryFixture.status,importRetry:{available:retryFixture.status==='failed'&&retryFixture.availableAt<Date.now(),reason:retryFixture.status!=='failed'?'import_not_failed':retryFixture.availableAt>Date.now()?'retry_cooldown':'revalidation_required',availableAt:new Date(retryFixture.availableAt).toISOString()}};
    if (retryFixture.allowance) body.importRetry={available:false,reason:'allowance_exceeded',availableAt:new Date(retryFixture.availableAt).toISOString(),allowance:retryFixture.allowance};
  } else if (failTextDownload && path.endsWith('/text/download')) {
    status=503;body={error:{code:'download_failed'}};
  } else if(path.endsWith('/generation/availability')) {
    if(regression?.availabilityBroken) {status=503;body={error:{code:'service_unavailable'}};} else {
    if(regression?.availabilityMalformed){body={unexpected:true};}else{
    const sourceAvailable = retryFixture&&path.includes(`/projects/${retryFixture.id}/`)?retryFixture.status==='source_ready':!regression?.sourceExpired;
    const transcriptAvailable=!!regression?.sourceExpired;
    body={sourceAvailable,transcriptAvailable,sourceExpiresAt:regression?.sourceExpired?'2026-10-19T00:00:00Z':project.sourceExpiresAt,transcriptExpiresAt:regression?.sourceExpired?'2026-11-18T00:00:00Z':null,activeBatch:!!regression?.active,outputs:Object.fromEntries(formats.map(feature=>{
      const reason=expired?'subscription_required':regression?.active?'generation_in_progress':!sourceAvailable&&(!transcriptAvailable||feature==='short_videos')?regression?.sourceExpired?'requires_reimport':'source_not_ready':'available';
      return [feature,{available:reason==='available',reason}];
    }))};}
    }
  } else if(regression&&path===`/v1/projects/${regression.id}`) {
    body={...project,id:regression.id,status:regression.importActive?'queued':project.status,...(regression.sourceExpired?{status:'source_expired',sourceExpiresAt:'2026-10-19T00:00:00Z'}:{})};
  } else if(regression&&path===`/v1/projects/${regression.id}/generate`) {
    regressionCalls.push(request);
    const reply=regression.replies.shift();
    if(reply==='held'){regression.heldRequestId=requestId;return;}
    if(reply==='lost'){await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
    if(reply==='malformed'){body={unexpected:true};}
    else if(reply){status=reply[0];body={error:{code:reply[1]}};if(reply[1]==='generation_exists')regression.saved=true;}
    else {regression.saved=true;if(regression.history)regression.history.push(output('repeat-'+regressionCalls.length,'x_posts','Repeated output '+regressionCalls.length));body=regression.active?{...batch,status:regression.queued?'queued':'generating'}:batch;}
  } else if(regression&&path===`/v1/projects/${regression.id}/generation`) {
    if(regression.progressBroken||regression.progressFailures>0){if(regression.progressFailures>0)regression.progressFailures--;status=503;body={error:{code:'service_unavailable'}};}else if(regression.saved)body={...batch,id:regression.batchId??batch.id,...(regression.active?{status:regression.queued?'queued':'generating'}:{})};else{status=404;body={error:{code:'generation_not_found'}};}
  } else if(regression&&path===`/v1/projects/${regression.id}/outputs`) {
    body=regression.saved?[output('regression_text','x_posts','Saved regression output remains available.'),...(regression.history??[])]:[];
  } else if(regression?.import&&path==='/v1/projects'&&request.method==='POST') {
    regressionCalls.push(request);
    const reply=regression.replies.shift();
    if(reply==='held'){regression.heldRequestId=requestId;return;}
    if(reply==='lost'){await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
    if(reply==='malformed')body={unexpected:true};
    else if(reply==='superseded'){status=409;body={error:{code:'operation_superseded',accepted:true,operation:{projectId:regression.id,kind:'import',id:'import_original'}}};}
    else if(reply){status=reply[0];body={error:{code:reply[1],message:'private provider details'}};if(reply[2])extraHeaders.push({name:'Retry-After',value:String(reply[2])});}else body={...project,id:regression.id,status:regression.importActive?'queued':project.status};
  } else if(path.endsWith('/download')) {
    downloads.push(path);
    contentType=path.includes('slide1')?'image/png':path.includes('clip1')?'video/mp4':'text/plain';
    body=contentType==='image/png'?png:contentType==='video/mp4'?mp4:Buffer.from(outputs[0].text);
  } else if(path==='/v1/capabilities'&&sharedAccessFails) {
    status=503;body={error:{code:'service_unavailable'}};
  } else if(path==='/v1/capabilities') {
    body={brand:{available:!expired,languages:['English','Spanish','French','German','Portuguese','Hindi'],limits:brandLimits},subscription:{active:!expired,reason:expired?'subscription_expired':'active',expiresAt:null},features:Object.fromEntries(formats.map(key=>[key,{available:true,reason:process.env.RIFLO_SMOKE_USAGE_ONLY==='1'?'available':'active'}])),limits:counts(10),generationBatchLimits:Object.fromEntries(formats.map(key=>[key,regression&&key==='x_posts'?2:1])),services:{drive:{configured:!youtubeOnly},intake:{configured:true},generation:{configured:true},sources:{drive:{configured:!youtubeOnly},youtube:{configured:true}}}};
    if(lifecycleCapabilities)Object.assign(body,lifecycleCapabilities);
  } else if(path==='/v1/drive/connection'&&request.method==='DELETE') {
    if(connectionDeleteFailure){status=503;body={error:{code:'service_unavailable'}};}else{disconnected=true;body={connected:false,revocation:'failed'};}
  } else if(path==='/v1/drive/connection/authorize' && process.env.RIFLO_SMOKE_CONNECTIONS_ONLY==='1') {
    body={authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?fixture=true'};
  } else if(path==='/v1/drive/connection') {
    if(driveStatusMode==='hang'){heldDriveRequests.push(requestId);return;}
    if(driveStatusMode==='error'){status=503;body={error:{code:'service_unavailable'}};}
    else if(driveStatusMode==='malformed'){body={configured:true,connected:'unknown'};}
    else
    body={configured:!youtubeOnly,connected:!youtubeOnly&&!disconnected};
  } else if(path==='/v1/drive/picker-session') {
    body={accessToken:'local-picker-fixture',expiresAt:new Date(Date.now()+600000).toISOString()};
  } else if(path.endsWith('/validate')) {
    assert.fail('Ordinary import must not call a validation API: '+path);
  } else if(path==='/v1/projects'&&request.method==='POST'&&JSON.parse(request.postData).source==='youtube'&&youtubeDenied) {
    youtubeDenied=false;status=422;body={error:{code:'youtube_video_unavailable',message:'private fixture provider detail'}};
  } else if(path==='/v1/projects'&&request.method==='POST'&&JSON.parse(request.postData).source==='youtube') {
    youtubeImports.push(request);youtubeImported=true;
    if(youtubeImports.length<=2){await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
    body=youtubeProject;
  } else if(path==='/v1/projects'&&request.method==='POST') {
    imports.push(request);imported=true;
    if(imports.length===1) {await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
    body=project;
  } else if(path==='/v1/projects' && projectListMode==='error') {
    status=503;body={error:{code:'service_unavailable'}};
  } else if(path==='/v1/projects') {
    body=[...(detailFixture&&!detailFixture.deleted?[{...project,id:'detail_fixture',status:'source_ready',...(detailFixture.projectState??{})}]:[]),...(imported?[project]:[]),...(youtubeImported?[youtubeProject]:[])];
  } else if(path==='/v1/usage') {
    if(expired && !usage.lifecycle){status=403;body={error:{code:'subscription_expired'}};}
    else if(allowanceMode==='error'){status=503;body={error:{code:'service_unavailable'}};}
    else if(allowanceMode==='malformed')body={remaining:{x_posts:7}};
    else if(failUsage){failUsage=false;status=503;body={error:{code:'service_unavailable'}};}else body=usage;
  } else if(path.includes('test_youtube_project')&&path.endsWith('/generate')) {
    youtubeGenerations.push(request);youtubeGenerated=true;body=youtubeBatch;
  } else if(path.endsWith('/generate')) {
    generations.push(request);
    if(generations.length===1) {await command('Fetch.failRequest',{requestId,errorReason:'Failed'});return;}
    generated=true;body=batch;
  } else if(path.endsWith('/generation')) {
    if(path.includes('test_youtube_project')&&youtubeGenerated)body=youtubeBatch;
    else if(generated&&!path.includes('test_youtube_project'))body=batch;
    else {status=404;body={error:{code:'generation_not_found'}};}
  } else if(path.endsWith('/outputs')) {
    body=path.includes('test_youtube_project')?(youtubeGenerated?youtubeOutputs:[]):generated?outputs:[];
  } else if(process.env.RIFLO_SMOKE_OUTPUTS_ONLY==='1'&&path.startsWith('/v1/projects/test_project/outputs/')) {
    body=outputs.find(output=>output.id===path.split('/').at(-1));
    assert.ok(body,'Known single output fixture');
  } else if(path==='/v1/projects/test_youtube_project') {
    body=youtubeProject;
  } else if(/^\/v1\/projects\/regression_[A-Za-z0-9_-]+$/.test(path)) {
    // Navigation may leave one already-dispatched read from the previous fixture.
    body={...project,id:path.split('/')[3]};
  } else {
    assert.equal(path,'/v1/projects/test_project','Unexpected fixture API route');body=project;
  }
  if(status<400 && path.endsWith('/generation/availability') && body?.outputs) {
    const inactive=expired||detailFixture?.accessExpired;
    body={...body,access:{active:!inactive,reason:inactive?'subscription_expired':'active',expiresAt:inactive?'2026-10-01T00:00:00Z':null},preferences:{languages:['English','Spanish','French','German','Portuguese','Hindi'],limits:{audience:1000,voice:1000,language:80,spelling:80}}};
    if(detailFixture?.retentionAvailability)Object.assign(body,detailFixture.retentionAvailability);
    if(detailFixture?.credits)body.credits=detailFixture.credits;
    if(detailFixture?.lifecycle)body.lifecycle=detailFixture.lifecycle;
    for(const [feature,item] of Object.entries(body.outputs)) {
      if(!item.available)continue;
      if(inactive)Object.assign(item,{available:false,reason:'subscription_required'});
      else if(detailFixture?.configurationMissing)Object.assign(item,{available:false,reason:'generation_not_configured'});
      else if(detailFixture?.unimplemented===feature)Object.assign(item,{available:false,reason:'feature_not_implemented'});
      else if(body.credits&&body.credits.costs[feature]>body.credits.remaining)Object.assign(item,{available:false,reason:'allowance_exceeded'});
    }
    if(detailFixture?.configurationMissing&&body.transcription?.retryAvailable)Object.assign(body.transcription,{retryAvailable:false,reason:'generation_not_configured'});
  }
  if(regression?.holdProgressOnce && request.method==='GET' && path===`/v1/projects/${regression.id}/generation`) {
    regression.holdProgressOnce=false;regression.heldProgress={requestId,body};return;
  }
  if(status<400 && request.method==='POST' && (path==='/v1/projects'||/\/(generate|retry-import)$/.test(path)) && body?.id) {
    assert.equal(request.headers.Accept??request.headers.accept,'text/event-stream','Commands negotiate SSE directly');
    const kind=path.endsWith('/generate')?'generation':'import';
    const operation={projectId:kind==='generation'?path.split('/')[3]:body.id,kind,id:kind==='generation'?body.id:body.importOperationId};
    const active=['queued','generating','processing'].includes(body.status);
    const progress=kind==='generation'?{ready:(body.slots??[]).filter(slot=>slot.status==='ready').length,failed:(body.slots??[]).filter(slot=>slot.status==='failed').length}:{};
    const frames=eventFrame('accepted',operation,{...progress,refresh:true,status:active?'queued':body.status,terminal:!active})+(active?'':eventFrame('terminal',operation,{...progress,terminal:true,status:body.status,outcome:body.status==='partial'?'partial':'succeeded'}));
    await command('Fetch.continueRequest',{requestId,url:streamReply(path,frames,active)});return;
  }
  if(status<400&&contentType==='application/json') {
    body=publicProjectFixture(body);
    if(/\/outputs(?:\/[^/]+)?$/.test(path))publicOutputResponses.push({path,body});
    if(/\/(generation|generate|retry-transcription)$/.test(path)) {
      body=publicBatchFixture(body);
      if(body?.slots)publicBatchResponses.push({path,body});
    }
  }
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(status>=400?body:{data:body}));
  await command('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:contentType},...extraHeaders],body:bytes.toString('base64')});
}
socket.onmessage=({data})=>{
  const message=JSON.parse(data);
  if(message.id) {
    const waiting=pending.get(message.id);
    if(waiting){pending.delete(message.id);message.error?waiting.reject(Error(`${waiting.method}: ${message.error.message}`)):waiting.resolve(message.result);}
  } else if(message.method==='Fetch.requestPaused') {
    respond(message.params).catch(error=>{if(error.message.includes('Invalid InterceptionId'))return;console.error(error);socket.close();process.exitCode=1;});
  }
};
loadingChecks: try {
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(artifacts,'downloads'),eventsEnabled:true});
  if(process.env.RIFLO_SMOKE_MOTION_ONLY==='1') await (await import('./motion.mjs')).installMotionProbe({command});
  await command('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:5188/v1/*'}]});
  await navigate('/projects');await sleep(500);
  await waitFor('Continue with Google');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.google-button').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`),'Google sign-in is visible in the first mobile screen');
  await capture('signin-375');
  for(const width of [768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await capture(`signin-${width}`);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await evaluate(`fetch(${JSON.stringify(process.env.RIFLO_SMOKE_CANARY+'/fetch-canary')}).catch(()=>undefined)`);
  assert.equal(await evaluate(`window.__canaryPopup=window.open(${JSON.stringify(process.env.RIFLO_SMOKE_CANARY+'/popup-canary')},'isolation-canary');Boolean(window.__canaryPopup)`),true);
  await sleep(300);
  await evaluate('window.__canaryPopup.close()');
  await evaluate(`fetch(${JSON.stringify(process.env.RIFLO_SMOKE_CANARY.replace('http:','https:')+'/tls-canary')}).catch(()=>undefined)`);
  await evaluate(`new Promise((resolve,reject)=>{const socket=new WebSocket(${JSON.stringify(process.env.RIFLO_SMOKE_SOCKET_CANARY)});socket.onerror=()=>resolve();socket.onopen=()=>{socket.close();reject(Error('Unapproved WebSocket connected'));};setTimeout(()=>{socket.close();reject(Error('WebSocket isolation check stalled'));},2000);})`);
  // The browser creates its own tiny MP4, keeping the fixture offline and independent of FFmpeg.
  const encoded=await evaluate(`(async()=>{
    if(!MediaRecorder.isTypeSupported('video/mp4'))throw Error('Chrome needs MP4 MediaRecorder support');
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const context=canvas.getContext('2d');context.fillStyle='#174d3c';context.fillRect(0,0,160,90);
    const stream=canvas.captureStream(10),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/mp4'});
    const stopped=new Promise(resolve=>recorder.onstop=resolve);
    recorder.ondataavailable=event=>chunks.push(event.data);recorder.start();
    const frames=${process.env.RIFLO_SMOKE_OUTPUTS_ONLY==='1'}?setInterval(()=>{context.fillStyle=context.fillStyle==='#174d3c'?'#18503e':'#174d3c';context.fillRect(0,0,160,90)},50):null;
    await new Promise(resolve=>setTimeout(resolve,350));if(frames)clearInterval(frames);recorder.stop();await stopped;
    stream.getTracks().forEach(track=>track.stop());
    const bytes=new Uint8Array(await new Blob(chunks,{type:'video/mp4'}).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  })()`);
  mp4=Buffer.from(encoded,'base64');
  if (process.env.RIFLO_SMOKE_FEEDBACK_ONLY === '1') {
    await evaluate('window.__realOpen=window.open;window.open=()=>null');
    await click('Continue with Google');
    await waitFor('Sign-in did not finish.');
    await evaluate('window.open=window.__realOpen');
    assert.equal(await evaluate(`document.querySelector('.setup-note').classList.contains('state-error')`),true);
    for (const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await capture(`signin-error-${width}`);
    }
  }
  if (process.env.RIFLO_SMOKE_SIGNIN_ONLY === '1') {
    await (await import('./signin.mjs')).checkSignIn({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands});
    break loadingChecks;
  }
  if(process.env.RIFLO_SMOKE_EAGER_ONLY==='1' || process.env.RIFLO_SMOKE_IMPORT_PROGRESS_ONLY==='1') {
    detailFixture={mode:'ready',importing:true,empty:true};
    await navigate('/projects/detail_fixture');
    await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
    if(process.env.RIFLO_SMOKE_EAGER_ONLY==='1') { await (await import('./eager-import.mjs')).checkEager({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture,notifyStream,eventFrame,transcriptionCalls}); break loadingChecks; }
    await (await import('./import-progress.mjs')).checkImportProgress({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,commands,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture,notifyStream,eventFrame});
    break loadingChecks;
  }
  if(process.env.RIFLO_SMOKE_RETENTION_ONLY==='1') {
    detailFixture={mode:'ready'};
    await navigate('/projects/detail_fixture');
    await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
    await (await import('./retention.mjs')).checkRetention({evaluate,waitFor,waitUntil,sleep,commands,holdReads,releaseReads,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture});
    break loadingChecks;
  }
  if(process.env.RIFLO_SMOKE_OUTPUTS_ONLY==='1') {
    generated=true;
    for(const output of outputs)output.createdAt='2026-10-18T00:00:00Z';
    Object.assign(outputs[1],{data:{status:'ok',slides:[{title:'Saved title',body:'Saved slide copy.'}]}});
    Object.assign(outputs[1].assets[0],{bytes:png.length,width:1,height:1});
    Object.assign(outputs[2],{data:{status:'ok',segments:[{startSeconds:0,endSeconds:12}]}});
    Object.assign(outputs[2].assets[0],{bytes:mp4.length,width:160,height:90,durationSeconds:0.35});
    await navigate('/projects/test_project');
    await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
    await (await import('./outputs.mjs')).checkOutputs({command,evaluate,waitFor,waitUntil,capture,sleep,click,commands,outputs,png,mp4,publicOutputResponses});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_PROJECT_SETTINGS_ONLY === '1') {
    detailFixture={mode:'ready',retentionAvailability:{sourceExpiresAt:new Date(Date.now()+86_400_000).toISOString()}};
    await navigate('/projects/detail_fixture/settings');
    await waitFor('Continue with Google');
    holdReads.add('/v1/projects/detail_fixture');
    await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
    await (await import('./project-settings.mjs')).checkProjectSettings({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture,streamEvidence});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_DELETE_ONLY === '1') {
    detailFixture={mode:'ready'};
    await navigate('/projects/detail_fixture/settings');
    await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
    await (await import('./project-deletion.mjs')).checkProjectDeletion({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture,streamEvidence,notifyStream,eventFrame});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_PROJECT_READS_ONLY === '1') {
    detailFixture={mode:'ready'};
    await navigate('/projects/detail_fixture');
    await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
    await (await import('./project-reads.mjs')).checkProjectReads({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture,setRegression:value=>{regression=value},setRetryFixture:value=>{retryFixture=value},retryCalls,regressionCalls,transcriptionCalls,notifyStream,eventFrame,publicBatchResponses});
    break loadingChecks;
  }
  holdReads.add('/v1/capabilities');holdReads.add('/v1/drive/connection');
  await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{signInAnonymously}=await import('/node_modules/.vite/deps/firebase_auth.js');await signInAnonymously(firebaseAuth());})()`);
  await waitUntil(`Boolean(document.querySelector('[aria-label="Loading projects"]'))`, 'cold projects skeleton');
  await capture('cold-projects-1440');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  await capture('cold-projects-375');
  await releaseReads(['/v1/capabilities']);
  await evaluate(`document.querySelector('a[href="/connections"]').click()`);
  await waitUntil(`Boolean(document.querySelector('[aria-label="Loading connections"]'))`, 'cold connections skeleton');
  await capture('cold-connections-375');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await capture('cold-connections-1440');
  await releaseReads();await waitFor('Your source, connected.');
  await capture('loaded-connections-1440');
  if (process.env.RIFLO_SMOKE_SHARED_ONLY === '1') {
    await (await import('./shared-controls.mjs')).checkSharedControls({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,click,holdReads,releaseReads,setState:state=>{if('accessFails'in state)sharedAccessFails=state.accessFails;if('driveMode'in state)driveStatusMode=state.driveMode;if('brandFails'in state)brandFails=state.brandFails;}});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_PROJECTS_ONLY === '1') {
    await (await import('./projects.mjs')).checkProjects({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setState:state=>{if('accessFails'in state)sharedAccessFails=state.accessFails;if('listMode'in state)projectListMode=state.listMode;if('imported'in state)imported=state.imported;if('driveMode'in state)driveStatusMode=state.driveMode;if('youtubeOnly'in state)youtubeOnly=state.youtubeOnly;if('expired'in state)expired=state.expired;if('lifecycleCapabilities'in state)lifecycleCapabilities=state.lifecycleCapabilities;},setRegression:value=>{regression=value},regressionCalls});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_DETAIL_ONLY === '1') {
    await (await import('./project-detail.mjs')).checkProjectDetail({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setFixture:value=>{detailFixture=value},getFixture:()=>detailFixture,transcriptionCalls,notifyStream,eventFrame});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_CONNECTIONS_ONLY === '1') {
    await (await import('./connections.mjs')).checkConnections({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setState:state=>{if('disconnected'in state)disconnected=state.disconnected;if('expired'in state)expired=state.expired;if('mode'in state)driveStatusMode=state.mode;if('unconfigured'in state)youtubeOnly=state.unconfigured;if('deleteFailure'in state)connectionDeleteFailure=state.deleteFailure;}});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_GENERAL_ONLY === '1') {
    await (await import('./general.mjs')).checkGeneral({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_CONTROLS_ONLY === '1') {
    await (await import('./generation-controls.mjs')).checkGenerationControls({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,commands,fixture:controlsFixture});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_THREADS_ONLY === '1') {
    await (await import('./threads.mjs')).checkThreads({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands,outputs:threadOutputs,setThreadAvailable:value=>{threadOptions.threadAvailable=value}});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_GENERATION_DEFAULTS_ONLY === '1') {
    await (await import('./generation-defaults.mjs')).checkGenerationDefaults({command,evaluate,navigate,waitFor,waitUntil,capture,commands,holdReads,releaseReads});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_WRITING_BRAND_ONLY === '1') {
    await (await import('./writing-brand.mjs')).checkWritingBrand({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands,brandCalls,holdReads,releaseReads,getHeldReadCount:()=>heldReads.length,setProfile:value=>{brandProfile=value},setSaveFailure:value=>{brandSaveFails=value},setReadFailure:value=>{brandFails=value},setRegression:value=>{regression=value},getRegressionCalls:()=>regressionCalls});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_COMMUNICATION_ONLY === '1' || process.env.RIFLO_SMOKE_IMPORT_COMMUNICATION_ONLY === '1') {
    await (await import('./communication.mjs')).checkCommunication({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,commands,setRegression:value=>{regression=value},getRegression:()=>regression,getRegressionCalls:()=>regressionCalls,batch,artifacts});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_IMPORT_REPLAY_ONLY === '1') {
    regression={id:'expired_import_replay',import:true,replies:['lost']};
    await navigate('/projects');await click('New project');await waitFor('Paste a Google Drive video link');
    await evaluate(`(()=>{const input=document.querySelector('#drive-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://drive.google.com/file/d/test_video/view?resourcekey=original_key');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('Import video');await waitFor('Check import status');
    expired=true;
    await navigate('/projects');await waitFor('Active account access is needed to import a new video.');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Check import status')).disabled`),false);
    await click('Check import status');await waitFor('Your selection is saved while we confirm');
    assert.equal(await evaluate(`document.querySelector('#drive-link').disabled`),true);
    assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true);
    assert.equal(await evaluate(`document.querySelector('#drive-link').value`),'https://drive.google.com/file/d/test_video/view?resourcekey=original_key');
    await click('Check import status');await waitFor('Your access has expired.');
    assert.equal(regressionCalls.length,2);
    assert.equal(new Set(regressionCalls.map(call=>call.headers['Idempotency-Key'])).size,1);
    assert.equal(new Set(regressionCalls.map(call=>call.postData)).size,1);
    assert.deepEqual(JSON.parse(regressionCalls[1].postData),{fileId:'test_video',resourceKey:'original_key'});
    await navigate('/projects');await waitFor('New project');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('New project')).disabled`),true,'expired account without its own pending intent cannot start an import');
    await evaluate(`sessionStorage.setItem('riflo:import:other-account',JSON.stringify({input:{fileId:'test_video'},details:null,key:'other-account-key'}))`);
    await navigate('/projects');await waitFor('New project');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('New project')).disabled`),true,'another account pending intent cannot unlock recovery');
    console.log('PASS: expired account restores only its own pending import, replays exact key/input/resource key, and cannot start new imports. API replies are isolated fixtures.');
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_RETENTION_ONLY === '1') {
    retryFixture={id:'retry_quota_failed',status:'failed',availableAt:Date.now()-1,replies:[],allowance:{requiredSeconds:1025,remainingSeconds:775}};
    await navigate(`/projects/${retryFixture.id}`);await waitFor('This import needs 17m 5s; 12m 55s remain.');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retry import').disabled`),true,'Quota preflight disables retry');
    assert.equal(await evaluate(`document.querySelector('.import-retry a[href="/usage"]').textContent`),'check usage');
    assert.equal(await evaluate(`document.querySelector('.import-retry').textContent.includes('fewer outputs')`),false);
    assert.equal(retryCalls.length,0,'Quota preflight never submits');
    await capture('retry-quota-1440');
    retryFixture={id:'retry_stale_quota',status:'failed',availableAt:Date.now()-1,replies:['quota']};
    await navigate(`/projects/${retryFixture.id}`);await waitFor('Retry import');
    await click('Retry import');await waitFor('No new import was started.');
    assert.equal(await evaluate(`document.querySelector('.import-retry [role="alert"]').textContent.includes('This import needs 17m 5s; 12m 55s remain.')`),true);
    assert.equal(await evaluate(`document.querySelector('.import-retry [role="alert"] a[href="/usage"]').textContent`),'check usage');
    assert.equal(await evaluate(`document.querySelector('.import-retry').textContent.includes('private server text')`),false);
    assert.equal(retryCalls.length,1,'Stale quota rejection sends exactly one POST');
    await capture('retry-stale-quota-1440');
    retryCalls.length=0;
    retryFixture={id:'retry_ambiguous_quota',status:'failed',availableAt:Date.now()-1,replies:['lost','quota','success']};
    await navigate(`/projects/${retryFixture.id}`);await waitFor('Retry import');
    await click('Retry import');await waitFor('Check import status');
    await click('Check import status');await waitFor('This import needs 17m 5s; 12m 55s remain.');
    assert.equal(await evaluate(`document.querySelector('.import-retry').textContent.includes('No new import was started.')`),false,'Prior ambiguous request cannot promise no import');
    await reloadDocument();await waitFor('Check import status');
    await click('Check import status');await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
    assert.equal(retryCalls.length,3);
    assert.equal(new Set(retryCalls.map(call=>call.headers['Idempotency-Key'])).size,1,'Ambiguous rejection and reload retain original key');
    retryCalls.length=0;
    retryFixture={id:'retry_failed',status:'failed',availableAt:Date.now()+60_000,replies:['cooldown','lost','success']};
    await navigate(`/projects/${retryFixture.id}`);
    await waitFor('Try again in about');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retry import').disabled`),true);
    for(const width of [375,1440]) {await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`retry-cooldown-${width}`);}
    retryFixture.availableAt=Date.now()-1;await reloadDocument();await waitFor('Retry import');
    await click('Retry import');await waitFor('Please wait before retrying');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retry import').disabled`),true,'Retry-After disables retry');
    await waitUntil(`!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retry import').disabled`,'server cooldown ends');
    await click('Retry import');await waitFor('Check import status');
    await reloadDocument();await waitFor('Check import status');
    await click('Check import status');await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
    assert.equal(retryCalls.length,3);
    assert.notEqual(retryCalls[0].headers['Idempotency-Key'],retryCalls[1].headers['Idempotency-Key'],'safe first cooldown can release key');
    assert.equal(retryCalls[1].headers['Idempotency-Key'],retryCalls[2].headers['Idempotency-Key'],'lost retry response keeps its key through reload');
    assert.equal(retryCalls.every(call=>!call.postData),true,'Retry does not send generation body');
    assert.equal(generations.length,0,'Retry never triggers generation');
    retryFixture=null;
    regression={id:'repeat_transcript',saved:true,sourceExpired:true,replies:['lost']};regressionCalls.length=0;
    await navigate(`/projects/${regression.id}`);await waitFor('Saved regression output remains available.');
    await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'transcript allows text');
    assert.equal(await evaluate(`document.querySelector('.generation-format:last-child button').disabled`),true);
    await waitFor('New video clips require importing the original again.');
    for(const width of [375,1440]) {await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`retained-transcript-${width}`);}
    await evaluate(`document.querySelector('.generation-format > button').click()`);await waitFor('Retry request');assert.equal(await evaluate(`Boolean(document.querySelector('.generation-feedback-warning'))`),true,'Safe original retry remains visible');
    await reloadDocument();await waitFor('Retry request');assert.equal(await evaluate(`Boolean(document.querySelector('.generation-feedback-warning'))`),true,'Safe original retry remains visible');await waitFor('Saved regression output remains available.');
    for(const width of [375,1440]) {await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`repeat-pending-${width}`);}
    await click('Retry request');await waitFor('Saved content');
    assert.equal(regressionCalls.length,2);
    assert.equal(regressionCalls[0].headers['Idempotency-Key'],regressionCalls[1].headers['Idempotency-Key']);
    assert.equal(regressionCalls[0].postData,regressionCalls[1].postData);
    assert.equal(await evaluate(`document.body.innerText.includes('Retry request')`),false);
    await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'another batch allowed');
    regression.availabilityBroken=true;await reloadDocument();await waitFor('Retry availability check');await waitFor('Saved regression output remains available.');
    assert.equal(await evaluate(`document.querySelector('.generation-format > button').disabled`),true);
    regression.availabilityBroken=false;await click('Retry availability check');await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'availability recovers');
    await writeFile(join(artifacts,'retention-retry-checks.json'),JSON.stringify({retryCalls:retryCalls.map(call=>({key:call.headers['Idempotency-Key'],body:call.postData??null})),generationCalls:regressionCalls.map(call=>({key:call.headers['Idempotency-Key'],selection:JSON.parse(call.postData)})),checks:['quota preflight disables retry with required/remaining seconds and usage link','backend cooldown and Retry-After','same-project retry lost-response/reload identity','retry does not generate','retained transcript text allowed video blocked','explicit informed Generate action','old batch cannot resolve pending new request','saved outputs survive availability failure','availability retry recovers']},null,2));
    console.log('PASS: retry cooldown/Retry-After, lost response + reload identity, no automatic generation, source-expired transcript eligibility, explicit generation and pending selection, saved outputs and availability recovery. API responses are isolated fixtures.');
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_BRAND_ONLY === '1') {
    await command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await capture('loaded-connections-375');
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  }
  if (process.env.RIFLO_SMOKE_STATUS_ONLY === '1') {
    assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-success')`),true);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Disconnect Drive').classList.contains('text-destructive')`),true);
    await waitUntil(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Disconnect Drive').disabled`, 'fresh disconnect permission');
    await click('Disconnect Drive');await waitFor('Google could not confirm revocation');
    assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-error')`),true);
    assert.equal(await evaluate(`document.querySelector('.form-feedback').classList.contains('state-warning')`),true);
    await capture('disconnected-revocation-warning-1440');
    await command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await capture('disconnected-revocation-warning-375');
    await writeFile(join(artifacts,'status-checks.json'),JSON.stringify({connected:'green',disconnected:'red',disconnectAction:'red',revocationFailed:'orange',pending:'neutral'},null,2));
    console.log('PASS: connected, disconnected, destructive action and revocation-warning semantic colors.');
    break loadingChecks;
  }
  await evaluate(`document.querySelector('a[href="/projects"]').click()`);
  await waitFor('Start with something worth sharing.');
  if (process.env.RIFLO_SMOKE_BRAND_ONLY === '1') {
    for (const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await capture(`brand-projects-${width}`);
    }
  }
  // Clicks exercise the actual persistent studio, unlike Page.navigate reloads.
  const navClick = async path => evaluate(`document.querySelector('a[href="${path}"]').click()`);
  holdReads.add('/v1/usage');
  await navClick('/usage');
  await waitUntil(`Boolean(document.querySelector('[aria-label="Loading usage"]'))`, 'cold usage skeleton');
  if (process.env.RIFLO_SMOKE_USAGE_ONLY === '1') await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);
  await capture('cold-usage-1440');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  await capture('cold-usage-375');
  if (process.env.RIFLO_SMOKE_USAGE_ONLY === '1') {
    await (await import('./usage.mjs')).checkUsage({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,click,commands,usage,holdReads,releaseReads,setMode:value=>{allowanceMode=value},setExpired:value=>{expired=value}});
    break loadingChecks;
  }
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.skeleton'),'::after').animationName`),'none');
  await command('Emulation.setEmulatedMedia',{features:[]});
  await releaseReads();await waitFor('CURRENT ACCESS PERIOD');
  await capture('loaded-usage-375');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await capture('loaded-usage-1440');
  await navClick('/projects');await waitFor('Start with something worth sharing.');
  holdReads.add('/v1/usage');
  await navClick('/usage');await sleep(150);
  assert.ok((await evaluate('document.body?.innerText ?? ""')).includes('CURRENT ACCESS PERIOD'));
  assert.equal(await evaluate(`Boolean(document.querySelector('.page-skeleton'))`),false,'revisited usage keeps loaded layout while refreshing');
  failUsage=true;await releaseReads();await waitFor('Showing the last loaded allowance.');
  assert.ok((await evaluate('document.body?.innerText ?? ""')).includes('CURRENT ACCESS PERIOD'));
  await click('Try again');await waitUntil(`!document.querySelector('[role="alert"]')`,'usage refresh recovery');
  holdReads.add('/v1/drive/connection');
  await navClick('/connections');await sleep(150);
  assert.ok((await evaluate('document.body?.innerText ?? ""')).includes('Your source, connected.'));
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Disconnect Drive').disabled`),true,'cached connection cannot authorize disconnect while refreshing');
  await releaseReads();await waitUntil(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Disconnect Drive').disabled`,'fresh connection enables actions');
  await navClick('/settings');await waitFor('Appearance');
  holdReads.add('/v1/capabilities');holdReads.add('/v1/projects');
  await navClick('/projects');await sleep(150);
  assert.ok((await evaluate('document.body?.innerText ?? ""')).includes('Start with something worth sharing.'));
  assert.equal(await evaluate(`Boolean(document.querySelector('.page-skeleton'))`),false,'Settings round trip preserves project display snapshots');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('New project')).disabled`),true,'cached access cannot authorize imports');
  await releaseReads();await waitUntil(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('New project')).disabled`,'fresh access enables imports');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Bring your first video')).focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor('Paste a Google Drive video link');
  assert.equal(await evaluate(`document.activeElement.name`),'video-source','removed keyboard opener hands focus to import');
  assert.equal(await evaluate(`document.querySelector('[aria-controls="project-import"]').getAttribute('aria-expanded')`),'true');
  assert.equal(await evaluate(`document.querySelector('[aria-controls="project-import"]').classList.contains('button-primary')`),false);
  assert.equal(await evaluate(`document.querySelector('[aria-controls="project-import"] path').getAttribute('d')`),'M6 6l12 12M18 6 6 18');
  await click('Close import');await waitUntil(`!document.querySelector('.import-sheet')`,'closed import');await click('New project');await waitFor('Paste a Google Drive video link');
  await evaluate(`document.querySelector('input[name="video-source"][value="drive"]').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await waitUntil(`Boolean(document.querySelector('#youtube-link'))`,'keyboard selection of YouTube');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await waitUntil(`Boolean(document.querySelector('#drive-link'))`,'keyboard selection of Drive');
  await evaluate(`(()=>{const input=document.querySelector('#drive-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://drive.google.com/file/d/test_video/view');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`document.querySelector('#drive-link').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor('Check import status');
  holdReads.add('/v1/projects/test_project');holdReads.add('/v1/projects/test_project/generation');holdReads.add('/v1/projects/test_project/outputs');await click('Check import status');
  await waitUntil(`Boolean(document.querySelector('[aria-label="Loading project"]'))`, 'cold detail skeleton');
  await capture('cold-detail-1440');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:1100,deviceScaleFactor:1,mobile:true});
  await capture('cold-detail-375');
  await releaseReads(['/v1/projects/test_project']);
  await waitUntil(`Boolean(document.querySelector('[aria-label="Loading saved content"]'))`, 'cold generation skeleton');
  await capture('cold-content-375');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await capture('cold-content-1440');
  await releaseReads();
  await waitFor('Saved content');assert.equal(imports.length,2);
  for(const width of [375,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`generation-${width}`);
  }
  if(process.env.RIFLO_SMOKE_MOTION_ONLY==='1') {
    await (await import('./motion.mjs')).checkMotion({command,evaluate,waitUntil,releaseReads,holdReads,setState:state=>{if('listMode'in state)projectListMode=state.listMode;if('driveMode'in state)driveStatusMode=state.driveMode;}});
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_LOADING_ONLY === '1') {
    await writeFile(join(artifacts,'loading-checks.json'),JSON.stringify({coldScreens:['projects','usage','connections','detail','content'],widths:[375,1440],themes:['light','dark'],clickNavigation:true,backgroundFailureRetainsData:true,staleActionsDisabled:true,reducedMotion:true},null,2));
    console.log('PASS: targeted loading, click navigation, retained data and fresh-access gates.');
    break loadingChecks;
  }
  assert.equal(imports[0].headers['Idempotency-Key'],imports[1].headers['Idempotency-Key']);
  assert.equal(imports[0].postData,imports[1].postData);
  assert.equal(await evaluate('document.querySelectorAll(".generation-format > button").length'),6);
  assert.equal(await evaluate('document.querySelectorAll(".generation-choice input,.generation-action").length'),0,'Direct actions need no selection');
  async function verifyStableSelection(context) {
    const callsBefore=generations.length+regressionCalls.length;
    const evidence=[];
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      for(const theme of ['light','dark']) {
        await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(theme)};window.dispatchEvent(new Event("riflo:appearance"))`);await sleep(300);
        const positions=()=>evaluate(`(()=>{const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top+scrollY,left:r.left,width:r.width,height:r.height}};return [...document.querySelectorAll('.generation-format')].map(el=>({row:rect(el),button:rect(el.querySelector(':scope > button'))}))})()`);
        const baseline=await positions();
        for(const index of [0,1,4,5]) {
          await evaluate(`document.querySelectorAll('.generation-format > button')[${index}].focus({preventScroll:true})`);
          await sleep(180);assert.deepEqual(await positions(),baseline,'Focus preserves row and action geometry');
        }
        assert.equal(generations.length+regressionCalls.length,callsBefore,'Focus never generates');
        evidence.push({width,theme,baseline,current:await positions()});await capture(`direct-${context}-${width}`);
      }
    }
    await writeFile(join(artifacts,`direct-geometry-${context}.json`),JSON.stringify(evidence,null,2));
  }
  await verifyStableSelection('new');
  await evaluate(`document.querySelector('.generation-format > button').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor('Retry request');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.generation-format > button')).filter(button=>button.textContent==='Create').every(button=>button.disabled)`),true,'Uncertain request locks all fresh actions');
  await click('Retry request');await waitFor('Saved content');
  assert.equal(generations.length,2);
  assert.deepEqual(JSON.parse(generations[1].postData).outputs,{x_posts:1});
  assert.equal(generations[0].headers['Idempotency-Key'],generations[1].headers['Idempotency-Key']);
  assert.equal(generations[0].postData,generations[1].postData);
  await waitFor('literal only');
  await evaluate(`window.__revoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__revoked.push(url);revoke(url)};navigator.clipboard.writeText=async text=>{window.__copied=text};`);
  await click('Copy text');await waitFor('Copied to clipboard.');assert.match(await evaluate('window.__copied'),/literal only/);
  for(const width of [375,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.output-paper-text')).alignSelf`),'start');
    await capture(`results-text-${width}`);
  }
  if (process.env.RIFLO_SMOKE_FEEDBACK_ONLY === '1') {
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.slot-list strong')).filter(el=>el.textContent==='Ready').every(el=>el.classList.contains('state-success'))`),true);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.slot-list strong')).find(el=>el.textContent==='Could not finish').classList.contains('state-error')`),true);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.output-paper p')).find(el=>el.textContent==='Copied to clipboard.').classList.contains('state-success')`),true);
    await evaluate(`navigator.clipboard.writeText=async()=>{throw Error('fixture clipboard failure')}`);
    await click('Copy text');await waitFor('Copy was unavailable.');
    assert.equal(await evaluate(`document.querySelector('.output-paper [role="alert"]').classList.contains('state-error')`),true);
    failTextDownload=true;await click('Download TXT');await waitFor('This file could not be opened.');
    assert.equal(await evaluate(`document.querySelector('.output-paper [role="alert"]').classList.contains('state-error')`),true);
    for (const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await capture(`output-feedback-error-${width}`);
    }
    await writeFile(join(artifacts,'feedback-checks.json'),JSON.stringify(brandEvidence,null,2));
    console.log('PASS: explicit ready/failed slot, sign-in failure, copy success/failure and download failure status colors.');
    break loadingChecks;
  }
  if (process.env.RIFLO_SMOKE_BRAND_ONLY === '1') {
    for (const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');
      await capture(`brand-preview-results-${width}`);
    }
    await writeFile(join(artifacts,'brand-checks.json'),JSON.stringify(brandEvidence,null,2));
    console.log('PASS: actual editorial copper consumers, neutral surfaces, contrast, blue actions and independent status roles.');
    break loadingChecks;
  }
  await click('Download TXT');await evaluate(`Array.from(document.querySelectorAll('.output-index button')).find(button=>button.textContent.includes('Carousel')).click()`);await waitFor('Download PNG');
  assert.match(await evaluate('document.querySelector(".slide-preview img").src'),/^blob:/);
  await evaluate(`Array.from(document.querySelectorAll('.output-index button')).find(button=>button.textContent.includes('Short video')).click()`);await waitFor('Download MP4');
  assert.equal(await evaluate(`(async()=>{const video=document.querySelector('video');if(video.readyState<1)await Promise.race([new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('MP4 decode failed'))}),new Promise((_,reject)=>setTimeout(()=>reject(Error('MP4 metadata stalled')),3000))]);return video.videoWidth===160&&video.videoHeight===90})()`),true);
  assert.ok(await evaluate('window.__revoked.length>=1'));
  for(const width of [375,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`results-${width}`);
  }
  youtubeOnly=true;driveStatusMode='error';
  const youtubeStart=commands.length;
  await navigate('/projects');await click('New project');await waitFor('Paste a YouTube video link');
  await waitFor('We could not check Google Drive.');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).filter(button=>button.textContent==='Retry connection status').length`),1,'YouTube-only import retains one reachable global Drive recovery');
  assert.equal(await evaluate(`document.querySelector('input[value="drive"][name="video-source"]').disabled`),true);
  assert.equal(await evaluate(`document.querySelector('input[value="youtube"][name="video-source"]').checked`),true);
  assert.equal((await evaluate('document.body?.innerText ?? ""')).includes('Connect your Google Drive first.'),false);
  const fillYouTube=()=>evaluate(`(()=>{const input=document.querySelector('#youtube-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://youtu.be/abcdefghijk?si=fixture');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await fillYouTube();await click('Import video');
  await waitUntil(`Boolean(document.querySelector('.form-feedback[role="alert"]'))`,'YouTube validation error');
  assert.equal((await evaluate('document.body?.innerText ?? ""')).includes('private fixture provider detail'),false);
  assert.equal(await evaluate(`Boolean(document.querySelector('.source-confirm'))`),false);
  await click('Import video');await waitFor('Your selection is saved while we confirm');
  for(const width of [375,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`youtube-import-${width}`);
  }
  await evaluate(`window.__confirmedSource=document.querySelector('.source-confirm');window.__connectionRail=document.querySelector('.sidebar');void 0;`);
  driveStatusMode='ok';await click('Retry connection status');
  await waitUntil(`!Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Retry connection status'))`,'Drive status recovery');
  assert.equal(await evaluate(`window.__confirmedSource===document.querySelector('.source-confirm')&&window.__connectionRail===document.querySelector('.sidebar')`),true,'A Drive retry must not discard a checked YouTube video or reload the shell');
  await waitUntil(`Boolean(document.querySelector('.form-feedback[role="alert"]'))`,'uncertain YouTube import');
  assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true);
  await click('Close import');await click('Check import status');await waitFor('Check import status');
  assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true,'closing an uncertain import preserves its locked request');
  await click('Check import status');
  await waitUntil(`Boolean(document.querySelector('.form-feedback[role="alert"]'))`,'repeated uncertain import');
  await navigate('/projects');await click('Check import status');await waitFor('Check import status');
  assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true);
  await click('Check import status');
  await waitFor('Give this video a new form.');
  assert.equal(youtubeImports.length,3);
  assert.equal(new Set(youtubeImports.map(request=>request.headers['Idempotency-Key'])).size,1);
  assert.deepEqual(youtubeImports.map(request=>JSON.parse(request.postData)),Array.from({length:3},()=>({source:'youtube',url:'https://youtu.be/abcdefghijk?si=fixture'})));
  assert.equal(youtubeValidations.length,0);
  assert.equal(commands.slice(youtubeStart).some(command=>/\/drive\/(?:connection\/authorize|picker-session|files\/validate)/.test(command)),false);
  assert.equal(await evaluate(`document.querySelectorAll('.generation-format > button').length`),6);
  for(let index=0;index<6;index++) {
    await waitUntil(`document.querySelectorAll('.generation-format > button')[${index}]?.textContent==='Create'&&!document.querySelectorAll('.generation-format > button')[${index}]?.disabled`,'format available');
    await evaluate(`document.querySelectorAll('.generation-format > button')[${index}].click()`);
    await waitFor('Saved content');
    for(let check=0;check<100&&youtubeGenerations.length<=index;check++)await sleep(50);
    assert.deepEqual(JSON.parse(youtubeGenerations[index].postData).outputs,{[formats[index]]:1});
  }
  assert.equal(await evaluate(`document.querySelectorAll('nav[aria-label="Choose generated output"] button').length`),6);
  for(const width of [375,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    if(width===375) {
      assert.ok(await evaluate(`Array.from(document.querySelectorAll('.output-index button')).every(button=>{const r=button.getBoundingClientRect();return r.height>=44})`),'all six scrolling output targets retain their touch height');
      for(let index=0;index<6;index++) {
        await evaluate(`document.querySelectorAll('.output-index button')[${index}].focus()`);
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
        assert.equal(await evaluate(`document.querySelectorAll('.output-index button')[${index}].getAttribute('aria-pressed')`),'true');
      }
    }
    await capture(`youtube-results-${width}`);
  }
  youtubeOnly=false;
  driveStatusMode='malformed';await navigate('/usage');await waitFor('CURRENT ACCESS PERIOD');await waitFor('Retry connection status');
  assert.equal((await evaluate('document.body?.innerText ?? ""')).includes('A little interruption.'),false);
  await evaluate(`document.querySelector('nav[aria-label="Main navigation"] a[href="/connections"]').click()`);
  await waitFor('Connection status unavailable.');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).filter(button=>/Connect Google Drive|Disconnect Drive/.test(button.textContent)).every(button=>button.disabled)`),true);
  driveStatusMode='ok';await click('Retry connection status');await waitFor('Disconnect Drive');
  driveStatusMode='hang';await navigate('/projects');await waitFor('All projects');await waitFor('Checking Google Drive.');
  await click('New project');
  assert.equal(await evaluate(`Boolean(document.querySelector('#drive-link'))`),false);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Choose from Google Drive'))`),false);
  await evaluate(`document.querySelector('input[name="video-source"][value="youtube"]').click()`);
  await waitFor('Paste a YouTube video link');await fillYouTube();
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:1100,deviceScaleFactor:1,mobile:true});
  await capture('youtube-drive-status-pending-375');
  assert.ok(heldDriveRequests.length>0);
  await waitFor('We could not check Google Drive.',260);
  await capture('youtube-drive-status-timeout-375');
  for(const requestId of heldDriveRequests.splice(0))await command('Fetch.failRequest',{requestId,errorReason:'Aborted'}).catch(()=>undefined);
  driveStatusMode='ok';
  await evaluate(`document.querySelector('input[name="video-source"][value="drive"]').click()`);
  await evaluate(`Array.from(document.querySelectorAll('.import-fields button')).find(button=>button.textContent.includes('Retry connection status')).click()`);
  await waitUntil(`!Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Retry connection status'))`,'source-local Drive status retry fetches fresh connection');
  await evaluate(`document.querySelector('input[name="video-source"][value="drive"]').click()`);
  await waitFor('Paste a Google Drive video link');
  await evaluate(`(async()=>{
    window.__rail=document.querySelector('.sidebar');
    window.__header=document.querySelector('.topbar');
    const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');
    window.__authUser=firebaseAuth().currentUser;
    document.querySelector('nav[aria-label="Main navigation"] a[href="/usage"]').click();
  })()`);
  await waitFor('CURRENT ACCESS PERIOD');
  assert.equal(await evaluate(`(async()=>{
    const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');
    return window.__rail===document.querySelector('.sidebar')
      &&window.__header===document.querySelector('.topbar')
      &&window.__authUser===firebaseAuth().currentUser
      &&document.activeElement.id==='main'
      &&document.querySelector('nav a[aria-current="page"]').getAttribute('href')==='/usage';
  })()`),true,'Navigation must retain the shell and signed-in user');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:1100,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('nav[aria-label="Main navigation"] a[href="/connections"]').click()`);
  await waitFor('Your source, connected.');
  assert.equal(await evaluate(`window.__rail===document.querySelector('.sidebar')&&window.__header===document.querySelector('.topbar')`),true,'Mobile navigation retains the shell');
  await evaluate('history.back()');await waitFor('CURRENT ACCESS PERIOD');
  assert.equal(await evaluate(`window.__rail===document.querySelector('.sidebar')`),true,'Back navigation retains the shell');
  await evaluate('history.forward()');await waitFor('Your source, connected.');
  assert.equal(await evaluate(`window.__rail===document.querySelector('.sidebar')`),true,'Forward navigation retains the shell');
  failUsage=true;await navigate('/usage');await waitFor('A little interruption.');await click('Try again');await waitFor('CURRENT ACCESS PERIOD');await waitFor('2m 5.25s');await waitFor('56m 54.75s');
  assert.equal(await evaluate('document.querySelectorAll(".allowance-row").length'),7);
  for(const width of [375,768,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`usage-${width}`);
  }
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'),true);
  await command('Emulation.setDeviceMetricsOverride',{width:720,height:550,deviceScaleFactor:2,mobile:false});
  await capture('usage-200-percent-layout');
  await evaluate('document.activeElement?.blur()');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate('document.activeElement.textContent'),'Skip to content');
  await navigate('/connections');await waitFor('Your source, connected.');await click('Disconnect Drive');await waitFor('Google could not confirm revocation');
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.includes("Disconnect Drive"))'),false);
  disconnected=false;
  async function openRegression(name,replies,saved=false) {
    regression={id:`regression_${name}`,replies:[...replies],saved};regressionCalls.length=0;
    await navigate(`/projects/${regression.id}`);await waitFor(saved?'Saved regression output remains available.':'Give this video a new form.');
  }
  async function selectOne() {
    await waitUntil(`Boolean(document.querySelector('.generation-format > button:not(:disabled)'))`,'available format actions');
    await evaluate(`document.querySelector('.generation-format > button').click()`);
  }
  const lifecycleGeometry=[];
  for(const width of [375,1440])for(const theme of ['light','dark']) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await openRegression(`geometry_${width}_${theme}`,['held'],true);
    await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(theme)};window.dispatchEvent(new Event('riflo:appearance'))`);await sleep(300);
    await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'geometry action available');
    // Creation closes the chooser. Reopening may include a new status paragraph;
    // compare the rows within that disclosure and the persistent source frame.
    const rowRects=()=>evaluate(`(()=>{const rows=[...document.querySelectorAll('.generation-format')],origin=rows[0].getBoundingClientRect().top,source=document.querySelector('.project-source-summary').getBoundingClientRect();return {source:{left:source.left,top:source.top+scrollY,width:source.width,height:source.height},rows:rows.map(el=>{const r=el.getBoundingClientRect(),b=el.querySelector(':scope > button').getBoundingClientRect();return {top:r.top-origin,left:r.left,width:r.width,height:r.height,buttonTop:b.top-r.top,buttonWidth:b.width,buttonHeight:b.height}})}})()`);
    const ready=await rowRects();await evaluate(`document.querySelector('.generation-format > button').click()`);
    await waitUntil(`Array.from(document.querySelectorAll('.generation-format > button')).filter(button=>button.textContent==='Create').every(button=>button.disabled)`,'sending blocks new creation and preserves saved View');
    const sending=await rowRects();assert.deepEqual(sending,ready,'Sending preserves all row/action geometry');
    await waitUntil('true','held response');while(!regression.heldRequestId)await sleep(20);
    regression.active=true;regression.batchId=`batch_${width}_${theme}`;await command('Fetch.continueRequest',{requestId:regression.heldRequestId,url:streamReply(`/v1/projects/${regression.id}/generate`,eventFrame('accepted',{projectId:regression.id,kind:'generation',id:regression.batchId},{refresh:true,status:'queued',ready:0,failed:0,terminal:false}),true)});
    await waitFor('You can keep reading your saved content.');
    const active=await rowRects();assert.deepEqual(active,ready,'Active generation preserves row/action geometry');
    await capture(`lifecycle-active-${width}`);
    regression.active=false;notifyStream(`/v1/projects/${regression.id}/generate`,eventFrame('terminal',{projectId:regression.id,kind:'generation',id:regression.batchId},{status:'partial',ready:5,failed:1,terminal:true,outcome:'partial'}),true);await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'completed generation enables action');
    const completed=await rowRects();assert.deepEqual(completed,ready,'Completion preserves row/action geometry');
    lifecycleGeometry.push({width,theme,ready,sending,active,completed});
  }
  await writeFile(join(artifacts,'direct-lifecycle-geometry.json'),JSON.stringify(lifecycleGeometry,null,2));
  await openRegression('read_failure',[],true);regression.progressBroken=true;await reloadDocument();
  await waitFor('Saved regression output remains available.');await waitFor('Refresh results');
  await evaluate(`navigator.clipboard.writeText=async()=>{}`);await click('Copy text');await waitFor('Copied to clipboard.');
  assert.equal(regressionCalls.length,0,'Read recovery never generates');
  regression.progressBroken=false;await click('Refresh results');
  await openRegression('active',[],true);regression.active=true;await reloadDocument();
  await waitFor('You can keep reading your saved content.');
  assert.equal(await evaluate(`document.querySelectorAll('.generation-format').length`),6);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.generation-format > button')).filter(button=>button.textContent==='Create').every(button=>button.disabled)`),true);
  await evaluate(`navigator.clipboard.writeText=async()=>{}`);await click('Copy text');await waitFor('Copied to clipboard.');
  for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`active-direct-${width}`);}
  assert.equal(regressionCalls.length,0,'Active work does not submit more generation');
  regression.active=false;
  await openRegression('repeat_history',[],true);regression.history=[];
  await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'repeat action available');
  assert.equal(await evaluate(`document.querySelector('.generation-format > button').getAttribute('aria-label')`),'Create X post');
  await evaluate(`(()=>{const buttons=document.querySelectorAll('.generation-format > button');buttons[0].click();buttons[1].click();buttons[0].click();})()`);
  await waitUntil(`document.querySelectorAll('.output-index button').length===2`,'second saved output');assert.equal(regressionCalls.length,1,'Rapid sibling/repeat clicks admit one request');
  await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'next repeat available');
  await evaluate(`document.querySelector('.generation-format > button').click()`);await waitUntil(`document.querySelectorAll('.output-index button').length===3`,'third saved output');
  assert.equal(regressionCalls.length,2);assert.notEqual(regressionCalls[0].headers['Idempotency-Key'],regressionCalls[1].headers['Idempotency-Key']);
  assert.ok(regressionCalls.every(call=>JSON.stringify(JSON.parse(call.postData).outputs)===JSON.stringify({x_posts:1})));
  assert.equal(await evaluate(`document.querySelector('.output-copy').textContent`),'Saved regression output remains available.','New results preserve current reader');
  await verifyStableSelection('history');
  for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`repeat-history-${width}`);}
  await openRegression('quota',[[403,'allowance_exceeded']]);await selectOne();
  await waitFor('remaining allowance');await waitUntil(`document.querySelector('.generation-format > button')?.textContent==='Create'&&!document.querySelector('.generation-format > button')?.disabled`,'rejected action available');
  await selectOne();await waitFor('Saved regression output remains available.');
  assert.notEqual(regressionCalls[0].headers['Idempotency-Key'],regressionCalls[1].headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(regressionCalls[0].postData).outputs,{x_posts:1});
  assert.deepEqual(JSON.parse(regressionCalls[1].postData).outputs,{x_posts:1});
  for(const first of ['lost','malformed']) {
    await openRegression(first,[first,[403,'allowance_exceeded'],[403,'subscription_required']]);await selectOne();await waitFor('Retry request');assert.equal(await evaluate(`Boolean(document.querySelector('.generation-feedback-warning'))`),true,'Safe original retry remains visible');
    await click('Retry request');await waitFor('remaining allowance');
    await navigate(`/projects/${regression.id}`);await waitFor('Retry request');assert.equal(await evaluate(`Boolean(document.querySelector('.generation-feedback-warning'))`),true,'Safe original retry remains visible');await click('Retry request');await waitFor('Active account access');
    assert.equal(new Set(regressionCalls.map(call=>call.headers['Idempotency-Key'])).size,1);
    assert.equal(new Set(regressionCalls.map(call=>call.postData)).size,1);
    assert.equal(await evaluate(`document.querySelector('.generation-format > button').disabled`),true);
  }
  await openRegression('legacy_count',[]);
  await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');sessionStorage.setItem('riflo:batch:'+firebaseAuth().currentUser.uid+':regression_legacy_count',JSON.stringify({key:'legacy_generation_request_123',selection:{x_posts:2,linkedin_posts:2}}))})()`);
  await reloadDocument();await waitFor('Retry request');
  await waitFor('2 × X post · 2 × LinkedIn post');
  assert.equal(await evaluate(`document.querySelectorAll('.generation-format select').length`),0,'Legacy pending requests show exact counts without editable quantity controls');
  await click('Retry request');await waitFor('Saved regression output remains available.');
  assert.equal(regressionCalls[0].headers['Idempotency-Key'],'legacy_generation_request_123');
  assert.deepEqual(JSON.parse(regressionCalls[0].postData).outputs,{x_posts:2,linkedin_posts:2});
  await verifyStableSelection("saved-results");
  await openRegression('existing',[[409,'generation_exists']]);await selectOne();await waitFor('Saved regression output remains available.');
  assert.equal(await evaluate(`document.body.innerText.includes('Retry request')`),true,'Unrelated current batch cannot resolve an unanswered request');
  for(const mode of ['error','malformed']) {
    await openRegression(`availability_${mode}`,[],true);regression[mode==='error'?'availabilityBroken':'availabilityMalformed']=true;await reloadDocument();
    await waitUntil(`!!document.querySelector('.create-content-chooser')`,'creation remains available for viewing saved formats');await evaluate(`document.querySelector('.create-content-chooser').open=true`);await waitFor('Retry availability check');
    await waitFor('Saved regression output remains available.');
    assert.equal(await evaluate(`document.body.innerText.includes('New creation is paused')`),true);
    regression.availabilityBroken=false;regression.availabilityMalformed=false;await click('Retry availability check');await waitUntil(`!document.body.innerText.includes('Retry availability check')`,'availability recovery');
  }
  regression={id:'regression_import',import:true,replies:[[403,'allowance_exceeded']]};regressionCalls.length=0;
  await navigate('/projects');await click('New project');await waitFor('Paste a Google Drive video link');
  async function checkRegressionImport(){await evaluate(`(()=>{const input=document.querySelector('#drive-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://drive.google.com/file/d/test_video/view?resourcekey=original_key');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('Import video');}
  await checkRegressionImport();await waitFor('source video allowance');assert.equal(await evaluate(`document.querySelector('#drive-link').disabled`),false);
  await checkRegressionImport();await waitFor('Give this video a new form.');assert.notEqual(regressionCalls[0].headers['Idempotency-Key'],regressionCalls[1].headers['Idempotency-Key']);
  for(const first of ['lost','malformed']) {
    regression={id:`regression_import_${first}`,import:true,replies:[first,[403,'allowance_exceeded'],[403,'subscription_required']]};regressionCalls.length=0;
    await navigate('/projects');await click('New project');await waitFor('Paste a Google Drive video link');
    await checkRegressionImport();await waitFor('Check import status');await click('Check import status');await waitFor('source video allowance');
    assert.equal(await evaluate(`document.querySelector('#drive-link').disabled`),true);
    await navigate('/projects');await click('Check import status');await waitFor('Check import status');
    assert.equal(await evaluate(`document.querySelector('fieldset.source-choice').disabled`),true);
    assert.equal(await evaluate(`document.querySelector('#drive-link').value`),'https://drive.google.com/file/d/test_video/view?resourcekey=original_key');
    await waitFor('Your selection is saved while we confirm');
    await click('Check import status');await waitFor('Active account access');
    assert.equal(new Set(regressionCalls.map(call=>call.headers['Idempotency-Key'])).size,1);
    assert.equal(new Set(regressionCalls.map(call=>call.postData)).size,1);
    assert.deepEqual(JSON.parse(regressionCalls[2].postData),{fileId:'test_video',resourceKey:'original_key'});
    // Only this fixture's abandoned import intent is removed between independent cases.
    await evaluate(`Object.keys(sessionStorage).filter(key=>key.startsWith('riflo:import:')||(key.startsWith('riflo-import:')&&key.includes(':test_video:'))).forEach(key=>sessionStorage.removeItem(key))`);
  }
  regression=null;
  expired=true;await navigate('/usage');await waitFor('Your access has expired.');
  await navigate('/projects/test_project');await waitFor('Your access has expired.');await waitFor('Saved content');await waitFor('literal only');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');await capture(`preview-${width}`);
  }
  await evaluate(`window.__previewRail=document.querySelector('.sidebar');document.querySelector('nav a[href^="/usage"]').click()`);
  await waitFor('SAMPLE ACCESS PERIOD');
  assert.equal(await evaluate(`window.__previewRail===document.querySelector('.sidebar')&&new URL(location.href).searchParams.get('preview')==='true'`),true,'Preview navigation retains its own shell');
  assert.ok(downloads.some(path=>path.endsWith('/text/download'))&&downloads.some(path=>path.includes('slide1'))&&downloads.some(path=>path.includes('clip1')));
  const fixtureDownload=join(artifacts,'downloads','x_posts.txt');
  for(let attempt=0;attempt<100;attempt++) {
    if((await readdir(join(artifacts,'downloads'))).includes('x_posts.txt'))break;
    await sleep(50);
  }
  assert.equal(await readFile(fixtureDownload,'utf8'),outputs[0].text,'Browser downloads must stay in the test artifact directory');
  await writeFile(join(artifacts,'requests.json'),JSON.stringify(commands,null,2));
  await writeFile(join(artifacts,'stream-transport.json'),JSON.stringify(streamEvidence,null,2));
  await navigate('/projects');await waitFor('All projects');
  await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{updateProfile,updateEmail}=await import('/node_modules/.vite/deps/firebase_auth.js');await updateProfile(firebaseAuth().currentUser,{displayName:'Studio Tester',photoURL:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" fill="gray"/%3E%3C/svg%3E'});await updateEmail(firebaseAuth().currentUser,'studio@example.test');})()`);
  await reloadDocument();await waitFor('All projects');
  assert.equal(await evaluate('Boolean(document.querySelector(".session-actions"))'),false,'logout is absent from global shell');
  await evaluate('window.__settingsRail=document.querySelector(".sidebar");document.querySelector(".settings-trigger").click()');
  await waitFor('studio@example.test');await waitFor('Studio Tester');
  assert.equal(await evaluate('window.__settingsRail===document.querySelector(".sidebar")'),true,'settings retains shell');
  assert.equal(await evaluate('document.activeElement.id'),'main','settings navigation focuses content');
  assert.equal(await evaluate('Boolean(document.querySelector(".settings-profile .avatar img"))'),true,'auth photo is shown');
  assert.equal(await evaluate('document.querySelectorAll(".settings-session button").length'),1,'sign out appears once in Settings');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===375});
    await capture(`settings-auth-${width}`);
  }
  await reloadDocument();await waitFor('studio@example.test');
  await evaluate('history.back()');await waitFor('All projects');
  assert.equal(await evaluate('Boolean(document.querySelector(".settings-page"))'),false,'browser back restores projects');
  await writeFile(join(artifacts,'settings-auth-checks.json'),JSON.stringify({profile:'Studio Tester / studio@example.test, photo present',shellPreserved:true,contentFocused:true,refresh:true,historyBack:true,globalLogoutAbsent:true,settingsLogoutCount:1},null,2));
  await writeFile(join(artifacts,'broader-behavior-checks.json'),JSON.stringify({detailLifecycle:true,exactReplay:true,legacyReplay:true,repeatAppends:true,sourceImportReplay:true,savedReaderAndDownloads:true,expiredAccess:true,previewNavigation:true,settingsHistory:true},null,2));
  await (await import('./theme.mjs')).checkTheme({command,evaluate,navigate,waitFor,waitUntil,capture});
  console.log('PASS: first quota rejections allow new request keys and reduced generation counts; lost/malformed replies retain keys and full payloads through later403 and reload; restored Drive resource key and YouTube source stay locked; existing-generation reconciliation; saved outputs survive failed/malformed allowance checks and retry recovers; isolated artifact-only downloads; failed/malformed/stalled Drive status leaves workspace and YouTube available; bounded timeout and status retry; emulator auth; all six outputs; partial text/copy/TXT; authenticated PNG/MP4 and object URL cleanup; usage/expired access; disconnect failure; responsive screenshots; keyboard skip link; reduced motion; persistent navigation shell/history/auth. All API responses are fixtures.');
} finally {
  closeStreams();
  await writeFile(join(artifacts,'stream-transport.json'),JSON.stringify(streamEvidence,null,2));
  await writeFile(join(artifacts,'requests.json'),JSON.stringify(commands,null,2));
  socket.close();
}
