import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkProjectDeletion({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands,setFixture,getFixture,streamEvidence,notifyStream,eventFrame}) {
  const key=async(key,code,number)=>{for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:number,...(key==='Enter'?{text:'\r'}:{})});};
  const open=async fixture=>{setFixture(fixture);await navigate('/projects/detail_fixture/settings');await waitUntil(`!!document.querySelector('.project-settings-page button[aria-haspopup=dialog]')`,'delete trigger');await waitFor('Project settings');};
  const launch=async()=>{await evaluate(`document.querySelector('.project-settings-page button[aria-haspopup=dialog]').click()`);await waitUntil(`document.querySelector('dialog').open`,'confirmation');};
  const shots=async name=>{for(const width of [375,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`project-delete-${name}-${width}`);assert.equal(await evaluate(`(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.width>200&&r.left>=0&&r.right<=innerWidth})()`),true,'dialog stays in viewport');assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog [aria-busy]')).flexDirection`),width===375?'column-reverse':'row','compiled responsive action layout');assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog')).paddingTop`),'24px','compiled dialog padding');assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog')).maxWidth`),'448px','compiled dialog max width');}};
  await command('Page.bringToFront');await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  const start=commands.length;
  await waitUntil(`!!document.querySelector('.project-settings-page button[aria-haspopup=dialog]')`,'loaded delete trigger');await launch();
  assert.equal(await evaluate(`document.activeElement.textContent`),'Cancel','safe initial focus');
  assert.equal(await evaluate(`document.querySelector('dialog').innerText.includes('A conversation worth keeping')`),true);
  assert.equal(await evaluate(`document.querySelector('dialog').innerText.includes('original Google Drive or YouTube video stays unchanged')`),true);
  await shots('confirm');
  await key('Escape','Escape',27);await waitUntil(`!document.querySelector('dialog').open`,'Escape cancels');
  await waitUntil(`document.activeElement.getAttribute('aria-haspopup')==='dialog'`,'cancel restores trigger focus');
  assert.equal(commands.slice(start).some(call=>call.startsWith('DELETE ')),false,'cancel does not delete');
  await launch();await key('Tab','Tab',9);assert.equal(await evaluate(`document.activeElement.dataset.variant`),'destructive');await key('Tab','Tab',9);assert.equal(await evaluate(`document.activeElement===document.body||document.querySelector('dialog').contains(document.activeElement)`),true,'native modal excludes background controls');if(await evaluate(`document.activeElement===document.body`))await key('Tab','Tab',9);assert.equal(await evaluate(`document.activeElement.textContent`),'Cancel','native modal focus cycles back');
  await evaluate(`document.querySelector('dialog button').click()`);
  getFixture().deleteReplies=['setup'];await launch();await key('Tab','Tab',9);await key('Enter','Enter',13);await waitUntil(`!!document.querySelector('dialog [role=alert]')`,'setup recovery');
  assert.equal(await evaluate(`document.querySelector('dialog button[data-variant=destructive]')===null`),true,'setup failure has no ineffective retry');
  assert.equal(await evaluate(`document.activeElement.textContent`),'Close','setup recovery focuses close');await shots('setup');
  await key('Enter','Enter',13);await waitUntil(`!document.querySelector('dialog').open`,'close setup failure');
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-haspopup')`),'dialog','close restores trigger focus');
  for(const reply of ['error','malformed','lost']) {
    getFixture().deleteReplies=[reply];await launch();await key('Tab','Tab',9);await key('Enter','Enter',13);await waitUntil(`!!document.querySelector('dialog [role=alert]')`,reply+' delete recovery');
    assert.equal(await evaluate(`location.pathname`),'/projects/detail_fixture/settings','unconfirmed deletion stays on project');
    assert.equal(await evaluate(`document.querySelector('dialog [role=alert]').textContent.includes('private provider')`),false);
    assert.equal(await evaluate(`document.querySelector('dialog button[data-variant=destructive]').disabled`),false,'retry available');assert.equal(await evaluate(`document.activeElement.textContent`),'Retry deletion','error returns focus to retry');
    await shots(reply);
    // Lost response may have deleted server-side. Retry is intentionally idempotent.
    if(reply==='lost'){await key('Enter','Enter',13);await waitUntil(`location.pathname==='/projects'`,'retry confirms lost deletion');await waitFor('Start with something worth sharing.');}
    else await evaluate(`document.querySelector('dialog button').click()`);
  }
  assert.deepEqual(commands.slice(start).filter(call=>call.startsWith('GET ')&&!call.includes('/projects')),['GET /v1/capabilities','GET /v1/drive/connection'],'only successful navigation loads account workspace');
  await navigate('/projects/detail_fixture/settings');await waitFor('This project is no longer available');
  assert.equal(await evaluate(`document.querySelector('dialog')?.open||!!document.querySelector('.project-settings-page button[aria-haspopup=dialog]')`),false,'deleted deep link has no stale project controls');
  for(const fixture of [{mode:'expired',accessExpired:true},{mode:'ready',importFailed:true},{mode:'ready',importing:true,empty:true}]) {
    await open({...fixture,deleteReplies:['held']});await launch();const before=commands.filter(call=>call==='DELETE /v1/projects/detail_fixture').length;
    await evaluate(`(()=>{const b=document.querySelector('dialog button[data-variant=destructive]');b.click();b.click()})()`);
    await waitFor('Deleting…');assert.equal(await evaluate(`document.activeElement.tagName`),'DIALOG','busy focus remains in modal');await waitUntil(`document.querySelector('dialog button').disabled`,'busy cancellation disabled');
    assert.equal(commands.filter(call=>call==='DELETE /v1/projects/detail_fixture').length,before+1,'same-frame duplicates blocked');
    await key('Tab','Tab',9);await key('Escape','Escape',27);await key('Escape','Escape',27);assert.equal(await evaluate(`document.querySelector('dialog').open`),true,'repeated busy Escape stays pending');await shots('busy');
    await waitUntil(`!!document.querySelector('dialog')`,'pending dialog');
    for(let i=0;i<120&&!getFixture().deleteRequestId;i++)await sleep(50);
    assert.ok(getFixture().deleteRequestId);
    const active=streamEvidence.filter(item=>item.path.includes('/detail_fixture/')&&!item.closed);assert.equal(active.length,0,'settings opens no operation streams');
    getFixture().deleted=true;
    await command('Fetch.fulfillRequest',{requestId:getFixture().deleteRequestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({data:{deleted:true,cleanup:'pending'}})).toString('base64')});
    await waitUntil(`location.pathname==='/projects'`,'successful deletion returns to list');await waitFor('Start with something worth sharing.');
    await waitUntil(`!document.querySelector('.project-settings-page')`,'project unmounted');
    for(let i=0;i<120&&active.some(item=>!item.closed);i++)await sleep(50);
    assert.ok(active.every(item=>item.closed),'deletion navigation closes active operation streams');
    assert.equal(await evaluate(`document.querySelectorAll('.library-list li').length`),0,'fresh list excludes deleted project');
    await command('Runtime.evaluate',{expression:'history.back()'});await sleep(200);
    assert.notEqual(await evaluate(`location.pathname`),'/projects/detail_fixture/settings','replace navigation skips deleted detail');
  }
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'project-deletion-checks.json'),JSON.stringify({confirmation:true,keyboardCancelAndTrap:true,busyDuplicateGuard:true,lostMalformedErrorRetry:true,expiredAccess:true,noSettingsObservers:true,deletedDeepLink:true,freshList:true,requests:commands.slice(start)},null,2));
  console.log('PASS: Project deletion confirmation, keyboard/focus, busy duplicate guard, safe errors/lost response retry, expired/active projects, cache/list/navigation and no settings observers.');
}
