import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkCreationOptionsLayout({command,evaluate,open,edit,capture,sleep}) {
  const evidence=[],failures=[];
  const snapshot=()=>evaluate(`(()=>{
    const dialog=document.querySelector('.create-content-dialog[open]');
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    const fields=[...dialog.querySelectorAll('.generation-options select')].map(el=>({id:el.id,rect:rect(el),label:rect(document.querySelector('label[for="'+el.id+'"]')),appearance:getComputedStyle(el).appearance,icons:el.parentElement.querySelectorAll('svg').length}));
    const summaries=[...dialog.querySelectorAll('.creation-disclosure > summary')].map(el=>({text:el.textContent,display:getComputedStyle(el).display,marker:getComputedStyle(el,'::marker').content,icons:el.querySelectorAll(':scope > svg[aria-hidden="true"]').length,transition:getComputedStyle(el.querySelector('svg')).transitionDuration}));
    return {dialog:rect(dialog),top:rect(dialog.querySelector('.create-content-top')),footer:rect(dialog.querySelector('.create-content-footer')),fields,summaries,overflow:dialog.scrollWidth>dialog.clientWidth,bodyOverflow:dialog.querySelector('.create-content-body').scrollWidth>dialog.querySelector('.create-content-body').clientWidth};
  })()`);
  const sameFrame=(a,b,context)=>{
    for(const part of ['dialog','top','footer'])for(const dim of ['x','y','width','height'])if(Math.abs(a[part][dim]-b[part][dim])>=1)failures.push(`${context}: ${part}.${dim} (${a[part][dim]} → ${b[part][dim]})`);
  };
  for(const width of [375,1440])for(const theme of ['light','dark']) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===375});
    await evaluate(`document.documentElement.dataset.appearance='${theme}';window.dispatchEvent(new Event('riflo:appearance'));document.querySelector('.firebase-emulator-warning')?.remove()`);
    await sleep(350);
    let base;
    for(const format of ['x_posts','linkedin_posts','blogs','newsletters','carousels','short_videos']) {
      await open(format);
      await evaluate(`document.documentElement.dataset.appearance='${theme}';window.dispatchEvent(new Event('riflo:appearance'))`);await sleep(300);
      await evaluate(`document.querySelectorAll('.create-content-dialog details').forEach(el=>el.open=false)`);
      const collapsed=await snapshot();
      if(base)sameFrame(base,collapsed,`${width}/${theme}/${format}`);else base=collapsed;
      assert.equal(collapsed.overflow||collapsed.bodyOverflow,false,'No horizontal overflow');
      for(const field of collapsed.fields){assert.equal(field.appearance,'none','Native select marker suppressed');assert.equal(field.icons,1,'Exactly one select chevron');}
      for(const summary of collapsed.summaries){assert.equal(summary.display,'flex');assert.equal(summary.marker,'""');assert.equal(summary.icons,1);}
      for(let i=1;i<collapsed.fields.length;i++){
        const a=collapsed.fields[i-1],b=collapsed.fields[i];
        if(Math.abs(a.label.y-b.label.y)<1)assert.ok(Math.abs(a.rect.y-b.rect.y)<1,'Controls with same-row labels align');
      }
      if(format==='x_posts')for(const mode of ['single','thread','']){await edit('creation-x_posts-mode',mode);await sleep(220);sameFrame(collapsed,await snapshot(),`${width}/${theme}/X ${mode}`);}
      if(theme==='light')await capture(`options-${format}-collapsed-${width}`);
      await evaluate(`document.documentElement.dataset.appearance='${theme}';window.dispatchEvent(new Event('riflo:appearance'));document.querySelectorAll('.create-content-dialog details').forEach(el=>el.open=true)`);
      await sleep(220);
      const expanded=await snapshot();sameFrame(collapsed,expanded,`${width}/${theme}/${format} disclosure`);
      await evaluate(`document.querySelector('.create-content-body').scrollTop=0`);
      await evaluate(`document.querySelector('.create-content-body').scrollTop=document.querySelector('.create-content-body').scrollHeight`);
      if(theme==='light')await capture(`options-${format}-expanded-${width}`);
      evidence.push({width,theme,format,collapsed,expanded});
    }
  }
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await open('blogs');await sleep(80);
  await evaluate(`document.querySelector('.creation-disclosure summary').focus()`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await evaluate(`document.activeElement.tagName`),'SUMMARY','Keyboard disclosure retains focus');
  const reduced=await snapshot();assert.ok(reduced.summaries.every(s=>s.transition==='0s'),'Reduced motion removes chevron transition');
  await command('Emulation.setEmulatedMedia',{features:[]});
  await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'creation-options-layout.json'),JSON.stringify({evidence,reduced,failures},null,2));
  assert.deepEqual(failures,[],'Dialog header/footer stay fixed across formats and disclosures');
}
