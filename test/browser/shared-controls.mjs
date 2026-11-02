import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkSharedControls({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,click,holdReads,releaseReads,setState}) {
  const evidence=[];
  const screenshots=async name=>{
    await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${name}: no horizontal overflow`);
      // The existing capture helper saves both light and dark appearances.
      await capture(`shared-${name}-${width}`);
    }
  };
  const checkButton=async text=>{
    await sleep(350);
    const state=await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)}));return {slot:b?.dataset.slot,height:b?.getBoundingClientRect().height}})()`);
    assert.equal(state.slot,'button');assert.ok(state.height>=44,`${text}: ${state.height}px target`);
  };
  await command('Page.bringToFront');await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  setState({accessFails:true});await navigate('/usage');await waitFor('A little interruption.');await checkButton('Try again');
  setState({accessFails:false});await click('Try again');await waitFor('CURRENT ACCESS PERIOD');
  setState({accessFails:true});await evaluate(`document.querySelector('nav a[href="/connections"]').click()`);await waitFor('Retry access check');await checkButton('Retry access check');await screenshots('access-recovery');
  setState({accessFails:false});await click('Retry access check');await waitUntil(`!document.body.innerText.includes('Retry access check')`,'access recovered');
  for(const route of ['/usage']) {
    setState({driveMode:'error'});await navigate(route);await waitFor('Retry connection status');await checkButton('Retry connection status');
    await screenshots(route==='/usage'?'usage-connection-recovery':'detail-connection-recovery');
    holdReads.add('/v1/drive/connection');setState({driveMode:'ok'});await click('Retry connection status');
    await waitUntil(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry connection status')?.disabled`,'pending retry disabled');
    await releaseReads();await waitUntil(`!document.body.innerText.includes('Retry connection status')`,'connection recovered');
  }
  setState({brandFails:true});await navigate('/projects/test_project');await waitUntil(`!!document.querySelector('.create-content-chooser')`,'creation chooser');
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);await waitFor('Writing preferences');
  await evaluate(`document.querySelector('.writing-preferences').open=true`);await waitUntil(`!document.getElementById('creation-audience').disabled`,'local preference controls');
  assert.equal(await evaluate(`document.querySelector('.writing-preferences a').getAttribute('href')`),'/settings/brand');
  assert.equal(await evaluate(`document.querySelector('.writing-preferences').textContent.includes('Saved preferences couldn’t be loaded.')`),false,'project preferences do not depend on profile reads');
  await screenshots('writing-preferences');setState({brandFails:false});
  await navigate('/projects?preview=true');await waitUntil(`!!document.querySelector('#preview-state')`,'preview toolbar');
  assert.equal(await evaluate(`document.querySelector('#preview-state').dataset.slot`),'native-select');
  assert.equal(await evaluate(`document.querySelector('#preview-state').labels[0].textContent`),'Explore a sample project state');
  await checkButton('Show sample state');
  await evaluate(`document.querySelector('#preview-state').focus()`);
  for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await evaluate(`document.querySelector('#preview-state').blur();document.querySelector('#preview-state').focus()`);await sleep(180);
  assert.equal(await evaluate(`document.activeElement.matches(':focus-visible')`),true);
  assert.match(await evaluate(`getComputedStyle(document.activeElement).boxShadow`),/3px/);
  for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate(`document.activeElement===document.querySelector('.preview-controls button')`),true);
  assert.equal(await evaluate(`document.activeElement.matches(':focus-visible')`),true);
  await screenshots('preview-toolbar');
  await evaluate(`document.querySelector('#preview-state').value='partial';document.querySelector('.preview-controls').requestSubmit()`);
  await waitUntil(`location.search.includes('state=partial')&&!!document.querySelector('#preview-state')`,'native GET navigation');
  assert.equal(await evaluate(`document.querySelector('#preview-state').value`),'partial');
  await navigate('/missing?preview=true');await waitFor('This page wandered off.');
  assert.equal(await evaluate(`document.querySelector('.empty-panel a').dataset.slot`),'button');
  await screenshots('fallback');
  await evaluate(`document.querySelector('.empty-panel a').click()`);await waitUntil(`location.pathname==='/projects'&&location.search.includes('preview=true')`,'fallback anchor navigation');
  evidence.push('cold account failure/retry','cached access failure/retry','Usage connection failure and disabled pending retry','project preferences independent of profile reads','preview select label/keyboard focus/native GET submit','fallback anchor navigation','375/1440 light/dark without overflow');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'shared-controls-checks.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: Shared recovery, local writing preferences, preview toolbar GET submission, fallback links and responsive light/dark controls.');
}
