import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function installMotionProbe({command}) {
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__motion=[];
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      const animation=animate.call(this,frames,options),element=this;
      const row={target:element.id||element.className||element.tagName,path:location.pathname,duration:options.duration,keyframes:frames,start:performance.now(),frames:[]};
      window.__motion.push(row);
      const sample=()=>{const style=getComputedStyle(element);row.frames.push({time:performance.now()-row.start,opacity:style.opacity,transform:style.transform,height:element.getBoundingClientRect().height,ledgerTop:document.querySelector(".library-ledger")?.getBoundingClientRect().top});if(animation.playState==='running')requestAnimationFrame(sample)};
      requestAnimationFrame(sample);
      animation.finished.then(()=>row.end='finished',()=>row.end='cancelled');
      return animation;
    };
  `});
}

export async function checkMotion({command,evaluate,waitUntil,releaseReads,holdReads,setState}) {
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const evidence={cold:await evaluate('window.__motion')};
  assert.ok(evidence.cold.some(row=>row.duration===180&&row.end==='finished'),'real cold loading handoffs animate');
  const media=async motion=>command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motion},{name:'prefers-color-scheme',value:'light'}]});
  const navigate=async path=>evaluate(`(()=>{const link=document.createElement('a');link.href=${JSON.stringify(path)};document.body.append(link);link.click();link.remove()})()`);
  await media('no-preference');
  // Prime this snapshot immediately: the preceding full fixture flow can outlive the cache TTL.
  await navigate('/usage');await waitUntil(`!!document.querySelector('.usage-page .allowance-ledger')`,'fresh usage snapshot');await sleep(240);
  await navigate('/settings');await sleep(240);
  await evaluate(`window.__rail=document.querySelector('.sidebar');window.__railRect=JSON.stringify(window.__rail.getBoundingClientRect());window.__main=document.querySelector('#main');window.__motion=[]`);
  holdReads.add('/v1/usage');
  await navigate('/usage');await sleep(260);
  evidence.cached=await evaluate('window.__motion');
  assert.equal(evidence.cached.filter(row=>row.duration===180).length,0,'cached data mounts without extra entrance');
  assert.equal(evidence.cached.filter(row=>row.duration===200).length,1);
  await releaseReads();await sleep(220);
  evidence.refreshed=await evaluate('window.__motion');
  assert.equal(evidence.refreshed.length,1,'refresh does not add entrances: '+JSON.stringify(evidence.refreshed.map(({target,duration})=>({target,duration}))));
  assert.equal(await evaluate(`window.__rail===document.querySelector('.sidebar')&&window.__main===document.querySelector('#main')&&window.__railRect===JSON.stringify(window.__rail.getBoundingClientRect())`),true,'shell identity and rect stay fixed');
  const routeFrames=evidence.cached[0].frames;
  assert.ok(routeFrames.some(frame=>Number(frame.opacity)>.65&&Number(frame.opacity)<1),'route has actual intermediate frames');
  await evaluate('window.__motion=[]');
  await navigate('/settings');await sleep(25);await navigate('/usage');await sleep(25);await navigate('/settings');await sleep(260);
  evidence.rapidRoutes=await evaluate('window.__motion');
  assert.ok(evidence.rapidRoutes.some(row=>row.end==='cancelled'),'rapid route cancels old entrance');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#main')).opacity==='1'&&getComputedStyle(document.querySelector('#main')).transform==='none'&&location.pathname==='/settings'`),true);
  const screenshot=async name=>{const frame=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,name+'.png'),Buffer.from(frame.data,'base64'));};
  const choose=value=>evaluate(`document.querySelector('input[name=appearance][value=${value}]').click()`);
  await choose('light');await sleep(260);
  evidence.theme=await evaluate(`(async()=>{const frames=[];document.querySelector('input[name=appearance][value=dark]').click();for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);frames.push({time:performance.now(),theme:document.documentElement.dataset.theme,animations:document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes('view-transition')).map(a=>({pseudo:a.effect.pseudoElement,duration:a.effect.getTiming().duration,progress:a.effect.getComputedTiming().progress,keyframes:a.effect.getKeyframes().map(frame=>({opacity:frame.opacity,clipPath:frame.clipPath}))}))})}return frames})()`);
  assert.ok(evidence.theme.some(frame=>frame.animations.some(animation=>animation.duration===220)),'effective theme change captures scene transition');
  assert.ok(evidence.theme.some(frame=>frame.animations.some(animation=>animation.progress>0&&animation.progress<1)),'theme has actual intermediate progress');
  assert.ok(evidence.theme.some(frame=>frame.animations.some(animation=>animation.keyframes.some(keyframe=>keyframe.clipPath==='inset(0px 0px 100%)'))),'theme reveals opaque scenes with clip rather than opacity');
  await choose('dark');
  assert.equal(await evaluate('document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes("view-transition")).length'),0,'same effective theme does not start snapshot');
  await choose('light');await choose('dark');await choose('light');await sleep(260);
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  await screenshot('motion-theme-before');
  await choose('dark');await sleep(55);await screenshot('motion-theme-during');await sleep(260);await screenshot('motion-theme-after');
  await choose('light');await sleep(20);await media('reduce');await choose('dark');await sleep(260);
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark','reduced-motion latest choice defeats pending skipped update');
  assert.equal(await evaluate('document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes("view-transition")).length'),0);
  await media('no-preference');await choose('light');await sleep(260);
  await choose('system');await sleep(260);
  assert.equal(await evaluate('document.documentElement.hasAttribute("data-theme-motion")'),false,'same effective system choice stays still');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'no-preference'}]});
  await waitUntil(`document.documentElement.dataset.theme==='dark'`,'system theme change');
  await sleep(260);
  await media('reduce');await evaluate('window.__motion=[]');await navigate('/projects');await sleep(240);
  assert.equal(await evaluate('window.__motion.length'),0,'reduced motion bypasses native entrances');
  await navigate('/settings');await choose('light');
  assert.equal(await evaluate(`document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes('view-transition')).length`),0,'reduced motion bypasses theme transition');
  await media('no-preference');await navigate('/usage');await sleep(25);await media('reduce');await sleep(30);
  assert.equal(await evaluate(`document.querySelector('#main').getAnimations().length`),0,'new reduced-motion preference cancels running route');
  evidence.reduced=await evaluate('window.__motion');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'motion-checks-partial.json'),JSON.stringify(evidence,null,2));
  await (await import('./project-motion.mjs')).checkProjectMotion({command,evaluate,waitUntil,releaseReads,holdReads,setState});
  await media('reduce');
  await navigate('/settings');await choose('light');
  const probe=await command('Page.addScriptToEvaluateOnNewDocument',{source:`new MutationObserver(()=>{if(document.documentElement?.dataset.theme&&document.querySelector('#root')&&!window.__prepaint)window.__prepaint={theme:document.documentElement.dataset.theme,animated:document.documentElement.hasAttribute('data-theme-motion'),rootEmpty:!document.querySelector('#root')?.firstChild}}).observe(document,{subtree:true,childList:true});`});
  await command('Page.reload');await waitUntil('Boolean(window.__prepaint)','prepaint appearance');evidence.prepaint=await evaluate('window.__prepaint');
  assert.deepEqual(evidence.prepaint,{theme:'light',animated:false,rootEmpty:true});
  await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  await command('Page.navigate',{url:'http://127.0.0.1:5188/projects/sample?preview=true&state=partial'});
  await waitUntil(`Boolean(document.querySelector('.output-paper'))`,'sample output');
  await media('no-preference');await sleep(250);await evaluate('window.__motion=[]');
  await screenshot('motion-output-before');
  await evaluate(`document.querySelectorAll('.output-index button')[1].click()`);await sleep(45);await screenshot('motion-output-during');await sleep(220);await screenshot('motion-output-after');
  evidence.output=await evaluate('window.__motion');
  assert.equal(evidence.output.length,1,'one output selection entrance');
  assert.equal(evidence.output[0].duration,180);
  assert.ok(evidence.output[0].frames.some(frame=>Number(frame.opacity)>.72&&Number(frame.opacity)<1));
  await media('reduce');await evaluate('window.__motion=[];document.querySelectorAll(".output-index button")[2].click()');await sleep(50);
  assert.equal(await evaluate('window.__motion.length'),0,'reduced-motion output selection immediate');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'motion-checks.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: rendered cold/cached handoffs, timed route frames, shell continuity, rapid state cancellation, theme frames/system/prepaint, reduced motion.');
}
