import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkWritingBrand({command,evaluate,navigate,waitFor,waitUntil,capture,sleep,commands,brandCalls,holdReads,releaseReads,getHeldReadCount,setProfile,setSaveFailure,setReadFailure,setRegression,getRegressionCalls}) {
  const edit = async (id, value) => evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const click = async text => evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes(${JSON.stringify(text)})).click()`);
  const localLink = path => `document.querySelector('.settings-nav a[href="${path}"]')`;
  const currentSection = async path => assert.equal(await evaluate(`${localLink(path)}?.getAttribute('aria-current')`),'page');
  const settingsIdentity = () => evaluate(`window.__settingsNodes.every(([selector,node])=>document.querySelector(selector)===node)`);
  const noPageMotion = async () => assert.equal(await evaluate(`window.__settingsMotion.some(target=>target==='main'||target==='settings-header'||target==='settings-nav'||target==='sidebar')`),false,'Settings changes do not replay page or shell entrances');
  const waitForHeldRead = async () => {
    for(let attempt=0;attempt<120;attempt++) { if(getHeldReadCount())return;await sleep(50); }
    throw Error('Settings refresh never reached its held fixture');
  };
  const checkSettingsLayout = async width => {
    const layout = await evaluate(`(()=>{const nav=document.querySelector('.settings-nav').getBoundingClientRect(),content=document.querySelector('.settings-content').getBoundingClientRect(),title=document.querySelector('.settings-header h1').getBoundingClientRect();return {nav:{left:nav.left,right:nav.right,top:nav.top,bottom:nav.bottom},content:{left:content.left,right:content.right,top:content.top},title:{left:title.left,top:title.top,bottom:title.bottom},links:Array.from(document.querySelectorAll('.settings-nav a')).map(link=>{const rect=link.getBoundingClientRect();return {top:rect.top,left:rect.left,right:rect.right}}),surfaces:Array.from(document.querySelectorAll('.settings-layout,.settings-content,.settings-section-group,.brand-form-body,.brand-loading')).map(element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,border:style.borderTopWidth,shadow:style.boxShadow}})}})()`);
    assert.ok(layout.title.bottom<=layout.nav.top,'Settings title sits above its local navigation');
    assert.ok(layout.title.top<240,`Settings title stays near the top (${width}px: ${layout.title.top})`);
    assert.ok(layout.nav.bottom<=layout.content.top,'Settings navigation sits above content at every width');
    assert.equal(layout.links[0].top,layout.links[1].top,'General and Brand share one horizontal row');
    assert.ok(layout.links[0].right<layout.links[1].left,'General precedes Brand horizontally');
    assert.equal(layout.title.left,layout.nav.left,'Navigation aligns with the Settings title');
    assert.equal(layout.content.left,layout.nav.left,'Content starts at the same left edge as navigation');
    assert.equal(layout.content.right,layout.nav.right,'Settings navigation and content use one common width');
    for(const surface of layout.surfaces) {
      assert.ok(['transparent','rgba(0, 0, 0, 0)'].includes(surface.background),'Settings content breathes directly on the page background');
      assert.equal(surface.border,'0px','Settings sections have no enclosing card border');
      assert.equal(surface.shadow,'none','Settings sections have no enclosing card shadow');
    }
  };
  const checkBrandComposition = async width => {
    const composition = await evaluate(`(()=>{const audience=document.getElementById('brand-audience'),voice=document.getElementById('brand-voice'),sample=document.getElementById('brand-writingExample'),heading=document.querySelector('.brand-section h3'),label=document.querySelector('label[for=brand-audience]'),suggestions=document.querySelector('.brand-voice-suggestions'),footer=document.querySelector('.brand-save-row'),save=footer.querySelector('[type=submit]'),clear=footer.querySelector('.brand-reset'),notice=footer.querySelector('.brand-save-notice');const rect=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};return {headingSize:parseFloat(getComputedStyle(heading).fontSize),labelSize:parseFloat(getComputedStyle(label).fontSize),audience:rect(audience),voice:rect(voice),sample:rect(sample),suggestions:rect(suggestions),suggestionMargin:parseFloat(getComputedStyle(suggestions).marginTop),save:rect(save),clear:rect(clear),notice:rect(notice)}})()`);
    assert.ok(composition.headingSize>composition.labelSize,'Section headings are distinct from field labels');
    assert.ok(composition.sample.height>composition.audience.height&&composition.sample.height>composition.voice.height,'Short answers use compact editors while the writing sample has more room');
    assert.ok(composition.suggestionMargin>=0&&composition.suggestions.top>=composition.voice.bottom,'Writing suggestions follow the control in normal flow');
    if(width===375) {
      assert.ok(composition.save.bottom<=composition.clear.top,'Mobile save is followed by one subordinate action row');
      assert.ok(composition.clear.top<composition.notice.bottom&&composition.notice.top<composition.clear.bottom,'Mobile clear and status share one action row');
    }
  };
  const checkNativeFields = async (prefix, width) => {
    const fields = await evaluate(`Array.from(document.querySelectorAll('[id^="${prefix}-"]')).filter(element=>['INPUT','TEXTAREA','SELECT'].includes(element.tagName)).map(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return {id:element.id,tag:element.tagName,slot:element.dataset.slot,field:!!element.closest('[data-slot="field"]'),labels:Array.from(element.labels||[],label=>({text:label.textContent.trim(),slot:label.dataset.slot})),descriptions:(element.getAttribute('aria-describedby')||'').split(' ').filter(Boolean).map(id=>({id,exists:!!document.getElementById(id),text:document.getElementById(id)?.textContent.trim()})),height:rect.height,width:rect.width,fontSize:parseFloat(style.fontSize),fontFamily:style.fontFamily,borderStyle:style.borderTopStyle,appearance:style.appearance}})`);
    assert.ok(fields.length>=2,'Native form controls are available');
    for(const field of fields) {
      // Creation migrates the shared language controls; its audience/voice editors stay native legacy fields.
      if(prefix==='creation'&&!['creation-language','creation-spelling'].includes(field.id))continue;
      assert.equal(field.slot,field.tag==='SELECT'?'native-select':field.tag.toLowerCase(),`${field.id}: shadcn preserves the native control`);
      assert.ok(field.fontFamily.includes('Inter'),`${field.id}: retains the product font`);
      assert.equal(field.borderStyle,'solid',`${field.id}: visible border without Preflight`);
      if(field.tag==='SELECT')assert.equal(field.appearance,'none','Native select uses one source-owned arrow');
      assert.equal(field.field,true,`${field.id}: grouped in a Field`);
      assert.equal(field.labels.length,1,`${field.id}: one associated visible label`);
      assert.ok(field.labels[0].text.length>0,`${field.id}: accessible label has text`);
      assert.equal(field.labels[0].slot,'field-label');
      assert.ok(field.height>=44&&field.width>=44,`${field.id}: minimum touch dimensions`);
      if(width===375)assert.ok(field.fontSize>=16,`${field.id}: mobile text avoids input zoom`);
      for(const description of field.descriptions)assert.ok(description.exists&&description.text,`${field.id}: description resolves to visible text`);
    }
    const contrast = await evaluate(`(()=>{const luminance=color=>{const [r,g,b]=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};return Array.from(document.querySelectorAll('[data-slot="field"] :is(input,textarea,select,label,[data-slot="field-description"])')).map(element=>{let surface=element;while(surface&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;const ink=luminance(getComputedStyle(element).color),paper=luminance(getComputedStyle(surface||document.body).backgroundColor);return {id:element.id||element.textContent.trim(),color:getComputedStyle(element).color,background:getComputedStyle(surface||document.body).backgroundColor,ratio:(Math.max(ink,paper)+.05)/(Math.min(ink,paper)+.05)}})})()`);
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`shadcn-contrast-${prefix}-${width}.json`),JSON.stringify(contrast,null,2));
    for(const row of contrast)assert.ok(row.ratio>=4.5,`${row.id}: text contrast ${row.ratio.toFixed(2)}`);
    const theme=await evaluate('document.documentElement.dataset.theme');
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`shadcn-fields-${prefix}-${theme}-${width}.json`),JSON.stringify({fields,contrast},null,2));
    return fields;
  };
  const checkBrandFocus = async () => {
    const evidence=[];
    const requests=commands.length;
    const pointer = async selector => {
      const {x,y}=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    };
    for(const width of [375,1440]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
      for(const theme of ['light','dark']) {
        await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(theme)};localStorage.setItem('riflo:appearance',${JSON.stringify(theme)});window.dispatchEvent(new Event('riflo:appearance'))`);
        await waitUntil(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`,'Brand focus appearance applied');
        await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve)).then(()=>Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.pseudoElement?.includes('view-transition')).map(animation=>animation.finished)))`);
        await checkNativeFields('brand',width);
        await pointer('label[for=brand-audience]');
        assert.equal(await evaluate(`document.activeElement.id`),'brand-audience','Clicking a field label focuses its associated editor');
        await pointer('#brand-writing-heading');
        assert.notEqual(await evaluate(`document.activeElement.id`),'brand-audience','Section headings are separate from field labels');
        for(const [name,selector,previous] of [
          ['textarea','#brand-audience',null],['input','#brand-name','#brand-avoid'],
          ['select','#brand-language','.brand-voice-suggestions button:last-child'],
          ['suggestion','.brand-voice-suggestions button:first-of-type','#brand-voice'],
          ['save','.brand-save-row [type=submit]','#brand-description'],
        ]) {
          const bounds=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {width:r.width,height:r.height}})()`);
          if(previous) {
            await evaluate(`document.querySelector(${JSON.stringify(previous)}).focus()`);
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
            await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          } else await pointer('label[for=brand-audience]');
          await evaluate(`Promise.allSettled(document.querySelector(${JSON.stringify(selector)}).getAnimations().map(animation=>animation.finished))`);
          const state=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),style=getComputedStyle(element),r=element.getBoundingClientRect();return {active:document.activeElement===element,visible:element.matches(':focus-visible'),outline:style.outline,outlineStyle:style.outlineStyle,offset:style.outlineOffset,border:style.borderColor,shadow:style.boxShadow,background:getComputedStyle(document.body).backgroundColor,outlineColor:style.outlineColor,outlineWidth:style.outlineWidth,width:r.width,height:r.height,theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
          assert.equal(state.active,true,`${name} receives native focus`);
          assert.equal(state.visible,true,`${name} has a visible keyboard/text-editor focus state`);
          assert.equal(state.overflow,false);
          assert.equal(state.width,bounds.width,'Focusing preserves control width');
          assert.equal(state.height,bounds.height,'Focusing preserves control height');
          await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`shadcn-focus-state-${name}-${theme}-${width}.json`),JSON.stringify(state,null,2));
          const visibleOutline=state.outlineStyle!=='none'&&state.outlineColor!=='rgba(0, 0, 0, 0)'&&parseFloat(state.outlineWidth)>0;
          const visibleShadow=/ 0px 0px 0px [1-9][0-9]*px/.test(state.shadow);
          assert.ok(visibleOutline||visibleShadow,`${name}: visible focus indicator`);
          assert.equal(visibleOutline&&visibleShadow,false,`${name}: focus uses one indicator without duplicate rings`);
          if(visibleOutline)assert.ok(parseFloat(state.outlineWidth)<=2&&parseFloat(state.offset)<=2,'Actions keep a compact focus ring');
          if(['textarea','input','select'].includes(name)) {
            assert.equal(visibleOutline,false,'Fields keep a contiguous focused border');
            assert.ok(/ 0px 0px 0px [123]px/.test(state.shadow),'Fields use a tight, unblurred border extension');
          }
          const luminance=color=>{const [r,g,b]=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
          const a=luminance(['textarea','input','select'].includes(name)?state.border:state.outlineColor),b=luminance(state.background);
          state.focusContrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          assert.ok(state.focusContrast>=3,'Focus indicator contrasts with the adjacent page surface');
          const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,`brand-focus-${name}-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
          evidence.push({name,viewport:width,...state});
        }
      }
    }
    await command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
    await pointer('label[for=brand-audience]');
    const forced=await evaluate(`(()=>{const style=getComputedStyle(document.activeElement);return {active:document.activeElement.id,outline:style.outlineColor,width:style.outlineWidth,shadow:style.boxShadow}})()`);
    assert.equal(forced.active,'brand-audience');assert.ok(parseFloat(forced.width)>=2);assert.notEqual(forced.outline,'rgba(0, 0, 0, 0)');
    const forcedShot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'brand-focus-forced-colors.png'),Buffer.from(forcedShot.data,'base64'));
    evidence.push({forcedColors:forced});
    await command('Emulation.setEmulatedMedia',{features:[]});
    assert.equal(commands.length,requests,'Focus and label interactions do not send API requests');
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'brand-focus-checks.json'),JSON.stringify(evidence,null,2));
  };
  const confirmChoice = async (accept, action) => {
    await evaluate(`window.__originalConfirm=window.confirm;window.__confirmText='';window.confirm=message=>{window.__confirmText=message;return ${accept}}`);
    try { await action(); } finally { await evaluate('window.confirm=window.__originalConfirm'); }
    assert.ok(await evaluate('window.__confirmText.length>0'),'The destructive/leave action requires confirmation');
  };
  await navigate('/settings'); await waitFor('Appearance');
  await sleep(260);
  await evaluate(`(()=>{window.__settingsMotion=[];window.__settingsNodes=['.settings-page','.settings-header','.settings-nav','.settings-content','.sidebar'].map(selector=>[selector,document.querySelector(selector)]);const animate=Element.prototype.animate;Element.prototype.animate=function(...args){window.__settingsMotion.push(this.id||this.className||this.tagName);return animate.apply(this,args)}})()`);
  const themeRequests = commands.length;
  await evaluate(`document.querySelector('input[name=appearance][value=light]').click()`);await sleep(260);
  assert.equal(await settingsIdentity(),true,'Theme changes preserve the Settings shell');
  assert.equal(commands.length,themeRequests,'Appearance changes do not fetch page data');
  await noPageMotion();
  await currentSection('/settings');
  assert.equal(await evaluate(`document.querySelectorAll('.settings-nav a').length`),2);
  assert.equal(await evaluate(`document.querySelector('.settings-session button').textContent`),'Sign out');
  assert.equal(await evaluate(`document.querySelector('.settings-profile a').getAttribute('rel')`),'noopener noreferrer');
  for (const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await capture(`settings-general-${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await checkSettingsLayout(width);
  }
  holdReads.add('/v1/brand');
  await evaluate(`window.__settingsRail=document.querySelector('.sidebar');window.__settingsMotion=[];${localLink('/settings/brand')}.click()`);
  await waitForHeldRead();
  assert.equal(await evaluate(`Boolean(document.querySelector('.brand-loading'))`),true,'First Brand visit shows a local cold-loading state');
  assert.equal(await settingsIdentity(),true,'Switching sections preserves the Settings title, navigation and content container');
  await noPageMotion();
  await releaseReads();await waitFor('Who is your content for?');
  await currentSection('/settings/brand');
  assert.equal(await evaluate(`window.__settingsRail===document.querySelector('.sidebar')`),true,'Switching settings sections preserves the studio shell');
  assert.equal(await evaluate(`document.querySelectorAll('.brand-settings details').length`),0,'Brand preferences use visible sections');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.brand-section > h3')).map(heading=>heading.textContent)`),['Writing preferences','Writing references','Brand context']);
  assert.equal(await evaluate(`document.querySelector('.brand-settings').textContent.includes('Optional defaults for future written content.')`),false,'Brand has no redundant introductory copy');
  for(const id of ['brand-audience','brand-voice','brand-writingExample','brand-avoid','brand-name','brand-description']) {
    assert.equal(await evaluate(`document.getElementById('${id}').checkVisibility()`),true,`${id} is available without expanding a section`);
  }

  assert.equal(await evaluate(`document.querySelector('button[type=submit]').disabled`),true);
  const editRequests = commands.length;
  await evaluate('window.__settingsMotion=[]');
  await edit('brand-audience','Independent teachers');
  await evaluate(`Array.from(document.querySelectorAll('.brand-voice-suggestions button')).find(button=>button.textContent.includes('Clear')).click()`);
  assert.ok((await evaluate(`document.getElementById('brand-voice').value`)).includes('Clear and direct'),'Style suggestion visibly fills voice');
  await edit('brand-voice','Direct and practical');await edit('brand-language','Spanish');
  assert.equal(await evaluate(`Boolean(document.getElementById('brand-spelling'))`),false,'English spelling is hidden for a different output language');
  await edit('brand-language','English');await edit('brand-spelling','UK English');
  assert.equal(commands.length,editRequests,'Typing, suggestions and language choices do not refetch page data');
  await noPageMotion();
  assert.equal(await settingsIdentity(),true,'Editing preserves the Settings shell');
  await confirmChoice(false,()=>evaluate(`${localLink('/settings')}.click()`));
  assert.equal(await evaluate('location.pathname'),'/settings/brand','Cancelled navigation retains unsaved edits');

  await edit('brand-writingExample','A short example in my voice.');await edit('brand-avoid','game-changing\nunlock your potential');
  await checkBrandFocus();
  const failedWrites = brandCalls.filter(item=>item.method==='PUT').length;
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await evaluate(`document.querySelector('button[type=submit]').scrollIntoView({block:'center'})`);
    setSaveFailure(true);await click('Save changes');await waitFor('temporarily unavailable');
    assert.equal(await evaluate(`(()=>{const error=document.getElementById('brand-save-error');if(!error)return false;const rect=error.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})()`),true,`${width}px: save failure is visible beside the action without scrolling`);
    assert.equal(await evaluate(`document.getElementById('brand-audience').value`),'Independent teachers');
  }
  const writeCountBeforeValidation = brandCalls.filter(item=>item.method==='PUT').length;
  await edit('brand-avoid','x'.repeat(121));
  await evaluate(`document.querySelector('button[type=submit]').scrollIntoView({block:'center'})`);await click('Save changes');
  assert.equal(brandCalls.filter(item=>item.method==='PUT').length,writeCountBeforeValidation,'Invalid phrases never send a save request');
  assert.equal(await evaluate(`document.activeElement===document.getElementById('brand-avoid')`),true,'Invalid phrase receives focus');
  assert.equal(await evaluate(`(()=>{const field=document.getElementById('brand-avoid'),error=document.getElementById('brand-avoid-error');if(!error)return false;const rect=error.getBoundingClientRect();return field.getAttribute('aria-invalid')==='true'&&field.getAttribute('aria-describedby').split(' ').includes(error.id)&&rect.top>=0&&rect.bottom<=innerHeight})()`),true,'Phrase validation is associated with the field and visible at its focused position');
  await edit('brand-avoid','game-changing\nunlock your potential');
  setSaveFailure(false);await click('Save changes');await waitUntil(`document.querySelector('button[type=submit]')?.disabled && document.querySelector('[role=status]')?.textContent.includes('Saved')`,'Saved profile status');
  await noPageMotion();
  assert.equal(await settingsIdentity(),true,'Saving keeps the Settings shell mounted');
  const saved = JSON.parse(brandCalls.filter(item=>item.method==='PUT').at(-1).postData);
  assert.deepEqual(saved.avoidPhrases,['game-changing','unlock your potential']);
  assert.equal(saved.spelling,'UK English');
  for (const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await evaluate('window.scrollTo(0,0)');await capture(`writing-brand-settings-${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await checkSettingsLayout(width);
    await checkBrandComposition(width);
    const fieldTop = await evaluate(`document.getElementById('brand-audience').getBoundingClientRect().top`);
    assert.ok(fieldTop<420,`The first useful field appears early (${width}px: ${fieldTop})`);
    if(width===375) assert.ok(await evaluate(`(()=>{const save=document.querySelector('button[type=submit]').getBoundingClientRect();return save.width>document.querySelector('form').getBoundingClientRect().width*.85})()`),'Mobile save uses the available form width');
  }
  await confirmChoice(false,()=>click('Clear preferences'));
  assert.equal(await evaluate(`document.getElementById('brand-audience').value`),'Independent teachers','Cancelling clear preserves saved values');
  await confirmChoice(true,()=>click('Clear preferences'));
  assert.equal(await evaluate(`document.getElementById('brand-audience').value`),'','Confirmed clear updates the draft');
  assert.equal(brandCalls.filter(item=>item.method==='PUT').length,failedWrites+3,'Clear requires explicit Save');
  await click('Save changes');await waitUntil(`document.querySelector('button[type=submit]')?.disabled && document.querySelector('[role=status]')?.textContent.includes('Saved')`,'Clear saved');
  assert.equal(JSON.parse(brandCalls.filter(item=>item.method==='PUT').at(-1).postData).audience,undefined);

  setProfile({...saved,name:'Updated elsewhere',colours:['#123456']});
  await evaluate(`${localLink('/settings')}.click()`);await waitFor('Appearance');
  await currentSection('/settings');
  holdReads.add('/v1/brand');
  const refreshReads = brandCalls.filter(item=>item.method==='GET').length;
  await evaluate('window.__settingsMotion=[];history.back()');await waitForHeldRead();
  assert.equal(await evaluate(`Boolean(document.querySelector('#brand-audience'))&&!document.querySelector('.brand-loading')`),true,'Cached Brand form remains visible while the deliberate refresh is pending');
  assert.equal(await settingsIdentity(),true,'Cached section entry preserves the Settings shell');
  await noPageMotion();
  await edit('brand-voice','Typed during refresh');
  const pendingWrites = brandCalls.filter(item=>item.method==='PUT').length;
  assert.equal(await evaluate(`document.querySelector('button[type=submit]').disabled`),true,'Saving waits for the latest profile without hiding editable fields');
  await evaluate(`document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);await sleep(50);
  assert.equal(brandCalls.filter(item=>item.method==='PUT').length,pendingWrites,'Submitting during a refresh cannot overwrite newer saved fields');
  await releaseReads();
  await waitUntil(`document.getElementById('brand-name')?.value==='Updated elsewhere'`,'Untouched preferences refreshed');
  assert.equal(brandCalls.filter(item=>item.method==='GET').length,refreshReads+1,'One deliberate profile read on Brand re-entry');
  assert.equal(await evaluate(`document.getElementById('brand-voice').value`),'Typed during refresh','Refresh preserves changes entered while the request was pending');
  await edit('brand-voice',saved.voice);
  assert.equal(await evaluate(`document.querySelector('button[type=submit]').disabled`),true,'Restoring the only local edit returns the refreshed profile to its clean state');
  await edit('brand-voice','Typed during refresh');
  await click('Save changes');await waitUntil(`document.querySelector('button[type=submit]')?.disabled && document.querySelector('[role=status]')?.textContent.includes('Saved')`,'Refreshed profile saved');
  const refreshedSave = JSON.parse(brandCalls.filter(item=>item.method==='PUT').at(-1).postData);
  assert.equal(refreshedSave.name,'Updated elsewhere','Saving retains fresh untouched brand details');
  assert.deepEqual(refreshedSave.colours,['#123456'],'Saving retains fresh hidden visual preferences');
  assert.equal(refreshedSave.voice,'Typed during refresh');

  await evaluate(`${localLink('/settings')}.click()`);await waitFor('Appearance');
  setReadFailure(true);
  await evaluate(`${localLink('/settings/brand')}.click()`);await waitFor('temporarily unavailable');
  assert.equal(await evaluate(`Boolean(document.querySelector('#brand-audience'))&&!document.querySelector('.brand-loading')`),true,'A failed refresh retains the cached form');
  await edit('brand-voice','Edit during failed check');
  assert.equal(await evaluate(`document.querySelector('button[type=submit]').disabled`),true,'A failed check cannot save stale preferences');
  setReadFailure(false);await click('Try again');
  await waitUntil(`!document.querySelector('[role=alert]')&&!document.querySelector('button[type=submit]').disabled`,'Failed background check retried');
  assert.equal(await evaluate(`document.getElementById('brand-voice').value`),'Edit during failed check','Retry preserves local edits');
  await edit('brand-voice','Typed during refresh');
  await waitFor('Who is your content for?');
  await currentSection('/settings/brand');

  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`${localLink('/settings')}.click()`);await waitFor('Appearance');
  const generalReads = commands.length;
  await evaluate(`window.__settingsMotion=[];document.querySelector('input[name=appearance][value=dark]').click()`);
  await sleep(100);
  assert.equal(commands.length,generalReads,'Returning to General and choosing appearance does not read Brand');
  assert.equal(await evaluate(`document.getAnimations().filter(animation=>animation.effect?.pseudoElement?.includes('view-transition')).length`),0,'Reduced motion skips theme scene animations');
  await evaluate(`${localLink('/settings/brand')}.click()`);await waitFor('Who is your content for?');await sleep(100);
  assert.deepEqual(await evaluate('window.__settingsMotion'),[],'Reduced motion skips section entrances');
  assert.equal(await settingsIdentity(),true,'Reduced-motion navigation preserves Settings shell identity');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'settings-render-checks.json'),JSON.stringify({
    stableSettingsShell:true,wholePageEntrances:false,localEditingRequests:0,appearanceRequests:0,
    coldLoadingIsLocal:true,cachedRefreshKeepsForm:true,pendingRefreshPreservesEdits:true,
    profileReadsPerReentry:1,reducedMotionEntrances:0,
  },null,2));

  await waitUntil(`document.querySelector('form') && !document.querySelector('.brand-loading')`,'Fresh settings loaded');
  assert.equal(await evaluate(`document.getElementById('brand-name').value`),'Updated elsewhere','Settings re-entry refreshes remote changes');
  const readCount = brandCalls.filter(item=>item.method==='GET').length;
  setRegression({id:'regression_brand',replies:['lost']});
  await evaluate(`document.querySelector('a[href="/projects"]').click()`);await waitFor('All projects');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`shadcn-cascade-projects-${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Project list stays within the viewport');
  }
  await evaluate(`import('/src/app/navigation.ts').then(({navigate})=>navigate('/projects/regression_brand'))`);await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');
  for(const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`shadcn-cascade-project-view-${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Project workspace stays within the viewport');
  }
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);await waitFor('Writing preferences');
  await evaluate(`document.querySelector('.writing-preferences').open=true`);await waitFor('Brand settings');
  await edit('creation-audience','New software educators');
  assert.equal(await evaluate(`document.querySelector('.create-content-chooser').open`),true);
  await waitUntil(`document.getElementById('creation-audience')?.value==='New software educators'`,'Edited audience retained');
  assert.equal(brandCalls.filter(item=>item.method==='GET').length,readCount,'Chooser and preferences do not fetch the saved profile');
  setProfile({...saved,voice:'Updated in another tab'});
  await evaluate(`document.querySelector('.create-content-chooser').open=false`);await sleep(100);
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);
  await waitUntil(`document.getElementById('creation-voice')?.value===''`,'Untouched voice inherits on the backend');
  assert.equal(await evaluate(`document.getElementById('creation-audience').value`),'New software educators','Reopening preserves temporary audience');
  assert.equal(brandCalls.filter(item=>item.method==='GET').length,readCount,'Reopening does not load the profile');
  await evaluate(`document.querySelector('.writing-preferences').open=false`);
  await evaluate(`document.querySelector('[aria-label="Create X post"]').click()`);await waitFor('We couldn’t confirm whether it started.');
  const original = getRegressionCalls().at(-1);
  assert.deepEqual(JSON.parse(original.postData).brand,{mode:'saved',overrides:{audience:'New software educators'}});
  await click('Retry request');await waitFor('Saved regression output remains available.');
  const replay = getRegressionCalls().at(-1);
  assert.equal(replay.postData,original.postData);assert.equal(replay.headers['Idempotency-Key'],original.headers['Idempotency-Key']);
  assert.equal(brandCalls.filter(item=>item.method==='PUT').length,failedWrites+5,'One-time choices never save the brand');
  await evaluate(`document.querySelector('.create-content-chooser').open=true`);await evaluate(`document.querySelector('.writing-preferences').open=true`);
  await waitUntil(`document.getElementById('creation-audience')?.value===''`,'One-time choice resets to inheritance after acceptance');
  for (const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});
    await capture(`writing-brand-preferences-${width}`);
    await checkNativeFields('creation',width);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Expanded writing controls fit the creation chooser');
  }
  await evaluate(`document.querySelector('.writing-preferences-toggle input').click()`);
  setRegression({id:'regression_brand',replies:[],saved:true});
  await evaluate(`document.querySelector('[aria-label="Create LinkedIn post"]').click()`);await sleep(500);
  assert.deepEqual(JSON.parse(getRegressionCalls().at(-1).postData).brand,{mode:'none'});
  for (const width of [375,1440]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===375});await evaluate(`document.querySelector('.create-content-chooser').open=true`);await capture(`writing-brand-create-${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  }
  setProfile(null);await navigate('/projects/regression_no_brand');await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');await evaluate(`document.querySelector('.create-content-chooser').open=true`);await waitFor('Using saved preferences');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Create X post"]').disabled`),false,'No setup gate');
  setReadFailure(true);await navigate('/projects/regression_brand_error');await waitUntil(`Boolean(document.querySelector('.source-activity-ready'))`,'source ready');await evaluate(`document.querySelector('.create-content-chooser').open=true`);await evaluate(`document.querySelector('.writing-preferences').open=true`);await waitFor('Brand settings');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Create X post"]').disabled`),false,'Brand endpoint failure is irrelevant to project generation');
  assert.equal(brandCalls.filter(item=>item.method==='GET').length,readCount,'No project flow reads the saved profile');
  assert.ok(commands.some(item=>item==='PUT /v1/brand'));
  console.log('PASS: General/Brand navigation, native form controls, save/error recovery and deliberate settings refresh preserve the shell; project sparse overrides, exact replay and bypass do not fetch saved profiles. Responsive light/dark screenshots captured.');
}
