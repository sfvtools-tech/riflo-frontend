import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkSignIn({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands}) {
  const evidence=[];
  const choose=value=>evaluate(`(()=>{const select=document.querySelector('[aria-label=Appearance]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const key=async key=>{const code={Enter:13,Tab:9,ArrowDown:40}[key];for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})});};
  for(const path of ['/','/signin']) {
    await navigate(path);await waitFor('Continue with Google');
    assert.equal(await evaluate(`!!document.querySelector('.signin .google-button[data-slot=button]')`),true,'Real authentication UI on both routes');
  }
  await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:width===375?812:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`signin-migrated-${width}`);
    for(const theme of ['light','dark']) {
      await choose(theme);await sleep(300);
      await evaluate(`document.querySelector('.google-button').focus()`);await key('Tab');
      assert.equal(await evaluate(`document.activeElement.getAttribute('href')`),'/projects?preview=true','Native keyboard navigation reaches preview');
      await evaluate(`document.querySelector('.google-button').focus()`);
      const audit=await evaluate(`(()=>{const button=document.querySelector('.google-button'),select=document.querySelector('[aria-label=Appearance]'),preview=document.querySelector('a[href="/projects?preview=true"]');return {theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth,button:{slot:button.dataset.slot,height:button.getBoundingClientRect().height,font:getComputedStyle(button).fontFamily,focus:getComputedStyle(button).boxShadow,description:document.getElementById(button.getAttribute('aria-describedby'))?.textContent},select:{slot:select.dataset.slot,height:select.getBoundingClientRect().height,fontSize:getComputedStyle(select).fontSize,arrows:document.querySelectorAll('[data-slot=native-select-icon]').length},preview:preview.dataset.slot}})()`);
      assert.equal(audit.theme,theme);assert.equal(audit.overflow,false);assert.equal(audit.preview,'button');assert.equal(audit.select.slot,'native-select');assert.equal(audit.select.arrows,1);assert.ok(audit.select.height>=44);assert.ok(audit.button.height>=44);assert.ok(audit.button.font.includes('Inter'));assert.ok(audit.button.description);assert.notEqual(audit.button.focus,'none');if(width===375)assert.equal(audit.select.fontSize,'16px');
      evidence.push({width,theme,...audit});
      const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`signin-focus-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  await choose('dark');await command('Page.reload');await waitFor('Continue with Google');await evaluate(`document.querySelector('.firebase-emulator-warning')?.remove()`);assert.equal(await evaluate(`document.querySelector('[aria-label=Appearance]').value`),'dark');
  await choose('system');
  for(const theme of ['light','dark']) {
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});await waitUntil(`document.documentElement.dataset.theme==='${theme}'`,'System follows device');
    assert.equal(await evaluate(`document.querySelector('[aria-label=Appearance]').value`),'system');assert.equal(await evaluate(`document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes('view-transition')).length`),0);
  }
  await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await evaluate(`document.querySelector('.google-button').focus()`);assert.ok(await evaluate(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
  await command('Emulation.setEmulatedMedia',{features:[]});
  // Import the real component through Vite; only its session hook is replaced in this test-only module.
  await evaluate(String.raw`(async()=>{const source=await(await fetch('/src/features/signin/SignIn.tsx')).text();const code=source.replace(/import \{ useSession \} from [^;]+;/,'const useSession=()=>window.__signinSession;').replace(/from "\//g,'from "'+location.origin+'/');const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const{SignIn}=await import(url);URL.revokeObjectURL(url);const{default:React}=await import('/node_modules/.vite/deps/react.js');const{default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');document.getElementById('root').style.display='none';const host=document.createElement('div');host.id='signin-mock';document.body.prepend(host);window.__signinRoot=createRoot(host);window.__loginCalls=0;window.__renderSignin=(busy=false,error='',configured=true)=>{window.__signinSession={busy,error,configured,login:async()=>{window.__loginCalls++}};window.__signinRoot.render(React.createElement(SignIn))};window.__renderSignin();})()`);
  await waitUntil(`!!document.querySelector('#signin-mock .google-button')`,'real SignIn fixture mounted');
  await evaluate(`document.querySelector('.google-button').focus()`);await key('Enter');assert.equal(await evaluate('window.__loginCalls'),1);
  await evaluate(`window.__renderSignin(true)`);await waitFor('Opening Google…');
  assert.equal(await evaluate(`document.querySelector('.google-button').disabled&&document.querySelector('.google-button').getAttribute('aria-busy')==='true'`),true);
  await evaluate(`document.querySelector('.google-button').click()`);assert.equal(await evaluate('window.__loginCalls'),1);
  for(const width of [375,1440]) {await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`signin-busy-${width}`);}
  await evaluate(`window.__renderSignin(false,'Sign-in did not finish. Allow the Google popup and try again.')`);await waitFor('Sign-in did not finish.');
  assert.equal(await evaluate(`document.querySelector('#signin-status').getAttribute('role')`),'alert');assert.equal(await evaluate(`document.querySelector('.google-button').disabled`),false);
  for(const width of [375,1440]) {await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`signin-error-migrated-${width}`);}
  await evaluate(`window.__renderSignin(false,'Sign-in is not configured.',false)`);await waitFor('Sign-in is not configured.');assert.equal(await evaluate(`document.querySelector('.google-button').disabled`),true);
  await evaluate(`document.querySelector('a[href="/projects?preview=true"]').click()`);await waitFor('Preview');assert.ok(await evaluate(`location.search.includes('preview=true')`));
  assert.equal(commands.length,0,'Sign-in appearance/auth fixture makes no business API requests');
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'signin-checks.json'),JSON.stringify({evidence,routes:['/','/signin'],persisted:true,systemSubscribed:true,reducedMotion:true,forcedColors:true,keyboard:true,actualSignInMockSession:{busy:true,error:true,unconfigured:true,calls:1},preview:true},null,2));
  console.log('PASS: real SignIn routes, native select, keyboard/focus, desktop/mobile light/dark, persistence/system/reduced motion/forced colors, real SignIn mocked session busy/error/unconfigured, preview link.');
}
