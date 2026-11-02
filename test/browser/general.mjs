import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkGeneral({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands}) {
  const evidence=[];
  const key=async key=>{const code=key==='Enter'?13:39;await command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'?{text:'\r'}:{})});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});};
  const choose=value=>evaluate(`document.querySelector('input[name=appearance][value=${value}]').click()`);
  await evaluate(`(async()=>{const{firebaseAuth}=await import('/src/shared/auth/firebase.ts');const{updateProfile,updateEmail}=await import('/node_modules/.vite/deps/firebase_auth.js');await updateProfile(firebaseAuth().currentUser,{displayName:'Studio Tester'});await updateEmail(firebaseAuth().currentUser,'studio@example.test');})()`);
  await navigate('/settings');await waitFor('Appearance');await waitFor('studio@example.test');await sleep(260);
  const requestCount=commands.length;
  assert.deepEqual(await evaluate(`(()=>{const link=document.querySelector('.settings-profile a');return {href:link.href,target:link.target,rel:link.rel,slot:link.dataset.slot,icon:!!link.querySelector('svg')}})()`),{href:'https://myaccount.google.com/',target:'_blank',rel:'noopener noreferrer',slot:'button',icon:true});
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    if(process.env.RIFLO_SMOKE_GENERAL_FOCUS_ONLY!=='1')await capture(`settings-general-${width}`);
    for(const theme of ['light','dark']) {
      await choose(theme);await sleep(300);
      const layout=await evaluate(`(()=>{const radios=[...document.querySelectorAll('.appearance-segments label')];const signout=document.querySelector('.settings-session button');return {overflow:document.documentElement.scrollWidth>innerWidth,radios:radios.map(label=>({height:label.getBoundingClientRect().height,width:label.getBoundingClientRect().width})),signout:{slot:signout.dataset.slot,height:signout.getBoundingClientRect().height,border:getComputedStyle(signout).borderTopWidth,color:getComputedStyle(signout).color,background:getComputedStyle(signout).backgroundColor},description:document.getElementById(document.querySelector('.appearance-options').getAttribute('aria-describedby'))?.textContent}})()`);
      assert.equal(layout.overflow,false);assert.equal(layout.signout.slot,'button');assert.equal(layout.signout.border,'0px');assert.ok(layout.signout.height>=44);assert.ok(layout.description);
      for(const radio of layout.radios){assert.ok(radio.height>=44);assert.ok(radio.width>=44);}
      await evaluate(`document.querySelector('input[name=appearance]:checked').focus()`);await key('ArrowRight');await sleep(300);
      const focus=await evaluate(`(()=>{const radio=document.activeElement;const style=getComputedStyle(radio.nextElementSibling);return {type:radio.type,checked:radio.checked,outline:style.outlineStyle,width:style.outlineWidth,stored:localStorage.getItem('riflo:appearance'),selected:radio.value}})()`);
      assert.equal(focus.type,'radio');assert.equal(focus.checked,true);assert.equal(focus.outline,'solid');assert.ok(parseFloat(focus.width)>=2);assert.equal(focus.stored,focus.selected);
      await choose(theme);await sleep(300);
      await evaluate(`document.querySelector('input[name=appearance]:checked').focus()`);
      assert.equal(await evaluate('document.documentElement.dataset.theme'),theme,'Focus screenshot uses its named theme');
      assert.equal(await evaluate(`document.activeElement.matches('input[name=appearance]:checked:focus-visible')`),true,'Capture visibly focuses the selected appearance');
      const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`settings-general-focus-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
      evidence.push({width,theme,layout,focus});
    }
  }
  if(process.env.RIFLO_SMOKE_GENERAL_FOCUS_ONLY==='1'){console.log('PASS: four focused General screenshots match their asserted themes.');return;}
  await choose('dark');await sleep(300);await command('Page.reload');await waitFor('Appearance');
  assert.equal(await evaluate(`document.querySelector('input[name=appearance]:checked').value`),'dark');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  await choose('system');
  for(const theme of ['light','dark']) {
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await waitUntil(`document.documentElement.dataset.theme==='${theme}'`,'System follows OS');
    assert.equal(await evaluate(`document.querySelector('input[name=appearance]:checked').value`),'system');
    assert.equal(await evaluate(`document.getAnimations().filter(animation=>animation.effect?.pseudoElement?.includes('view-transition')).length`),0);
  }
  await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  await evaluate(`document.querySelector('input[name=appearance]:checked').focus()`);await key('ArrowRight');
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.activeElement.nextElementSibling).outlineWidth)>=2`));
  await command('Emulation.setEmulatedMedia',{features:[]});
  assert.equal(commands.length,requestCount,'General appearance and account inspection make no API calls');
  // Mount the actual component with a local callback to exercise busy/error states without signing out a session.
  await evaluate(`(async()=>{const{default:React}=await import('/node_modules/.vite/deps/react.js');const{default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const{Settings}=await import('/src/shared/ui/Settings.tsx');const host=document.createElement('div');document.body.append(host);host.id='general-mock';window.__generalRoot=createRoot(host);window.__logoutCalls=0;window.__renderGeneral=(busy,error)=>window.__generalRoot.render(React.createElement(Settings,{identity:'Studio Tester',email:'studio@example.test',preview:false,busy,error,logout:async()=>{window.__logoutCalls++}}));window.__renderGeneral(false);})()`);
  await waitUntil(`document.querySelectorAll('.settings-session button').length===2`,'mock General mounted');
  await evaluate(`document.querySelectorAll('.settings-session button')[1].focus()`);await key('Enter');assert.equal(await evaluate('window.__logoutCalls'),1);
  await evaluate(`window.__renderGeneral(true)`);await sleep(50);assert.equal(await evaluate(`document.querySelectorAll('.settings-session button')[1].disabled`),true);
  await evaluate(`document.querySelectorAll('.settings-session button')[1].click()`);assert.equal(await evaluate('window.__logoutCalls'),1);
  await evaluate(`window.__renderGeneral(false,'Sign out could not finish. Try again.');`);await waitFor('Sign out could not finish. Try again.');
  assert.equal(await evaluate(`document.querySelector('.settings-error').getAttribute('role')`),'alert');
  await evaluate("window.__generalRoot.unmount();document.getElementById('general-mock').remove()");
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'general-checks.json'),JSON.stringify({evidence,persisted:true,systemSubscribed:true,reducedMotion:true,forcedColors:true,accountLink:true,mockedSignout:{calls:1,busy:true,error:true},appearanceRequests:0},null,2));
  console.log('PASS: General native radio keyboard/focus, desktop/mobile light/dark layout, persistence, system subscription, reduced motion, forced colors, safe external account link, mocked sign-out/busy/error.');
}
