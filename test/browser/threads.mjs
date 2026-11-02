import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function checkThreads({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands,outputs,setThreadAvailable}) {
  const start=commands.length;
  await navigate('/projects/thread_fixture');
  await waitFor('6 posts delivered');
  await evaluate(`navigator.clipboard.writeText=async text=>{window.__copied=text}`);
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);
  await click('Copy thread');
  await waitFor('Copied to clipboard.');
  assert.equal(await evaluate('window.__copied'),outputs[0].text);
  await evaluate(`document.querySelector('[aria-label="Copy post 6"]').click()`);
  await waitUntil(`window.__copied===${JSON.stringify('6/6 '+outputs[0].data.posts[5])}`,'Individual post copy uses delivered count');
  await click('Download TXT');
  for(let i=0;i<100;i++) {
    if((await readdir(join(process.env.RIFLO_SMOKE_ARTIFACTS,'downloads'))).includes('x_posts.txt')) break;
    await sleep(50);
  }
  assert.equal(await readFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'downloads','x_posts.txt'),'utf8'),outputs[0].text);
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`thread-six-${width}`);
  }
  await evaluate(`document.querySelectorAll('.output-index button')[1].click()`);
  await waitFor('1 post delivered');
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Thread posts"] li').length`),1);
  await evaluate(`document.querySelector('[aria-label="Copy post 1"]').click()`);
  await waitUntil(`window.__copied===${JSON.stringify(outputs[1].text)}`,'One delivered post uses 1/1');
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);
  await waitFor('Up to 10 credits');
  await evaluate(`document.getElementById('creation-x_posts-maxPosts').closest('details').open=true`);
  assert.equal(await evaluate(`document.getElementById('creation-x_posts-maxPosts').value`),'','Maximum inherits saved preference');
  assert.equal(await evaluate(`document.getElementById('creation-x_posts-numbering').value`),'','Numbering inherits saved preference');
  const change=async(id,value)=>evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await change('creation-x_posts-maxPosts','6');
  await waitFor('Up to 6 credits');
  await waitUntil(`document.querySelector('[aria-label="Create X post"]')?.disabled===false`,'Affordable maximum enables creation');
  await change('creation-x_posts-numbering','exclude');
  await waitFor('Numbering: Exclude (this creation)');
  assert.equal(await evaluate(`document.querySelector('.create-content-chooser').open`),true,'Customization keeps chooser open');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`thread-controls-${width}`);
  }
  setThreadAvailable(false);
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await waitFor('Threads are unavailable for this account.');
  assert.equal(await evaluate(`document.querySelector('#creation-x_posts-mode option[value="thread"]').disabled`),true,'Backend capability disables Thread');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Create X post"]')?.disabled===false`),false,'Unavailable inherited Thread cannot generate');
  await change('creation-x_posts-mode','single');
  await waitUntil(`document.querySelector('[aria-label="Create X post"]')?.disabled===false`,'Explicit Single remains available');
  const reads=commands.slice(start);
  assert.equal(reads.some(call=>['/v1/generation-defaults','/v1/brand','/v1/usage','/v1/capabilities'].some(path=>call===`GET ${path}`)),false,'Thread detail does not fetch account settings');
  assert.ok(reads.every(call=>call.startsWith('GET ')),'Viewing, copying and customization never start paid work');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'threads-checks.json'),JSON.stringify({groupedSixPosts:true,oneDeliveredPost:true,numberingUsesActualCount:true,copyIndividualExact:true,copyAllExact:true,downloadExact:true,savedChoicesInherited:true,maximumCostChanges:true,unavailableThreadBlocked:true,explicitSingleAvailable:true,accountReads:[],commands:reads},null,2));
}
