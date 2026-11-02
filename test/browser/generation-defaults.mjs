import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkGenerationDefaults({command,evaluate,navigate,waitFor,waitUntil,capture,commands,holdReads,releaseReads}) {
  const loadingGeometry=[];
  for(const theme of ['light','dark']) for(const width of [375,600,601,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<601});
    await evaluate(`localStorage.setItem('riflo:appearance','${theme}')`);
    holdReads.add('/v1/generation-defaults');await navigate('/settings');
    await waitUntil(`!!document.querySelector('[aria-label="Loading generation defaults"]')`,'six-row defaults loading');
    const loadingSectionHeight=await evaluate(`document.querySelector('[aria-labelledby="generation-defaults-heading"]').getBoundingClientRect().height`);
    const loading=await evaluate(`Array.from(document.querySelector('[aria-label="Loading generation defaults"]').children).slice(0,6).map(e=>{const label=e.querySelector('.min-h-11'),r=document.createRange();r.selectNodeContents(label);return {top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,labelLeft:r.getBoundingClientRect().left}})`);
    await releaseReads();await waitUntil(`!!document.querySelector('#defaults-blogs-length')`,'defaults rows loaded');
    const loaded=await evaluate(`Array.from(document.querySelector('[aria-labelledby="generation-defaults-heading"]').querySelectorAll(':scope > details')).map(e=>{const label=e.querySelector('.min-h-11'),r=document.createRange();r.selectNodeContents(label);return {top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,labelLeft:r.getBoundingClientRect().left}})`);
    const loadedSectionHeight=await evaluate(`document.querySelector('[aria-labelledby="generation-defaults-heading"]').getBoundingClientRect().height`);
    assert.equal(loadedSectionHeight,loadingSectionHeight,'defaults actions keep total section height');
    assert.equal(loading.length,6);assert.deepEqual(loaded,loading,'defaults loading matches the six closed rows');
    loadingGeometry.push({theme,width,loading,loaded,loadingSectionHeight,loadedSectionHeight});
  }
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'defaults-loading-geometry.json'),JSON.stringify(loadingGeometry,null,2));
  await navigate('/settings');
  await waitUntil(`document.getElementById('defaults-blogs-length')?.value === 'short'`,'Enabled defaults fixture loaded');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:1100,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.getElementById('defaults-x_posts-maxPosts').closest('details').open=true;document.querySelector('.firebase-emulator-warning')?.remove()`);
  const missingFields = await evaluate(`['maxPosts','numbering'].map(field=>{const input=document.getElementById('defaults-x_posts-'+field);const style=getComputedStyle(input);const canvas=document.createElement('canvas');const context=canvas.getContext('2d');context.font=style.font;return {field,text:input.selectedOptions[0].text,textWidth:context.measureText(input.selectedOptions[0].text).width,available:input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),hint:document.getElementById(input.getAttribute('aria-describedby'))?.textContent}})`);
  for(const field of missingFields) {
    assert.equal(field.text,'Not set');
    assert.ok(field.textWidth<=field.available,`${field.field} placeholder fits at 375px`);
    assert.equal(field.hint,'Choose before creating a thread.');
  }
  await capture('empty-thread-defaults-375');
  await evaluate(`(()=>{const input=document.getElementById('defaults-x_posts-maxPosts');input.value='4';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitUntil(`!document.getElementById('defaults-x_posts-maxPosts-hint')`,'Chosen count removes its missing-value helper');
  assert.equal(await evaluate(`document.getElementById('defaults-x_posts-numbering-hint').textContent`),'Choose before creating a thread.');
  await evaluate(`(()=>{const input=document.getElementById('defaults-x_posts-maxPosts');input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitUntil(`Boolean(document.getElementById('defaults-x_posts-maxPosts-hint'))`,'Clearing count restores helper');
  await evaluate(`window.__settingsSidebar=document.querySelector('.sidebar');window.__confirmCalls=[];window.confirm=message=>{window.__confirmCalls.push(message);return false};document.getElementById('defaults-blogs-length').closest('details').open=true;(()=>{const input=document.getElementById('defaults-blogs-length');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'long');input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitUntil(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Save defaults'&&!button.disabled)`,'Changed defaults are dirty');
  await evaluate(`document.querySelector('.settings-nav a[href="/settings/brand"]').click()`);
  assert.equal(await evaluate('location.pathname'),'/settings','Cancelled internal link keeps General open');
  assert.equal(await evaluate(`document.getElementById('defaults-blogs-length').value`),'long','Cancelled navigation retains the unsaved choice');
  assert.deepEqual(await evaluate('window.__confirmCalls'),['Leave without saving your generation defaults?']);
  await evaluate(`document.querySelector('.settings-nav a[href="/settings"]').click()`);
  assert.equal(await evaluate('window.__confirmCalls.length'),1,'Same-page link does not prompt');
  await evaluate(`window.confirm=message=>{window.__confirmCalls.push(message);return true};document.querySelector('.settings-nav a[href="/settings/brand"]').click()`);
  await waitFor('Who is your content for?');
  assert.equal(await evaluate('location.pathname'),'/settings/brand','Confirmed internal link navigates');
  assert.equal(await evaluate(`document.querySelector('.sidebar')===window.__settingsSidebar`),true,'Navigation used the existing studio shell');
  await evaluate(`document.querySelector('.settings-nav a[href="/settings"]').click()`);
  await waitUntil(`document.getElementById('defaults-blogs-length')?.value === 'short'`,'Re-entry reads saved values');
  await evaluate(`window.confirm=()=>{throw Error('Clean defaults must not prompt')};document.querySelector('.settings-nav a[href="/settings/brand"]').click()`);
  await waitFor('Who is your content for?');
  assert.equal(await evaluate('location.pathname'),'/settings/brand','Clean defaults do not block navigation');
  assert.equal(commands.filter(call=>call==='PUT /v1/generation-defaults').length,0,'Navigation never saves implicitly');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'generation-defaults-navigation.json'),JSON.stringify({cancelPreservesDraft:true,confirmNavigates:true,samePageDoesNotPrompt:true,cleanNavigation:true,persistentShell:true,implicitWrites:0,missingThreadPlaceholders:missingFields},null,2));
}
