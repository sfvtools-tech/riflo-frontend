import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkGenerationControls({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,commands,fixture}) {
  const edit = async (id,value) => evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});if(!input)throw Error('Missing '+${JSON.stringify(id)});const prototype=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const click = async text => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);
  const latestSettingsVisible = () => evaluate(`Boolean(document.querySelector('[aria-label="Accepted creation settings"]'))`);
  const generate = `.create-content-dialog[open] .create-content-footer button`;
  const open = async format => {
    await waitUntil(`Boolean(document.querySelector('.create-content-chooser button'))`,'Creation chooser loaded');
    if (!await evaluate(`Boolean(document.querySelector('.create-content-dialog[open]'))`))
      await evaluate(`document.querySelector('.create-content-chooser button').click()`);
    if(await evaluate(`Boolean(document.querySelector('.create-content-dialog[open] .create-content-back'))`))
      await evaluate(`document.querySelector('.create-content-dialog[open] .create-content-back').click()`);
    const before=fixture.generationCalls.length;
    await evaluate(`document.querySelector('[data-format="${format}"]').click()`);
    await waitUntil(`Boolean(document.querySelector('#creation-${format}-'+${JSON.stringify(format==='carousels'?'density':format==='short_videos'?'duration':'length')}))`,'Format controls loaded');
    assert.equal(fixture.generationCalls.length,before,'Choosing a tile does not generate');
  };
  const showWindow = format => evaluate(`document.getElementById('${format}-start').closest('details').open=true`);
  const showDefaults = () => evaluate(`Array.from(document.querySelectorAll('.generation-options details')).find(el=>el.querySelector('summary')?.textContent==='About these defaults').open=true`);
  const refresh = async () => {
    const before=commands.filter(call=>call.endsWith('/generation/availability')).length;
    await evaluate(`window.dispatchEvent(new Event('focus'))`);
    for(let i=0;i<100&&commands.filter(call=>call.endsWith('/generation/availability')).length===before;i++)await sleep(30);
    await sleep(120);
  };
  const create = async format => {
    const count=fixture.generationCalls.length;
    if(count===0)fixture.delayGeneration=800;
    await waitUntil(`document.querySelector('${generate}')?.disabled===false`,'Creation available');
    await evaluate(`document.querySelector('${generate}').click()`);
    for(let i=0;i<100&&fixture.generationCalls.length===count;i++)await sleep(30);
    assert.equal(fixture.generationCalls.length,count+1,'One explicit creation request: '+await evaluate(`document.body.innerText`));
    if(count===0) {
      await waitUntil(`document.activeElement?.classList.contains('generation-feedback')`,'First generation feedback receives focus');
      await sleep(120);
      assert.equal(await evaluate(`document.activeElement?.classList.contains('generation-feedback')`),true,'Dialog restoration does not steal first-generation focus');
      fixture.delayGeneration=0;
    }
    await waitUntil(`!document.querySelector('[aria-label="Pending creation settings"]')`,'Creation request accepted');
    await waitUntil(`!document.querySelector('.create-content-dialog[open]')`,'Creation dialog closes on acceptance');
    assert.equal(await latestSettingsVisible(),false,'Accepted settings summary stays hidden');
    const body=JSON.parse(fixture.generationCalls.at(-1).postData);
    assert.deepEqual(body.outputs,{[format]:1});
    return body;
  };
  const shots = async name => {
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);
      await capture(`${name}-${width}`);
    }
  };

  await command('Page.bringToFront');
  await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  await navigate('/settings');
  await waitUntil(`Boolean(document.getElementById('defaults-blogs-length'))`,'Defaults loaded');
  const saved={x_posts:{length:'short',mode:'thread',maxPosts:6,numbering:'exclude'},linkedin_posts:{length:'short'},blogs:{length:'long'},newsletters:{length:'medium'},carousels:{density:'light',theme:'light'},short_videos:{duration:30,editing:'continuous',captions:'clean'}};
  for(const [format,fields] of Object.entries(saved)) for(const [field,value] of Object.entries(fields)) await edit(`defaults-${format}-${field}`,value);
  await click('Save defaults');await waitFor('Saved');
  assert.deepEqual(JSON.parse(fixture.settingsCalls.find(call=>call.method==='PUT').postData),saved,'Only durable format settings are saved');
  await reloadDocument();
  await waitUntil(`document.getElementById('defaults-short_videos-captions')?.value==='clean'`,'Saved defaults survive reload');
  assert.equal(await evaluate(`document.getElementById('defaults-x_posts-maxPosts').value`),'6');
  await evaluate(`document.getElementById('defaults-short_videos-captions').closest('details').open=true`);
  await shots('controls-settings');
  fixture.settingsSaveFails=true;
  await edit('defaults-blogs-length','short');await click('Save defaults');
  await waitFor('Generation defaults are temporarily unavailable.');
  assert.equal(await evaluate(`document.getElementById('defaults-blogs-length').value`),'short','Failed save preserves draft');
  fixture.settingsSaveFails=false;
  await click('Discard changes');
  assert.equal(await evaluate(`document.getElementById('defaults-blogs-length').value`),'long');
  fixture.settingsReadFails=true;
  await reloadDocument();await waitFor('Generation defaults are temporarily unavailable.');
  assert.equal(await evaluate(`Boolean(document.getElementById('defaults-blogs-length'))`),false,'Failed read does not fabricate saved values');
  fixture.settingsReadFails=false;await click('Retry defaults');
  await waitUntil(`document.getElementById('defaults-blogs-length')?.value==='long'`,'Read retry restores saved values');

  const preferenceMounts = {};
  const measurePreferences = async label => {
    preferenceMounts[label] = await evaluate(`({trees:document.querySelectorAll('.writing-preferences').length,fields:document.querySelectorAll('.writing-preferences input,.writing-preferences textarea,.writing-preferences select').length,nodes:document.querySelectorAll('.writing-preferences *').length})`);
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'preference-mounts.json'),JSON.stringify(preferenceMounts,null,2));
  };
  const detailStart=commands.length;
  fixture.delayAvailability=1800;
  await navigate('/projects/controls_fixture');
  await waitUntil(`Boolean(document.querySelector('.create-content-chooser button'))`,'Cold chooser mounted');
  await measurePreferences('closedColdDetail');
  assert.deepEqual(preferenceMounts.closedColdDetail,{trees:0,fields:0,nodes:0},'Closed cold creation mounts no writing editors');
  await evaluate(`document.querySelector('.create-content-chooser button').click()`);
  await waitFor('Loading formats and costs…');
  await evaluate(`document.querySelector('[data-format="x_posts"]').click()`);
  assert.equal(await evaluate(`document.querySelector('${generate}').disabled`),true,'Cold availability disables Generate');
  await waitUntil(`Boolean(document.getElementById('creation-x_posts-length'))`,'Cold format choices resolve');
  await measurePreferences('firstWrittenFormat');
  assert.equal(preferenceMounts.firstWrittenFormat.trees,1,'Only the visited written format mounts preferences');
  assert.equal(preferenceMounts.firstWrittenFormat.fields,5);
  fixture.delayAvailability=0;
  await open('x_posts');
  await waitUntil(`document.querySelector('${generate}')?.disabled===false`,'Loaded price enables creation');
  const availabilityCount=()=>commands.filter(call=>call.endsWith('/generation/availability')).length;
  const beforeBackground=availabilityCount();
  const beforePrice=await evaluate(`document.querySelector('.create-content-footer').innerText`);
  fixture.delayAvailability=1600;
  await evaluate(`window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))`);
  await sleep(150);
  assert.equal(availabilityCount(),beforeBackground+1,'Focus and visibility share one pending availability request');
  assert.equal(await evaluate(`document.querySelector('.create-content-footer').innerText`),beforePrice,'Background availability preserves cost');
  assert.equal(await evaluate(`document.querySelector('${generate}').disabled`),false,'Background refresh preserves valid action');
  assert.equal(await evaluate(`document.body.innerText.includes('Checking availability')`),false,'Background check does not add a banner');
  for(const format of ['blogs','newsletters','carousels','short_videos','linkedin_posts','x_posts'])await open(format);
  assert.equal(availabilityCount(),beforeBackground+1,'Format navigation does not fetch availability');
  await sleep(1700);fixture.delayAvailability=0;
  // The server's pre-expiry projection arrives after its deadline. It must not
  // become a fresh approval just because network delivery was slow.
  fixture.availabilityExpiry=new Date(Date.now()+500).toISOString();
  fixture.delayAvailability=1000;
  const beforeBoundary=availabilityCount();
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  for(let i=0;i<100&&availabilityCount()<beforeBoundary+2;i++)await sleep(30);
  assert.equal(availabilityCount(),beforeBoundary+2,'Crossed response deadline triggers one canonical recheck');
  assert.equal(await evaluate(`document.querySelector('${generate}').disabled`),true,'Delayed pre-expiry approval remains blocked during canonical recheck');
  await waitUntil(`document.querySelector('${generate}').disabled===false`,'Post-deadline backend approval restores eligible formats');
  await sleep(150);
  assert.equal(availabilityCount(),beforeBoundary+2,'Already-expired boundary does not loop after canonical recheck');
  fixture.delayAvailability=0;fixture.availabilityExpiry=null;
  fixture.availabilityExpiry=new Date(Date.now()+500).toISOString();
  fixture.delayAvailability=1000;fixture.failExpiredAvailability=true;
  const beforeFailedBoundary=availabilityCount();
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await waitFor('Availability couldn’t be checked.');
  await sleep(250);
  assert.equal(availabilityCount(),beforeFailedBoundary+2,'Failed deadline recheck stops instead of retrying in a loop');
  assert.equal(await evaluate(`document.querySelector('${generate}').disabled`),true,'Failed deadline recheck keeps creation blocked');
  fixture.delayAvailability=0;fixture.availabilityExpiry=null;fixture.failExpiredAvailability=false;
  await evaluate(`Array.from(document.querySelectorAll('.create-content-dialog[open] button')).find(button=>button.textContent==='Retry availability check').click()`);
  await waitUntil(`document.querySelector('${generate}').disabled===false`,'Explicit retry recovers failed deadline recheck');
  await (await import('./creation-options-layout.mjs')).checkCreationOptionsLayout({command,evaluate,open,edit,capture,sleep});
  await open('x_posts');
  await shots('creation-x-options');
  await evaluate(`document.querySelector('.create-content-back').click()`);
  assert.equal(await evaluate(`document.activeElement.dataset.format`),'x_posts','Back restores chosen tile focus');
  await shots('creation-choose');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await waitUntil(`!document.querySelector('.create-content-dialog[open]')`,'Escape closes dialog');
  assert.equal(await evaluate(`document.activeElement?.closest('.create-content-chooser')!==null`),true,'Escape restores launcher focus');
  await open('x_posts');
  await evaluate(`document.querySelector('.create-content-back').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});
  assert.equal(await evaluate(`Boolean(document.activeElement.closest('.create-content-dialog'))`),true,'Shift Tab remains inside modal');
  assert.equal(await evaluate(`document.getElementById('creation-x_posts-maxPosts').value`),'','Thread count inherits saved preference');
  await waitFor('Up to 6 credits');
  await edit('creation-x_posts-audience','X audience draft');await showWindow('x_posts');await edit('focus-x_posts','Only for X');await edit('x_posts-start',1);await edit('x_posts-end',30);
  await evaluate(`document.querySelector('.create-content-close').click()`);
  await open('x_posts');
  assert.equal(await evaluate(`document.getElementById('creation-x_posts-audience').value`),'X audience draft','Closing and reopening preserves writing drafts');
  await open('blogs');
  assert.equal(await evaluate(`document.getElementById('creation-blogs-audience').value`),'','Writing draft does not leak to Blog');
  assert.equal(await evaluate(`document.getElementById('focus-blogs').value`),'','Focus does not leak to another format');
  assert.equal(await evaluate(`document.getElementById('blogs-start').value`),'','Window does not leak to another format');
  await showDefaults();await edit('creation-blogs-length','auto');await waitFor('Length: Auto (this creation)');
  await click('Reset to defaults');
  assert.equal(await evaluate(`document.getElementById('creation-blogs-length').value`),'','Reset restores inheritance');
  await waitFor('Length: Long (saved)');
  await open('x_posts');assert.equal(await evaluate(`document.getElementById('focus-x_posts').value`),'Only for X','Back preserves per-format draft');assert.equal(await evaluate(`document.getElementById('creation-x_posts-audience').value`),'X audience draft','Back preserves writing draft');await open('blogs');
  await edit('creation-blogs-length','auto');
  await evaluate(`document.getElementById('creation-blogs-audience').closest('details').open=true;document.getElementById('creation-blogs-audience').closest('details').querySelector('.writing-preferences-toggle input').click()`);
  const blog=await create('blogs');
  assert.deepEqual(blog.controls,{formats:{blogs:{length:'auto'}}});
  assert.deepEqual(blog.brand,{mode:'none'},'Brand off does not discard generation controls');
  assert.equal(Object.hasOwn(blog.controls,'focus'),false);
  await open('x_posts');
  assert.equal(await evaluate(`document.getElementById('creation-x_posts-audience').value`),'','Acceptance clears earlier per-format writing drafts');
  await open('blogs');
  assert.equal(await evaluate(`document.querySelector('#creation-blogs-audience').closest('details').querySelector('.writing-preferences-toggle input').checked`),true,'Acceptance restores saved-preference mode');

  for(const [format,,fields] of [
    ['linkedin_posts','LinkedIn post',{length:'medium'}],
    ['newsletters','Newsletter',{length:'short'}],
    ['carousels','Carousel',{density:'standard',theme:'dark'}],
    ['short_videos','Short video',{duration:45,editing:'continuous',captions:'clean'}],
    ['x_posts','X post',{mode:'single',length:'standard'}],
  ]) {
    await open(format);
    for(const [field,value] of Object.entries(fields))await edit(`creation-${format}-${field}`,value);
    await edit(`focus-${format}`,`Case ${format}`);
    if(format==='x_posts')await edit('creation-x_posts-audience','Audience for X request');
    await showWindow(format);await edit(`${format}-start`,5);await edit(`${format}-end`,35);
    assert.equal(await evaluate(`Boolean(document.querySelector('.create-content-dialog[open]'))`),true,'Options stay open');
    if(format==='short_videos') {
      await evaluate(`document.getElementById('creation-short_videos-duration').scrollIntoView({block:'nearest'})`);
      await shots('controls-video');
    }
    const body=await create(format);
    assert.deepEqual(body.controls,{focus:`Case ${format}`,sourceWindow:{startSeconds:5,endSeconds:35},formats:{[format]:fields}},'Request includes only the chosen format');
    if(format==='x_posts')assert.equal(body.brand.overrides.audience,'Audience for X request');
    if(format==='short_videos')assert.equal(body.brand,undefined,'Video defaults work without a writing profile');
  }

  await open('short_videos');await showWindow('short_videos');await edit('short_videos-start',5);await edit('short_videos-end',8);
  const beforeInvalid=fixture.generationCalls.length;
  await evaluate(`document.querySelector('${generate}').click()`);
  await waitFor('Video windows must span at least ten seconds.');
  assert.equal(fixture.generationCalls.length,beforeInvalid,'Invalid source window does not send a request');
  assert.equal(await evaluate(`document.activeElement.id`),'generation-control-error','Validation error receives focus');

  fixture.defaults.x_posts={mode:'thread'};
  await refresh();await open('x_posts');await waitFor('Choose maximum posts and numbering before generating.');
  assert.equal(await evaluate(`document.querySelector('${generate}')?.disabled===false`),false);
  await edit('creation-x_posts-maxPosts',4);
  assert.equal(await evaluate(`document.querySelector('${generate}')?.disabled===false`),false,'Numbering must also be selected');
  await edit('creation-x_posts-numbering','include');
  await waitUntil(`document.querySelector('${generate}')?.disabled===false`,'Both required thread choices enable generation');

  await open('blogs');await edit('creation-blogs-length','auto');
  await showWindow('blogs');await edit('focus-blogs','Original pending focus');await edit('blogs-start',4);await edit('blogs-end',30);
  fixture.replies.push('lost');
  await evaluate(`document.querySelector('${generate}').click()`);
  await waitFor('We couldn’t confirm whether it started.');
  const lost=fixture.generationCalls.at(-1);
  await waitFor('Pending request settings');
  assert.match(await evaluate(`document.querySelector('[aria-label="Pending creation settings"]').textContent`),/Original pending focus/);
  fixture.defaults.blogs={length:'short'};
  await reloadDocument();await waitFor('Pending request settings');
  await click('Retry request');
  await waitUntil(`!document.querySelector('[aria-label="Pending creation settings"]')`,'Accepted replay clears pending settings');
  assert.equal(fixture.generationCalls.at(-1).headers['Idempotency-Key'],lost.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(fixture.generationCalls.at(-1).postData),JSON.parse(lost.postData),'Lost reply keeps exact controls after reload');
  await waitUntil(`!Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Retry request')`,'Pending request cleared after acceptance');
  fixture.defaults.blogs={length:'medium'};
  await reloadDocument();await waitUntil(`Boolean(document.querySelector('.create-content-chooser button'))`,'Creation chooser loaded');
  assert.equal(await latestSettingsVisible(),false,'Accepted settings stay hidden after reload and defaults changes');
  await shots('controls-accepted');

  fixture.defaultsStatus='unavailable';
  await refresh();await open('carousels');
  await waitFor('Saved defaults could not be loaded.');
  await edit('creation-carousels-density','light');await edit('focus-carousels','Fallback source case');
  await create('carousels');
  assert.equal(await latestSettingsVisible(),false,'Accepted fallback settings stay hidden');
  fixture.defaultsStatus='resolved';fixture.defaults.carousels={density:'standard',theme:'light'};
  await reloadDocument();await waitUntil(`Boolean(document.querySelector('.create-content-chooser button'))`,'Creation chooser loaded');
  assert.equal(await latestSettingsVisible(),false,'Accepted settings stay hidden after defaults recover');
  const detailReads=commands.slice(detailStart);
  assert.equal(detailReads.some(call=>['/v1/generation-defaults','/v1/brand','/v1/usage','/v1/capabilities'].some(path=>call===`GET ${path}`)),false,'Project detail does not fetch account defaults or brand');

  const existingOutputs=fixture.outputs;
  fixture.outputs=[];fixture.batch=null;fixture.resultsBroken=true;
  await reloadDocument();await waitFor('Refresh results');
  fixture.resultsBroken=false;fixture.delayOutputs=1500;fixture.outputs=existingOutputs;
  await click('Refresh results');
  await open('blogs');await edit('creation-blogs-audience','Keep during background completion');
  await edit('focus-blogs','Keep focus draft');
  await waitUntil(`Boolean(document.querySelector('.create-content-dialog[open] button') && Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='View saved Blog'))`,'Background outputs arrive while dialog is open');
  assert.equal(await evaluate(`document.getElementById('creation-blogs-audience').value`),'Keep during background completion','Background empty to saved keeps writing draft');
  assert.equal(await evaluate(`document.getElementById('focus-blogs').value`),'Keep focus draft','Background completion keeps control draft');
  fixture.delayOutputs=0;
  await click('View saved Blog');
  await waitUntil(`!document.querySelector('.create-content-dialog[open]')`,'View saved closes creation');
  assert.equal(await evaluate(`Boolean(document.activeElement.closest('.output-reader,.output-paper,.results-section'))`),true,'View saved focuses output content');

  fixture.remaining=0;
  await refresh();await open('blogs');
  await waitFor('Not enough creation credits.');
  assert.equal(await evaluate(`document.querySelector('${generate}').disabled`),true,'Refreshed credits gate generation');
  assert.equal(await evaluate(`Boolean(document.querySelector('.create-content-dialog[open] a[href="/usage"]'))`),true,'Credit restriction includes recovery action');
  fixture.availabilityBroken=true;
  await refresh();await waitFor('Availability couldn’t be checked.');
  assert.equal(await evaluate(`document.querySelector('${generate}').disabled`),true,'Stale availability does not allow generation');
  fixture.availabilityBroken=false;fixture.remaining=100;
  await evaluate(`Array.from(document.querySelectorAll('.create-content-dialog[open] button')).find(button=>button.textContent==='Retry availability check').click()`);
  await waitUntil(`document.querySelector('${generate}').disabled===false`,'Availability retry recovers generation');
  await evaluate(`document.querySelector('.create-content-close').click()`);

  fixture.available=false;
  await refresh();await evaluate(`document.querySelector('.create-content-chooser button').click()`);
  await waitUntil(`!document.getElementById('creation-blogs-length')`,'Global gate hides customization');
  await navigate('/settings');await waitFor('Customization is not available yet.');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[id^="defaults-"]')).filter(element=>element.tagName==='SELECT').every(element=>element.disabled)`),true,'Disabled capability prevents editing saved defaults');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'generation-controls-checks.json'),JSON.stringify({twoStepNoCharge:true,firstGenerationFocus:true,escapeRestoresLauncher:true,backRestoresTile:true,writingDraftsPerFormat:true,staleAvailabilityRecovery:true,backgroundCompletionKeepsDialogDraft:true,viewSavedFocus:true,savedDurablesOnly:true,reloadInheritance:true,settingsFailuresRecover:true,explicitAuto:true,resetToSaved:true,sourceDraftsPerFormat:true,allFormatsSubmitted:true,brandOffIndependent:true,videoDefaultsIndependent:true,missingThreadChoicesExplicit:true,pendingReplayExact:true,acceptedSummaryHidden:true,fallbackSummaryHidden:true,globalGateHonored:true,noDetailAccountReads:true,settingsWrites:fixture.settingsCalls.filter(call=>call.method==='PUT').map(call=>JSON.parse(call.postData)),generationRequests:fixture.generationCalls.map(call=>({key:call.headers['Idempotency-Key'],body:JSON.parse(call.postData)}))},null,2));
}
