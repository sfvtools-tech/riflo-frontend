import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkProjectMotion({command,evaluate,waitUntil,releaseReads,holdReads,setState}) {
  const evidence=[];
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const media=motion=>command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motion}]});
  const load=()=>command('Page.navigate',{url:'http://127.0.0.1:5188/projects'});
  const toggle=()=>evaluate(`document.querySelector('[aria-controls="project-import"]').click()`);
  const fill=value=>evaluate(`(()=>{const input=document.querySelector('#drive-link');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const check=()=>evaluate(`document.querySelector('.import-fields form').requestSubmit()`);
  const rects=()=>evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,width:r.width,height:r.height,bottom:r.bottom}};return {heading:rect('.library-heading'),ledger:rect('.library-ledger'),region:rect('.import-region'),input:rect('#drive-link'),picker:rect('[aria-label="Choose from Google Drive"]'),check:rect('.link-field > button'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  const settled=()=>evaluate(`(()=>{const e=document.querySelector('.import-region');return !e.getAnimations().some(a=>a.playState==='running')&&getComputedStyle(e).overflow==='visible'&&!e.style.height})()`);
  for(const theme of ['light','dark']) for(const width of [375,600,601,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<601});
    await media('reduce');
    await evaluate(`localStorage.setItem('riflo:appearance',${JSON.stringify(theme)})`);
    holdReads.add('/v1/capabilities');holdReads.add('/v1/projects');holdReads.add('/v1/drive/connection');
    await load();await waitUntil(`!!document.querySelector('[aria-label="Loading projects"]')`,'cold library shell');
    const cold=await rects();
    await releaseReads(['/v1/capabilities']);await waitUntil(`!!document.querySelector('[aria-controls="project-import"]')`,'library with held ledger');
    const ledgerLoading=await rects();
    assert.ok(Math.abs(cold.ledger.top-ledgerLoading.ledger.top)<1,`${width} ${theme}: capability handoff preserves ledger position`);
    assert.equal(await evaluate(`!!document.querySelector('.drive-status-notice')`),false,'checking Drive does not insert a temporary page band');
    await releaseReads();await waitUntil(`!!document.querySelector('.library-list')&&!document.querySelector('[aria-controls="project-import"]').disabled`,'loaded ledger');
    const loaded=await rects();assert.ok(Math.abs(loaded.ledger.top-cold.ledger.top)<1,'loaded ledger matches cold geometry');
    await media('no-preference');await evaluate('window.__motion=[]');await toggle();await sleep(260);
    const open=await rects();
    assert.equal(open.overflow,false);assert.equal(open.input.height,52);assert.equal(open.picker.height,44);assert.equal(open.check.height,width<601?44:52);
    if(width<601){assert.ok(open.picker.top>=open.input.bottom);assert.equal(open.check.top,open.picker.top);assert.ok(Math.abs(open.check.width-open.picker.width)<1);assert.equal(open.input.left,open.picker.left);assert.equal(open.input.right,open.check.right);}
    else {assert.equal(open.input.top+4,open.picker.top);assert.equal(open.input.right-4,open.picker.right);}
    let animations=await evaluate(`window.__motion.filter(r=>r.target==='import-region')`);
    assert.ok(animations.some(row=>row.frames.some(f=>f.height>1&&f.height<open.region.height-1)),'opening has intermediate rendered heights');
    assert.ok(animations.some(row=>row.frames.some(f=>f.ledgerTop>loaded.ledger.top+1&&f.ledgerTop<open.ledger.top-1)),'ledger moves continuously with disclosure');
    assert.equal(await settled(),true,'settled importer releases height and clipping');
    await fill('https://example.com/not-drive');await check();await waitUntil(`!!document.querySelector('.form-feedback[role=alert]')`,'inline invalid link');await sleep(250);
    const invalid=await rects();
    await fill('https://drive.google.com/file/d/test_video/view');await waitUntil(`!document.querySelector('.form-feedback[role=alert]')`,'valid draft clears inline feedback');await sleep(250);
    const confirmed=await rects();assert.equal(await settled(),true);
    await toggle();await sleep(35);await toggle();await sleep(35);await toggle();await sleep(260);
    assert.equal(await evaluate(`!!document.querySelector('#project-import')`),false);assert.equal((await rects()).region.height,0);assert.equal(await settled(),true);
    await toggle();await sleep(25);await media('reduce');await sleep(50);
    assert.equal(await settled(),true,'changing reduced motion cancels running resize');
    await evaluate('window.__motion=[]');await toggle();await sleep(40);await toggle();await sleep(40);
    assert.equal(await evaluate(`window.__motion.filter(r=>r.target==='import-region').length`),0,'reduced motion resize is immediate');
    await evaluate(`document.querySelector('#drive-link').focus();document.querySelector('#drive-link').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await evaluate(`document.activeElement.getAttribute('aria-controls')`),'project-import');
    assert.equal((await rects()).region.height,0);
    evidence.push({theme,width,cold,ledgerLoading,loaded,open,invalid,confirmed,animations});
  }
  setState({listMode:'error'});await load();await waitUntil(`!!document.querySelector('.library-error')`,'project error');
  setState({listMode:'ok'});await evaluate(`document.querySelector('.library-error button').click()`);await waitUntil(`!!document.querySelector('.library-list')&&!document.querySelector('.library-error')`,'project retry');
  setState({driveMode:'error'});await load();await waitUntil(`!!document.querySelector('.drive-status-notice button:not(:disabled)')`,'closed-import Drive recovery');
  setState({driveMode:'ok'});await evaluate(`document.querySelector('.drive-status-notice button').click()`);await waitUntil(`!document.querySelector('.drive-status-notice')`,'Drive recovery');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'project-motion-checks.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: project skeleton geometry, local import intermediate heights, validation/error resize, rapid reversal, dynamic reduced motion, Drive/list retries, responsive Picker375/600/601/1440 light/dark.');
}
