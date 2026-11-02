import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildControls, controlValues, readControls, readControlsAvailability, readControlsSnapshot, readDefaults, resolvedFields, threadMaximum, type ControlsAvailability } from '../src/features/projects/generation-controls.ts';
import { pendingBatch } from '../src/features/projects/generation-response.ts';
const options:ControlsAvailability={version:1,available:true,choices:controlValues,builtins:{x_posts:{mode:'single',length:'auto'},blogs:{length:'auto'}},defaults:{blogs:{length:'long'},x_posts:{mode:'thread',maxPosts:6,numbering:'exclude'}},defaultsStatus:'resolved',focusMaxCharacters:500};
test('explicit Auto overrides saved values; missing fields inherit; reset restores inheritance',()=>{
  assert.equal(resolvedFields('blogs',options).length,'long');
  assert.equal(resolvedFields('blogs',options,{blogs:{length:'auto'}}).length,'auto');
  assert.deepEqual(buildControls('blogs',{}, {focus:'',start:'',end:''},100),{});
  assert.deepEqual(buildControls('blogs',{blogs:{length:'auto'},x_posts:{mode:'thread'}},{focus:' angle ',start:'',end:''},100),{focus:'angle',formats:{blogs:{length:'auto'}}});
});
test('thread max is inherited and only requires missing count or numbering for threads',()=>{
  assert.equal(threadMaximum('x_posts',options,{}),6);
  assert.equal(threadMaximum('x_posts',{...options,defaults:{}},{x_posts:{mode:'thread'}}),null);
  assert.equal(threadMaximum('x_posts',{...options,defaults:{}},{x_posts:{mode:'thread',maxPosts:4}}),null);
  assert.equal(threadMaximum('x_posts',{...options,defaults:{}},{x_posts:{mode:'single'}}),1);
  assert.equal(threadMaximum('x_posts',{...options,available:false},{}),1);
});
test('window validation rejects missing boundaries, outside source, nonfinite and short video but accepts short text windows',()=>{
  const draft={focus:'',start:'2',end:'5'};
  assert.deepEqual(buildControls('blogs',{},draft,30).sourceWindow,{startSeconds:2,endSeconds:5});
  for(const [format,source,duration] of [['short_videos',draft,30],['blogs',{...draft,end:''},30],['blogs',{...draft,end:'31'},30],['blogs',{...draft,start:'NaN'},30],['blogs',draft,null]] as const) assert.throws(()=>buildControls(format,{},source,duration));
});
test('rejects malformed options, controls, unsupported fields and snapshot origins',()=>{
  assert.equal(readControlsAvailability(options),options);
  assert.throws(()=>readDefaults({x_posts:{maxPosts:11}}));
  assert.throws(()=>readDefaults({blogs:{cta:'yes'}}));
  assert.throws(()=>readControls({formats:{blogs:{length:'short'}}},{x_posts:1}));
  assert.throws(()=>readControlsAvailability({...options,choices:{}}));
  assert.throws(()=>readControlsSnapshot({version:1,status:'resolved',formats:{blogs:{}},origins:{blogs:{length:'guess'}}}));
});
test('uncertain request storage preserves exact controls through reload and mutable defaults',()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as Storage;
  const pending=pendingBatch(storage,'account','project');
  const request={key:'request_123',selection:{x_posts:1},controls:{focus:'keep this',sourceWindow:{startSeconds:0,endSeconds:20},formats:{x_posts:{mode:'thread' as const,maxPosts:5,numbering:'include' as const,length:'auto' as const}}}};
  pending.save(request);
  assert.deepEqual(pendingBatch(storage,'account','project').read(),request);
  pending.clear('other_request');assert.deepEqual(pending.read(),request);
  assert.equal(pendingBatch(storage,'other_account','project').read(),null);
  pending.clear(request.key);assert.equal(pending.read(),null);
});


test('thread availability is optional for older responses and boolean when advertised',()=>{
  assert.equal(readControlsAvailability(options).threadAvailable,undefined);
  assert.equal(readControlsAvailability({...options,threadAvailable:false}).threadAvailable,false);
  assert.throws(()=>readControlsAvailability({...options,threadAvailable:'yes'}));
});


test('accepted summaries require an origin for every resolved field',()=>{
  const snapshot={version:1,status:'resolved',formats:{blogs:{length:'long'}},origins:{blogs:{length:'saved'}}};
  assert.deepEqual(readControlsSnapshot(snapshot),snapshot);
  assert.throws(()=>readControlsSnapshot({...snapshot,origins:{blogs:{}}}));
  assert.throws(()=>readControlsSnapshot({...snapshot,origins:{blogs:{length:'saved'},x_posts:{}}}));
});


test('video captions inherit the backend Off default and preserve saved or explicit Clean', () => {
  const availability = readControlsAvailability({ ...options, defaults: {}, builtins: { short_videos: { captions: 'off' } } });
  assert.equal(resolvedFields('short_videos', availability).captions, 'off');
  for (const captions of ['clean', 'off'] as const) {
    const saved = { ...availability, defaults: readDefaults({ short_videos: { captions } }) };
    assert.equal(resolvedFields('short_videos', saved).captions, captions);
    for (const choice of ['clean', 'off'] as const) {
      const edits = { short_videos: { captions: choice } };
      assert.equal(resolvedFields('short_videos', saved, edits).captions, choice);
      assert.deepEqual(buildControls('short_videos', edits, { focus: '', start: '', end: '' }, 60), { formats: edits });
    }
  }
  assert.deepEqual(buildControls('short_videos', {}, { focus: '', start: '', end: '' }, 60), {});
});
