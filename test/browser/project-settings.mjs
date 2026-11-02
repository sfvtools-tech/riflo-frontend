import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkProjectSettings({command,evaluate,navigate,reloadDocument,waitFor,waitUntil,capture,sleep,click,commands,releaseReads,setFixture,getFixture,streamEvidence}) {
  const path='/projects/detail_fixture/settings';
  const key=async(key,code,number)=>{for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:number,...(key==='Enter'?{text:'\r'}:{})});};
  await waitUntil(`!!document.querySelector('.project-settings-page')`,'settings loading route');
  assert.equal(await evaluate(`!!document.querySelector('.project-settings-page [role=status],.project-settings-page .project-state-skeleton,.project-settings-page .skeleton')`),true,'cold load provides loading feedback');
  await capture('project-settings-loading');
  await releaseReads(['/v1/projects/detail_fixture']);
  await waitFor('A conversation worth keeping');
  await waitFor('Delete project');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.project-settings-page')).maxWidth`),'768px','compiled settings width');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.project-settings-page dl')).display`),'grid','compiled metadata layout');
  await waitFor('Transcript available.');
  assert.equal(commands.filter(call=>call==='GET /v1/projects/detail_fixture/generation/availability').length,1,'one canonical availability read');
  assert.equal(commands.filter(call=>call==='GET /v1/projects/detail_fixture').length,1,'one canonical cold project read');
  assert.equal(commands.some(call=>/\/operations\/|\/outputs$|\/generation$|\/v1\/(capabilities|usage|brand|drive\/connection)$/.test(call)),false,'settings avoids unrelated reads and observers');
  const beforeVisible=commands.length;
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`);
  for(let i=0;i<100&&commands.length===beforeVisible;i++)await sleep(20);
  await sleep(200);
  assert.deepEqual(commands.slice(beforeVisible),['GET /v1/projects/detail_fixture/generation/availability'],'visibility refresh reads availability once without project or observers');
  await evaluate(`delete document.hidden`);
  for(const theme of ['light','dark']) {
    await evaluate(`document.documentElement.dataset.theme='${theme}'`);
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);
      await sleep(200);await capture(`project-settings-${theme}-${width}`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'settings fits viewport');
      assert.equal(await evaluate(`document.querySelector('.project-settings-page h1').textContent`),'Project settings');
    }
  }
  const original=await evaluate(`(()=>{const a=document.querySelector('.project-settings-page a[target="_blank"]');return a&&{href:a.href,rel:a.rel}})()`);
  assert.equal(original.href,'https://drive.google.com/file/d/test_video/view');assert.match(original.rel,/noopener/);
  await evaluate(`document.querySelector('.project-settings-page .back-link').click()`);
  await waitFor('Saved content');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`project-settings-main-${width}`);
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('a[aria-label="Project settings"]').getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth})()`),true,'gear is accessible and fits title');
  }
  assert.equal(await evaluate(`location.pathname`),'/projects/detail_fixture');
  assert.equal(await evaluate(`!!document.querySelector('.project-source-details,.source-original-link,.project-workspace-page button[aria-haspopup=dialog]')`),false,'source metadata and deletion left main project');
  await evaluate(`document.querySelector('a[aria-label="Project settings"]').focus()`);
  await key('Enter','Enter',13);await waitFor('Delete project');
  assert.equal(await evaluate(`location.pathname`),path,'gear supports native keyboard navigation');
  assert.equal(await evaluate(`document.querySelector('nav a[aria-current=page]')?.textContent.trim()`),'Projects');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await reloadDocument();await waitFor('Delete project');await capture('project-settings-reduced-motion');
  getFixture().availabilityBroken=true;await reloadDocument();await waitFor('Availability could not be checked.');
  assert.equal(await evaluate(`!!document.querySelector('button[aria-haspopup=dialog]')`),true,'availability failure preserves settings controls');
  getFixture().availabilityBroken=false;await click('Retry availability');await waitFor('Transcript available.');
  getFixture().projectBroken=true;await reloadDocument();await waitUntil(`!!document.querySelector('.project-settings-page [role=alert]')`,'load failure');
  await capture('project-settings-error');
  getFixture().projectBroken=false;
  await evaluate(`document.querySelector('.project-settings-page [role=alert] button').click()`);await waitFor('Delete project');
  getFixture().deleted=true;await reloadDocument();await waitFor('This project is no longer available.');
  assert.equal(await evaluate(`!!document.querySelector('.project-settings-page button[aria-haspopup=dialog]')`),false,'unavailable project has no deletion');await capture('project-settings-not-found');
  setFixture({mode:'ready',importing:true,empty:true});await navigate('/projects/detail_fixture');await waitFor('Video import');
  await waitUntil(`!!document.querySelector('a[aria-label="Project settings"]')`,'active project gear');
  const active=streamEvidence.filter(item=>item.path.includes('/detail_fixture/')&&!item.closed);
  assert.ok(active.length>0,'main owns active import stream');
  await evaluate(`document.querySelector('a[aria-label="Project settings"]').click()`);await waitFor('Delete project');
  for(let i=0;i<120&&active.some(item=>!item.closed);i++)await sleep(50);
  assert.ok(active.every(item=>item.closed),'leaving main closes import observer');
  const steady=commands.length;await sleep(1200);assert.equal(commands.length,steady,'settings does not poll');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'project-settings-checks.json'),JSON.stringify({directAuthLoad:true,loadingErrorRetryNotFound:true,nativeKeyboard:true,metadataMoved:true,responsiveThemes:true,observerCleanup:true,visibilityRefreshAvailabilityOnly:true,requests:commands},null,2));
  console.log('PASS: Project settings direct load/auth, keyboard/back navigation, metadata, loading/error/retry/not-found, responsive themes and finite request boundary.');
}
