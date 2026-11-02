import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const tokens=readFileSync(new URL('../src/styles/tokens.css',import.meta.url),'utf8');
const startup=readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)![1];
test('synchronous startup resolves saved/system preference and blocked storage before rendering',()=>{
  for(const saved of ['system','light','dark','invalid',null,'blocked']) for(const dark of [true,false]) {
    const root={dataset:{},style:{}} as any;
    vm.runInNewContext(startup,{document:{documentElement:root,querySelector:()=>({})},matchMedia:()=>({matches:dark}),localStorage:{getItem(){if(saved==='blocked')throw Error('blocked');return saved}}});
    assert.equal(root.dataset.theme,saved==='light'||saved==='dark'?saved:dark?'dark':'light');
    assert.equal(root.style.colorScheme,root.dataset.theme);
  }
});
function luminance(hex:string){const v=hex.replace('#','').match(/../g)!.map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]}
const palettes: Record<string,string>[]=[];
let inherited: Record<string,string>={};
for(const block of tokens.split(/:root[^\{]*\{/).slice(1)) {
  inherited={...inherited,...Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([,key,value])=>[key,value.trim()]))};
  const resolve=(key:string,seen:string[]=[]):string=>{
    assert.ok(!seen.includes(key),`cyclic token ${key}`);
    const value=inherited[key];assert.ok(value,`missing token ${key}`);
    const alias=value.match(/^var\(--([\w-]+)\)$/);
    if(alias)return resolve(alias[1],[...seen,key]);
    return /^#[\da-f]{3}$/i.test(value)?'#'+[...value.slice(1)].map(c=>c+c).join(''):value;
  };
  palettes.push(Object.fromEntries(Object.keys(inherited).map(key=>[key,resolve(key)])));
}
test('both palettes meet text and meaningful control contrast across reading surfaces',()=>{
  for(const colors of palettes) {
    const ratio=(a:string,b:string)=>{const x=luminance(colors[a]),y=luminance(colors[b]);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
    for(const background of ['paper','surface']) {
      for(const foreground of ['ink','muted','primary','accent','editorial','brand-mark','heading-accent','output-label','error','success','warning']) assert.ok(ratio(foreground,background)>=4.5,`${foreground}/${background}: ${ratio(foreground,background)}`);
      assert.ok(ratio('control-border',background)>=3);
    }
    for(const background of ['primary','primary-hover','primary-pressed']) assert.ok(ratio('on-primary',background)>=4.5);
    assert.ok(ratio('on-selected','selected')>=4.5);
  }
});
test('all large surface and neutral text roles are achromatic in both palettes',()=>{
  for(const colors of palettes) for(const key of ['paper','surface','subtle','selected','on-selected','ink','muted','border','control-border','story','on-story','story-muted','media']) {
    const color=colors[key];assert.match(color,/^#[\da-f]{6}$/i,key);
    assert.equal(color.slice(1,3),color.slice(3,5),key);
    assert.equal(color.slice(3,5),color.slice(5,7),key);
  }
});
test('feature styles contain no legacy literal palette colors',()=>{
  const styles=readFileSync(new URL('../src/styles/app.css',import.meta.url),'utf8');
  assert.equal(/#[\da-f]{3,8}\b|rgba?\(/i.test(styles),false);
});


test('editorial copper remains distinct from action blue and outcome colors',()=>{
  for (const colors of palettes) {
    assert.notEqual(colors.editorial, colors.primary);
    for (const outcome of ['error','success','warning']) assert.notEqual(colors.editorial, colors[outcome]);
    for (const surface of ['story','subtle']) {
      const a=luminance(colors.editorial),b=luminance(colors[surface]);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`editorial/${surface}`);
    }
  }
});
