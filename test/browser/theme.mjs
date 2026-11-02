import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkTheme({command,evaluate,navigate,waitFor,waitUntil,capture,signedOut=false}) {
  await command('Page.enable');
  const evidence=[];
  const surfaces=[];
  const captureSidebar=async name=>{
    await new Promise(resolve=>setTimeout(resolve,300));
    const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`${name}.png`),Buffer.from(screenshot.data,'base64'));
  };
  const auditSurfaces=async(view,theme)=>{
    // Screenshot helpers can visit both modes; resolve the requested audit mode again.
    await choose(theme);
    await waitUntil(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`,'surface audit appearance');
    const resolvedTheme=await evaluate('document.documentElement.dataset.theme');
    // CSS color-mix can serialize as oklab: let the browser convert to sRGB bytes.
    const rows=await evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');return Array.from(document.querySelectorAll('html,body,#root,.workspace,.sidebar,.page,.signin-story,.signin-form,.stack-card,.project-card,.project-art,.import-sheet,.import-intro,.source-choice label,.content-panel,.source-placeholder,.source-band-icon,.generation-confirm,.output-paper,.output-index [aria-pressed="true"],.sample-art,.sample-clip,.account-panel,.connection-mark,.preview-bar,input,select')).map(el=>{const background=getComputedStyle(el).backgroundColor;context.clearRect(0,0,1,1);context.fillStyle=background;context.fillRect(0,0,1,1);return {selector:el.className||el.tagName,background,rgba:Array.from(context.getImageData(0,0,1,1).data)}})})()`);
    for(const row of rows) {
      const channels=row.rgba.slice(0,3);
      assert.ok(Math.max(...channels)-Math.min(...channels)<=1,`${view}/${theme}/${row.selector}: neutral sRGB surface`);
    }
    surfaces.push({view,theme:resolvedTheme,rows});
  };
  const choose=async value=>{
    const back = await evaluate('location.pathname+location.search');
    if(!await evaluate('Boolean(document.querySelector("input[name=appearance], [aria-label=Appearance]"))')) {
      await evaluate('document.querySelector(".settings-trigger").click()');
      await waitUntil('Boolean(document.querySelector("input[name=appearance]"))','settings appearance');
    }
    await evaluate(`(()=>{const radio=document.querySelector('input[name=appearance][value="'+${JSON.stringify(value)}+'"]');if(radio){radio.click();return;}const select=document.querySelector('[aria-label="Appearance"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    if(back!==await evaluate('location.pathname+location.search')) { await command('Page.navigate',{url:'http://127.0.0.1:5188'+back});await waitUntil('Boolean(document.querySelector(".sidebar"))','return from settings'); }
    await waitUntil(`document.documentElement.dataset.appearance===${JSON.stringify(value)}`,'appearance updated');
  };
  const media=async theme=>command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
  await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');
  await command('Page.bringToFront');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  // Settings is a page; native radios retain their arrow-key behavior.
  await evaluate('document.querySelector(".settings-trigger").focus()');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await waitUntil('location.pathname==="/settings" && Boolean(document.querySelector("input[name=appearance]"))',"settings route");
  assert.equal(await evaluate('document.activeElement.id'),"main");
  await evaluate('document.querySelector("input[name=appearance][value=system]").focus()');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await waitUntil('document.documentElement.dataset.appearance === "light"','radio arrow applies preference');
  await captureSidebar('refined-settings-keyboard');
  await choose('system');await media('dark');
  await waitUntil(`document.documentElement.dataset.theme==='dark'`,'system dark');
  await media('light');await waitUntil(`document.documentElement.dataset.theme==='light'`,'system light');
  for(const theme of ['light','dark']) {
    await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');
    await choose(theme);await media(theme==='dark'?'light':'dark');
    assert.equal(await evaluate('document.documentElement.dataset.theme'),theme,'explicit appearance overrides OS');
    const startupProbe=await command('Page.addScriptToEvaluateOnNewDocument',{source:`new MutationObserver(()=>{if(document.querySelector('script[src="/src/main.tsx"]')&&!window.__themeBeforeApp)window.__themeBeforeApp={theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,rootEmpty:!document.querySelector('#root')?.firstChild}}).observe(document,{subtree:true,childList:true});`});
    await command('Page.reload');try { await waitUntil('Boolean(window.__themeBeforeApp)','head theme probe'); } catch (error) {
      await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'theme-probe-timeout.json'),JSON.stringify(await evaluate(`({url:location.href,readyState:document.readyState,scripts:Array.from(document.scripts,s=>s.src),theme:document.documentElement.dataset.theme,appearance:document.documentElement.dataset.appearance,probe:window.__themeBeforeApp,root:document.querySelector('#root')?.childElementCount})`),null,2));
      throw error;
    }await waitFor('Illustrative content · No video processed.');
    assert.deepEqual(await evaluate('window.__themeBeforeApp'),{theme,scheme:theme,rootEmpty:true},'theme resolves in head before application render');
    await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:startupProbe.identifier});
    assert.equal(await evaluate('document.documentElement.dataset.theme'),theme,'preference persists');
    await evaluate('document.querySelector(".settings-trigger").click()');await waitUntil('Boolean(document.querySelector("input[name=appearance]"))','appearance loaded');
    const values=await evaluate(`(()=>{const root=getComputedStyle(document.documentElement),select=getComputedStyle(document.querySelector('.appearance-segments input:checked + span') || document.querySelector('[aria-label="Appearance"]'));return {scheme:root.colorScheme,canvas:getComputedStyle(document.body).backgroundColor,select:select.backgroundColor,border:select.borderTopColor,selection:getComputedStyle(document.body,'::selection').backgroundColor,animation:getComputedStyle(document.querySelector('.page')).animationName,primary:root.getPropertyValue('--primary').trim()}})()`);
    assert.equal(values.scheme,theme);
    assert.equal(values.canvas,theme==='dark'?'rgb(22, 22, 22)':'rgb(236, 236, 236)');
    assert.equal(values.select,theme==='dark'?'rgb(36, 36, 36)':'rgb(255, 255, 255)');
    assert.equal(values.selection,theme==='dark'?'rgb(56, 56, 56)':'rgb(216, 216, 216)');
    assert.equal(values.animation,'none');
    await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');
    assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.output-copy')).fontSize)>=16`),'reader text remains readable');
    assert.equal(await evaluate(`document.querySelectorAll('.output-index [aria-pressed="true"]').length`),1,'one saved output remains selected');
    assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.project-title')).fontSize)<=30`));
    evidence.push({theme,...values,startup:await evaluate('window.__themeBeforeApp')});
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await evaluate('document.querySelector(".settings-trigger").click()');await waitUntil('Boolean(document.querySelector("input[name=appearance]"))','appearance focus');
    await evaluate('document.querySelector(".appearance-segments input:checked").focus()');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.appearance-segments input:checked + span') || document.querySelector('[aria-label="Appearance"]')).outlineStyle`),'solid');
    if(await evaluate('Boolean(document.querySelector("option"))')) assert.equal(await evaluate(`getComputedStyle(document.querySelector('option')).backgroundColor`),values.select);
    await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('a'),'::selection').backgroundColor`),values.selection);
    // Exercise the shared input rules independently of account/provider availability.
    await evaluate(`(()=>{const input=document.createElement('input');input.id='theme-native-check';input.className='link-field';input.placeholder='Video link';document.body.append(input)})()`);
    await command('DOM.enable');
    const doc=await command('DOM.getDocument');
    const node=await command('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#theme-native-check'});
    await command('CSS.enable');
    await command('CSS.forcePseudoState',{nodeId:node.nodeId,forcedPseudoClasses:['autofill']});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#theme-native-check')).webkitTextFillColor`),theme==='dark'?'rgb(245, 245, 245)':'rgb(38, 38, 38)');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#theme-native-check'),'::placeholder').opacity`),'1');
    await evaluate(`document.querySelector('#theme-native-check').remove()`);
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      await capture(`theme-${theme}-results-${width}`);
      await auditSurfaces(`results-${width}`,theme);
    }
    // Keep primary navigation available on narrow screens and short desktop windows.
    for (const [width,height] of [[320,700],[375,700],[768,700],[1440,900],[1440,450],[768,400],[375,400]]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=375});
      await evaluate('window.scrollTo(0,0)');
      await captureSidebar(`sidebar-${theme}-${width}x${height}`);
      if(width>900) {
        const positions=await evaluate(`(()=>{const x=s=>document.querySelector(s).getBoundingClientRect().left;return {brand:x('.brand svg'),nav:x('.sidebar nav a svg'),avatar:x('.sidebar-bottom .avatar')}})()`);
        assert.ok(Math.max(...Object.values(positions))-Math.min(...Object.values(positions))<=1,'rail content shares left alignment');
      }
      if(width===375) {
        await evaluate('document.querySelector(".settings-trigger").click()');
        await waitUntil('Boolean(document.querySelector(".settings-page"))','settings fits');
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'mobile settings fits');
        await captureSidebar(`refined-settings-${theme}-mobile`);
        await navigate('/projects/sample?preview=true&state=partial');await waitFor('Illustrative content · No video processed.');
      }

      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'sidebar does not cause horizontal overflow');
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.sidebar nav a')).every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44})`),true,'navigation fits and retains touch targets');
      if (width>760) assert.equal(await evaluate(`document.querySelector('.sidebar-bottom').getBoundingClientRect().bottom<=innerHeight`),true,'account stays inside short viewport');
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');
      await new Promise(resolve=>setTimeout(resolve,80));
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.sidebar nav a')).every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})`),true,'navigation stays available while scrolling');
      await evaluate(`document.querySelector('.sidebar nav a[aria-current]').focus()`);
      assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`),'solid','keyboard focus remains visible');
      await captureSidebar(`sidebar-${theme}-${width}x${height}-scrolled-focus`);
    }
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    await navigate('/projects?preview=true&state=empty');await waitUntil('Boolean(document.querySelector(".settings-trigger"))','settings link');
    await capture(`theme-${theme}-empty`);
    await auditSurfaces('projects',theme);
    for(const route of ['usage','connections']) {
      await navigate(`/${route}?preview=true`);await waitUntil('Boolean(document.querySelector(".settings-trigger"))','settings link');await auditSurfaces(route,theme);
    }
  }
  if (!signedOut) {
    await navigate('/settings');await waitFor('Sign out');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Sign out').click()`);
  } else { await navigate('/'); }
  await waitFor('Make room for');
  if(!signedOut) await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'settings-logout-check.json'),JSON.stringify({logoutClickedInSettings:true,signedOutScreenReached:true},null,2));
  // Head script must resolve before application modules execute, even if storage throws.
  const blocked=await command('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('blocked','SecurityError')}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('blocked','SecurityError')}});`});
  await media('dark');await navigate('/');await waitFor('Make room for');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  await choose('light');assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  await capture('theme-storage-unavailable-signin');
  await auditSurfaces('signin','light');
  await choose('dark');await auditSurfaces('signin','dark');
  await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:blocked.identifier});
  await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  assert.equal(await evaluate('getComputedStyle(document.querySelector("select")).forcedColorAdjust'),'auto');
  await command('Emulation.setEmulatedMedia',{features:[]});
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'theme-checks.json'),JSON.stringify({checks:evidence,nativePopup:'Option computed styles and color-scheme verified; OS popup/highlight rendering is browser-controlled.',autofill:'CDP forced :autofill verifies text fill; saved credential interaction is not exercised.'},null,2));
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'surface-checks.json'),JSON.stringify(surfaces,null,2));
}
