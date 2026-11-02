import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkConnections({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,click,commands,holdReads,releaseReads,setState}) {
  const evidence=[];
  const ready=()=>waitUntil(`document.querySelector('section[aria-labelledby="drive-title"]')?.getAttribute('aria-busy')==='false'`,'settled connection');
  const screenshots=async state=>{await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`connections-${state}-${width}`);}};
  await command('Page.bringToFront');await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  await ready();await screenshots('connected');
  await evaluate(`document.querySelector('section[aria-labelledby="drive-title"] button').focus()`);
  for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await evaluate(`document.activeElement.blur();document.querySelector('section[aria-labelledby="drive-title"] button').focus()`);await sleep(180);
  assert.equal(await evaluate(`document.activeElement.matches(':focus-visible')`),true);
  assert.match(await evaluate(`getComputedStyle(document.activeElement).boxShadow`),/3px/);
  assert.ok(await evaluate(`document.activeElement.getBoundingClientRect().height>=44`));
  setState({deleteFailure:true});await click('Disconnect Drive');await waitFor('Please try again');await ready();
  assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-success')`),true);await screenshots('disconnect-error');
  setState({deleteFailure:false});await click('Disconnect Drive');await waitFor('Google could not confirm revocation');await ready();
  assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-error')`),true);assert.equal(await evaluate(`document.querySelector('a[href="https://myaccount.google.com/linkedapps?filters=3"]')?.target`),'_blank','revocation failure provides direct Google access recovery');await screenshots('revocation-warning');
  // Keep this mounted page: a failed read cannot replace its known disconnect,
  // while a later validated response may report a connection made in another tab.
  setState({disconnected:false});await click('Refresh connection');await waitFor('Your source, connected.');await ready();
  assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-success')`),true,'manual refresh reflects an external reconnect without remounting');
  assert.equal(await evaluate(`document.querySelector('.form-feedback').textContent`),'','fresh status replaces the old disconnect result');
  await screenshots('external-reconnect-refreshed');
  await click('Disconnect Drive');await waitFor('A good place to start.');await ready();
  setState({disconnected:false,mode:'error'});await click('Refresh connection');await waitFor('We could not check Google Drive.');
  assert.equal(await evaluate(`document.querySelector('#drive-title').textContent`),'A good place to start.');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Disconnect Drive')`),false,'failed refresh preserves the known disconnect');
  assert.match(await evaluate(`document.querySelector('.form-feedback').textContent`),/Riflo removed its saved access/,'failed refresh preserves the disconnect result');
  assert.equal(await evaluate(`document.querySelector('section[aria-labelledby="drive-title"]').getAttribute('aria-busy')`),'false','failed check is no longer pending');
  assert.equal(await evaluate(`document.querySelector('.connection-status').textContent.trim()`),'Status unavailable');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Connect Google Drive')).disabled`),true,'unverified state still blocks connection');
  assert.equal(await evaluate(`document.querySelector('section[aria-labelledby="drive-title"]').textContent.includes('Checking')`),false,'failed check never claims it is still checking');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Retry connection status').length`),1,'one status recovery action');assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Refresh connection').length`),0,'failed connection does not duplicate refresh');await screenshots('disconnected-refresh-error');
  setState({mode:'ok'});await click('Retry connection status');await waitFor('Your source, connected.');await ready();
  assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-success')`),true,'fresh validated response supersedes the optimistic disconnect');
  await screenshots('external-reconnect-retried');
  await click('Disconnect Drive');await waitFor('A good place to start.');await ready();
  await evaluate(`window.open=()=>null`);await click('Connect Google Drive');await waitFor('Allow popups');
  await evaluate(`window.open=()=>window.__connectionPopup={closed:false,opener:null,location:{href:''},close(){this.closed=true}}`);
  const before=commands.filter(v=>v==='POST /v1/drive/connection/authorize').length;
  await click('Connect Google Drive');await waitFor('Waiting for Google…');await screenshots('connecting');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Waiting for Google')).click()`);await sleep(100);
  assert.equal(commands.filter(v=>v==='POST /v1/drive/connection/authorize').length,before+1);
  await evaluate(`window.__connectionPopup.closed=true`);await waitFor('The Google window was closed.');await ready();await screenshots('cancelled');
  await click('Connect Google Drive');await waitFor('Waiting for Google…');setState({disconnected:false});await waitFor('Google Drive is connected.');await ready();
  assert.equal(await evaluate(`document.querySelector('.connection-status').classList.contains('state-success')`),true,'same mounted component reconnects after disconnect');
  holdReads.add('/v1/drive/connection');await click('Refresh connection');await waitFor('Checking connection…');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('section[aria-labelledby="drive-title"] button')).every(b=>b.disabled)`),true);await screenshots('checking');
  await releaseReads();await ready();
  for(const mode of ['error','malformed']){setState({mode});await navigate('/connections');await waitFor('Connection status unavailable.');await screenshots(mode);setState({mode:'ok'});await click('Retry connection status');await waitFor('Disconnect Drive');await ready();}
  setState({expired:true});await navigate('/connections');await waitFor('View access details');await ready();assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Disconnect Drive').disabled`),false);await screenshots('expired-connected');
  setState({disconnected:true});await navigate('/connections');await waitFor('New connections need active account access');await ready();assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Connect Google Drive')).disabled`),true);await screenshots('expired-disconnected');
  setState({expired:false,unconfigured:true});await navigate('/connections');await waitFor('awaiting setup by the Riflo team');await screenshots('unconfigured');
  await navigate('/connections?preview=true&state=empty');await waitFor('Preview only.');assert.equal(await evaluate(`document.querySelector('section[aria-labelledby="drive-title"] button').disabled`),true);await screenshots('preview');
  evidence.push('connected','disconnect failure retains status','revocation warning','popup blocked','connecting','duplicate connect blocked','popup closed','same-component reconnect','failed refresh preserves disconnect','validated refresh reflects external reconnect','refresh disables actions','error/malformed retry','expired disconnect allowed','expired connect blocked','unconfigured','preview','desktop/mobile light/dark','keyboard focus');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'connections-checks.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: Connections real handlers, disabled/busy actions, OAuth popup fixture, reconnect, error/retry, access gates, preview, keyboard focus and desktop/mobile light/dark.');
}
