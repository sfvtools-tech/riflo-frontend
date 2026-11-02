import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkOutputs({command,evaluate,waitFor,waitUntil,capture,sleep,click,commands,outputs,png,mp4,publicOutputResponses}) {
  const artifacts=process.env.RIFLO_SMOKE_ARTIFACTS;
  await waitFor('literal only');
  await evaluate(`window.__revoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__revoked.push(url);revoke(url)};navigator.clipboard.writeText=async text=>{window.__copied=text}`);
  await click('Copy text');await waitFor('Copied to clipboard.');
  assert.equal(await evaluate('window.__copied'),outputs[0].text);
  await click('Download TXT');
  const shots=async name=>{
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove();window.scrollTo(0,document.querySelector('.saved-content')?.offsetTop??0)`);
      await capture(`outputs-${name}-${width}`);
    }
  };
  await shots('text');
  const choose=async name=>evaluate(`Array.from(document.querySelectorAll('.output-index button')).find(button=>button.textContent.includes(${JSON.stringify(name)})).click()`);
  await choose('Carousel');await waitFor('Download PNG');
  await waitUntil(`document.querySelector('.slide-preview img')?.naturalWidth===1`,'private PNG decoded');
  assert.match(await evaluate(`document.querySelector('.slide-preview img').src`),/^blob:/);
  await evaluate(`document.querySelector('a[download="slide1.png"]').click()`);
  await shots('carousel');
  await choose('Short video');await waitFor('Download MP4');
  await waitUntil(`document.querySelector('video')?.videoWidth===160&&document.querySelector('video')?.videoHeight===90`,'private MP4 metadata decoded');
  assert.equal(await evaluate(`(async()=>{const video=document.querySelector('video');video.muted=true;const frame=new Promise((resolve,reject)=>{video.requestVideoFrameCallback(()=>resolve(true));setTimeout(()=>reject(Error('MP4 frame decode stalled')),3000)});await video.play();const decoded=await frame;video.pause();return decoded})()`),true,'native video playback presents a decoded frame');
  await evaluate(`document.querySelector('a[download="clip1.mp4"]').click()`);
  await shots('video');
  await evaluate(`document.querySelector('.create-content-chooser').open=true;document.querySelector('[aria-label="View 1 saved X post outputs"]').click()`);
  await waitFor('literal only');
  assert.ok(await evaluate('window.__revoked.length>=2'),'switching saved outputs revokes image and video URLs');
  const reads=await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{readOutputs}=await import('/src/features/projects/generation-response.ts');const token=await firebaseAuth().currentUser.getIdToken();const get=async path=>(await(await fetch(path,{headers:{authorization:'Bearer '+token}})).json()).data;const list=await get('/v1/projects/test_project/outputs');const singles=await Promise.all(list.map(o=>get('/v1/projects/test_project/outputs/'+o.id)));readOutputs(list,'test_project');readOutputs(singles,'test_project');const old=list.map(o=>({...o,model:'cached-model',promptVersion:'cached-version'}));readOutputs(old,'test_project');return {list,singles,oldAccepted:true}})()`);
  assert.deepEqual(reads.list,outputs);assert.deepEqual(reads.singles,outputs);
  assert.ok(publicOutputResponses.length>=4);
  for(const {body} of publicOutputResponses)for(const output of Array.isArray(body)?body:[body]) {
    assert.deepEqual(Object.keys(output).sort(),['id','feature','text','createdAt','expiresAt',...(output.data?['data']:[]),...(output.assets?['assets']:[])].sort());
    for(const asset of output.assets??[])assert.deepEqual(Object.keys(asset).sort(),['id','contentType','bytes','width','height','downloadPath',...(asset.durationSeconds===undefined?[]:['durationSeconds'])].sort());
    assert.equal('model' in output,false);assert.equal('promptVersion' in output,false);
  }
  const forbidden=['/v1/usage','/v1/brand','/v1/drive/connection','/v1/capabilities'];
  assert.deepEqual(commands.filter(call=>forbidden.some(path=>call===`GET ${path}`)),[]);
  assert.ok(commands.every(call=>call.startsWith('GET ')),'view/copy/download never starts paid work');
  for(let i=0;i<100;i++) {
    const files=await readdir(join(artifacts,'downloads'));
    if(['x_posts.txt','slide1.png','clip1.mp4'].every(file=>files.includes(file)))break;
    await sleep(50);
  }
  assert.equal(await readFile(join(artifacts,'downloads','x_posts.txt'),'utf8'),outputs[0].text);
  assert.deepEqual(await readFile(join(artifacts,'downloads','slide1.png')),png);
  assert.deepEqual(await readFile(join(artifacts,'downloads','clip1.mp4')),mp4);
  await writeFile(join(artifacts,'outputs-checks.json'),JSON.stringify({copyExact:true,txtExact:true,pngExact:true,mp4Exact:true,decodedImage:{width:1,height:1},decodedVideo:{width:160,height:90,framePresented:true},savedView:true,oldCacheAccepted:reads.oldAccepted,forbiddenProjectReads:[],publicOutputResponses,commands},null,2));
  console.log('PASS: public outputs render, copy, View and download exact saved bytes with private authenticated media, no provider metadata or account reads.');
}
