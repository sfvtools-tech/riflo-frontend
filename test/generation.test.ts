import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAction, formats, generationHeadline, generationWasReset, readAvailability, readBatch, readOutputs, readGenerationResults, formatProgress, pendingBatch, type Batch } from '../src/features/projects/generation-response.ts';
import { ApiError, createApi } from '../src/shared/api/client.ts';
import { canReleaseSubmission } from '../src/features/projects/submission-response.ts';

const session = { getToken: async () => 'private-token', isCurrent: () => true };
const path = '/v1/projects/project_1/outputs/output_1/assets/slide_1/download';
const output = { id: 'output_1', feature: 'carousels', text: '<script>plain text</script>', expiresAt: '2026-10-20T00:00:00Z', assets: [{ id: 'slide_1', contentType: 'image/png', downloadPath: path }] };

test('terminal generation reads include outputs committed while progress was loading', async () => {
  let commit!: () => void;
  const pendingCommit = new Promise<void>(resolve => { commit = resolve; });
  let committed = false;
  const api = createApi(session, async input => {
    if (String(input).endsWith('/generation')) {
      await pendingCommit;
      committed = true;
      return Response.json({ data: { id: 'batch_1', status: 'completed', slots: [{ id: 'output_1', feature: 'carousels', status: 'ready', errorCode: null }] } });
    }
    return Response.json({ data: committed ? [output] : [] });
  });
  const reading = readGenerationResults(api, 'project_1', new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  commit();
  const [progress, saved] = await reading;
  assert.equal(progress.status, 'fulfilled');
  assert.equal(saved.status, 'fulfilled');
  if (saved.status === 'fulfilled') assert.equal(saved.value[0]?.id, 'output_1');
});

test('a progress read failure still preserves independently readable saved content', async () => {
  const api = createApi(session, async input => String(input).endsWith('/generation')
    ? Response.json({ error: { code: 'observation_unavailable' } }, { status: 503 })
    : Response.json({ data: [output] }));
  const [progress, saved] = await readGenerationResults(api, 'project_1', new AbortController().signal);
  assert.equal(progress.status, 'rejected');
  assert.equal(saved.status, 'fulfilled');
  if (saved.status === 'fulfilled') assert.equal(saved.value[0]?.id, 'output_1');
});

test('generation headline describes the current batch stage', () => {
  const batch: Batch = {id: 'batch_1', status: 'queued', slots: [{id: 'slot_1', feature: 'x_posts', status: 'pending', errorCode: null}]};
  assert.equal(generationHeadline(batch, 'X post'), 'Waiting to start X post…');
  assert.equal(generationHeadline({...batch, status: 'transcribing'}, 'X post'), 'Preparing transcript for X post…');
  assert.equal(generationHeadline({...batch, status: 'generating'}, 'X post'), 'Generating X post…');
  assert.equal(generationHeadline(batch, ''), 'Waiting to start content…');
});

test('only an entirely reset failed batch gets neutral reset feedback', () => {
  const batch: Batch = {id: 'batch_1', status: 'failed', slots: [{id: 'slot_1', feature: 'x_posts', status: 'failed', errorCode: 'generation_reset'}]};
  assert.equal(generationWasReset(readBatch(batch)), true);
  assert.equal(generationWasReset(null), false);
  assert.equal(generationWasReset({...batch, slots: []}), false);
  assert.equal(generationWasReset({...batch, status: 'queued'}), false);
  assert.equal(generationWasReset({...batch, slots: [{...batch.slots[0], errorCode: 'invalid_generated_output'}]}), false);
  assert.equal(generationWasReset({...batch, slots: [...batch.slots, {...batch.slots[0], id: 'slot_2', errorCode: 'provider_unavailable'}]}), false);
});

test('only requested formats show submission or generation progress', () => {
  const batch: Batch = {id: 'batch_1', status: 'generating', slots: [{id: 'slot_1', feature: 'x_posts', status: 'pending', errorCode: null}]};
  for (const [feature] of formats) {
    assert.equal(formatProgress(feature, batch, {blogs: 1}, true), feature === 'blogs' ? 'Sending…' : null, 'submission supersedes prior batch labels');
    assert.equal(formatProgress(feature, batch, {blogs: 1}, false), null, 'uncertain acceptance does not claim processing');
    assert.equal(formatProgress(feature, batch, null, false), feature === 'x_posts' ? 'Generating…' : null);
    assert.equal(formatProgress(feature, null, null, false), null, 'a global availability lock does not identify an active format');
  }
  assert.equal(formatProgress('x_posts', {...batch, status: 'queued'}, null, false), 'Queued…');
  assert.equal(formatProgress('x_posts', {...batch, status: 'transcribing'}, null, false), 'Transcribing…');
  for (const status of ['completed', 'partial', 'failed'] as const) {
    assert.equal(formatProgress('x_posts', {...batch, status}, null, false), null, 'terminal batches never show active progress');
  }
  const legacy: Batch = {...batch, slots: [
    {...batch.slots[0], status: 'ready'},
    {id: 'slot_2', feature: 'linkedin_posts', status: 'failed', errorCode: 'provider_unavailable'},
    {id: 'slot_3', feature: 'blogs', status: 'pending', errorCode: null},
    {id: 'slot_4', feature: 'newsletters', status: 'pending', errorCode: null},
  ]};
  assert.equal(formatProgress('x_posts', legacy, null, false), null);
  assert.equal(formatProgress('linkedin_posts', legacy, null, false), null);
  assert.equal(formatProgress('blogs', legacy, null, false), 'Waiting…', 'batch stage cannot identify which legacy slot is executing');
  assert.equal(formatProgress('newsletters', legacy, null, false), 'Waiting…');
  assert.equal(formatProgress('short_videos', legacy, null, false), null);
});

test('output responses accept the public projection and older cached provider metadata', () => {
  const text = { id: 'text_1', feature: 'x_posts', text: 'Saved post.', createdAt: '2026-10-18T12:00:00Z', expiresAt: '2026-11-18T12:00:00Z' };
  const media = { ...text, id: 'clip_1', feature: 'short_videos', data: { status: 'ok', segments: [{ startSeconds: 0, endSeconds: 12 }] }, assets: [{ id: 'clip', contentType: 'video/mp4', bytes: 240, width: 720, height: 1280, durationSeconds: 12, downloadPath: '/v1/projects/project_1/outputs/clip_1/assets/clip/download' }] };
  const current = [text, media];
  assert.deepEqual(readOutputs(current, 'project_1'), current);
  const cached = current.map(output => ({ ...output, model: 'historical-model', promptVersion: 'historical-version' }));
  assert.deepEqual(readOutputs(cached, 'project_1'), cached);
});

test('generation responses retain text and reject malformed or foreign download locations', () => {
  assert.deepEqual(readOutputs([output], 'project_1'), [output]);
  for (const feature of formats.map(([key]) => key)) {
    assert.equal(readBatch({id: 'batch_1', status: 'partial', slots: [{id: 'slot_1', feature, status: 'failed', errorCode: 'provider_unavailable'}]}).slots[0].feature, feature);
  }
  for (const change of [{id: '../private'}, {feature: 'unknown'}, {text: null}, {expiresAt: 'invalid'}, {assets: [{...output.assets[0], contentType: 'text/html'}]}, {assets: [{...output.assets[0], downloadPath: 'https://evil.test/video'}]}, {assets: [{...output.assets[0], downloadPath: path.replace('project_1', 'other_project')}]}]) {
    assert.throws(() => readOutputs([{...output, ...change}], 'project_1'));
  }
  for (const batch of [null, {status: 'published', slots: []}, {status: 'queued', slots: null}, {status: 'queued', slots: [{id: 'slot', feature: 'x_posts', status: 'ready'}]}]) {
    assert.throws(() => readBatch(batch));
  }
});

test('only a known first rejection permits replacing an immutable submission', () => {
  for (const operation of ['generation', 'import'] as const) {
    for (const [status, code] of [[403, 'allowance_exceeded'], [403, 'subscription_required'], [429, 'queue_full']] as const) {
      const rejection = new ApiError(status, code, 'safe rejection');
      assert.equal(canReleaseSubmission(rejection, operation, false), true);
      assert.equal(canReleaseSubmission(rejection, operation, true), false, 'a later rejection cannot disprove an earlier commit');
    }
    for (const rejection of [new TypeError('lost response'), new ApiError(502, 'invalid_response', 'malformed success'), new ApiError(500, 'allowance_exceeded', 'wrong status'), new ApiError(403, 'unknown', 'unknown code'), new ApiError(409, 'idempotency_conflict', 'conflict')]) {
      assert.equal(canReleaseSubmission(rejection, operation, false), false);
    }
  }
  assert.equal(canReleaseSubmission(new ApiError(409, 'generation_exists', 'existing'), 'generation', false), false);
  assert.equal(canReleaseSubmission(new ApiError(409, 'source_allowance_expired', 'expired'), 'generation', false), true);
  assert.equal(canReleaseSubmission(new ApiError(409, 'source_allowance_expired', 'expired'), 'import', false), false);
});

test('quota, queue and source-period errors have stable messages without provider details', async () => {
  for (const [status, code, expected] of [[403, 'allowance_exceeded', /remaining allowance/], [429, 'queue_full', /queue is full/], [403, 'feature_not_in_plan', /not included/], [409, 'source_allowance_expired', /earlier allowance period/]] as const) {
    const api = createApi(session, async () => Response.json({error: {code, message: 'private provider detail'}}, {status}));
    await assert.rejects(api('/v1/projects/project_1/generate'), (error: unknown) => error instanceof ApiError && expected.test(error.message) && !error.message.includes('private'));
  }
});

test('uncertain generation requests preserve identity per account and project', async () => {
  const values = new Map<string, string>();
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key)} as Storage;
  const pending = pendingBatch(storage, 'account_1', 'project_1');
  const request = {key: 'request_1234', selection: {x_posts: 2, blogs: 1}};
  pending.save(request);
  assert.deepEqual(pending.read(), request);
  assert.equal(pendingBatch(storage, 'account_2', 'project_1').read(), null);
  assert.equal(pendingBatch(storage, 'account_1', 'project_2').read(), null);
  let calls = 0;
  const api = createApi(session, async (_path, init) => {
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), request.key);
    assert.deepEqual(JSON.parse(String(init?.body)), request.selection);
    if (++calls === 1) throw new TypeError('lost response');
    return Response.json({data: {status: 'queued', slots: []}});
  });
  const send = () => api('/v1/projects/project_1/generate', undefined, {method: 'POST', key: pending.read()!.key, body: pending.read()!.selection});
  await assert.rejects(send(), /lost response/);
  await send();
  pending.clear();
  assert.equal(pending.read(), null);
  for (const value of ['broken JSON', JSON.stringify({key: 'short', selection: {x_posts: 1}}), JSON.stringify({...request, selection: {unknown: 1}}), JSON.stringify({...request, selection: {x_posts: 0}}), JSON.stringify({...request, selection: {x_posts: 1.5}})]) {
    storage.setItem('riflo:batch:account_1:project_1', value);
    assert.equal(pending.read(), null);
  }
});

test('binary downloads authenticate and accept only the expected file type', async () => {
  const controller = new AbortController();
  const api = createApi(session, async (requested, init) => {
    assert.equal(requested, path);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-token');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, controller.signal);
    return new Response('png-bytes', {headers: {'Content-Type': 'image/png'}});
  });
  assert.equal(await (await api.blob(path, 'image/png', controller.signal)).text(), 'png-bytes');
  await assert.rejects(createApi(session, async () => new Response('html', {headers: {'Content-Type': 'text/html'}})).blob(path, 'image/png'), /Unexpected file type/);
  await assert.rejects(createApi(session, async () => new Response('private server detail', {status: 403})).blob(path, 'image/png'), (error: unknown) => error instanceof ApiError && error.status === 403 && !error.message.includes('private server detail'));
});

test('binary downloads reject unsafe paths before requesting tokens', async () => {
  const api = createApi({getToken: async () => {assert.fail('unsafe path requested token');}, isCurrent: () => true});
  for (const invalid of ['https://evil.test/file', '//evil.test/file', `${path}?token=secret`, path.replace('project_1', '..'), path.replace('slide_1', '%2e%2e'), '/v1/projects/project_1']) {
    await assert.rejects(api.blob(invalid, 'image/png'), /Invalid download path/);
  }
});

test('binary downloads discard data after account changes or cancellation', async () => {
  let current = true;
  const before = createApi({getToken: async () => {current = false; return 'stale';}, isCurrent: () => current}, async () => {assert.fail('stale account reached network');});
  await assert.rejects(before.blob(path, 'image/png'), {name: 'AbortError'});
  current = true;
  const during = createApi({...session, isCurrent: () => current}, async () => ({ok: true, headers: new Headers({'Content-Type': 'image/png'}), blob: async () => {current = false; return new Blob(['private']);}} as Response));
  await assert.rejects(during.blob(path, 'image/png'), {name: 'AbortError'});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createApi(session, async () => {assert.fail('cancelled download reached network');}).blob(path, 'image/png', controller.signal), {name: 'AbortError'});
});


const availabilityContext = {
  access: { active: true, reason: 'active', expiresAt: null },
  preferences: { languages: ['English', 'Hindi'], limits: { audience: 500, voice: 500, language: 80, spelling: 80 } },
};

test('retained transcript eligibility comes from each backend format decision', () => {
  const available = {...availabilityContext, sourceAvailable: false, transcriptAvailable: true, sourceExpiresAt: '2026-10-19T00:00:00Z', transcriptExpiresAt: '2026-11-19T00:00:00Z', activeBatch: false, outputs: Object.fromEntries(formats.map(([key]) => [key, {available: key !== 'short_videos', reason: key === 'short_videos' ? 'requires_reimport' : 'available'}]))};
  assert.equal(readAvailability(available).outputs.x_posts.available, true);
  for (const transcriptRetentionMode of [undefined, 'fixed', 'while_paid']) {
    assert.equal(readAvailability({...available, transcriptRetentionMode}).transcriptRetentionMode, transcriptRetentionMode);
  }
  for (const transcriptRetentionMode of [null, true, 1, 'forever', {toString: () => 'while_paid'}]) {
    assert.throws(() => readAvailability({...available, transcriptRetentionMode}));
  }
  assert.equal(readAvailability(available).outputs.short_videos.available, false);
  for (const value of [{...available, sourceAvailable: 'yes'}, {...available, transcriptExpiresAt: 'tomorrow'}, {...available, outputs: {}}, {...available, outputs: {...available.outputs, blogs: {available: true, reason: 'requires_reimport'}}}, {...available, outputs: {...available.outputs, blogs: {available: false, reason: 'unknown'}}}]) { assert.throws(() => readAvailability(value)); }
  assert.equal(readBatch({id: 'archived_batch_1', status: 'completed', slots: []}).id, 'archived_batch_1');
  assert.throws(() => readBatch({status: 'completed', slots: []}));
  assert.throws(() => readBatch({id: '../foreign', status: 'completed', slots: []}));
});

test('safe first reimport and cooldown rejections release intent; later ones preserve it', () => {
  for (const [operation, status, code] of [['retry', 429, 'retry_cooldown'], ['retry', 409, 'import_not_failed'], ['generation', 409, 'requires_reimport'], ['generation', 409, 'generation_in_progress']] as const) {
    assert.equal(canReleaseSubmission(new ApiError(status, code, 'rejected'), operation, false), true);
    assert.equal(canReleaseSubmission(new ApiError(status, code, 'rejected'), operation, true), false);
  }
});

test('rate-limit deadline is exposed without trusting provider error details', async () => {
  const api = createApi(session, async () => Response.json({error: {code: 'retry_cooldown', message: 'private detail'}}, {status: 429, headers: {'Retry-After': '31'}}));
  await assert.rejects(api('/v1/projects/project_1/retry-import', undefined, {method: 'POST', key: 'retry_12345'}), (error: unknown) => error instanceof ApiError && error.retryAfterSeconds === 31 && !error.message.includes('private'));
});


test('retry allowance errors use source guidance and ignore untrusted server wording', async () => {
  const api = createApi(session, async () => Response.json({error: {code: 'allowance_exceeded', message: '<script>private provider detail</script>'}}, {status: 403}));
  await assert.rejects(api('/v1/projects/project_1/retry-import', undefined, {method: 'POST', key: 'retry_12345'}), (error: unknown) => error instanceof ApiError && error.message.includes('source video allowance') && !error.message.includes('fewer outputs') && !error.message.includes('private'));
});


test('format actions keep saved content accessible without permitting blocked generation', () => {
  assert.equal(formatAction(true, false, false, false), 'create');
  assert.equal(formatAction(true, false, false, true), 'create');
  assert.equal(formatAction(false, false, false, true), 'view');
  assert.equal(formatAction(false, false, false, false), 'unavailable');
  assert.equal(formatAction(true, false, true, true), 'view');
  assert.equal(formatAction(true, false, true, false), 'waiting');
  assert.equal(formatAction(true, true, false, false), 'checking');
  assert.equal(formatAction(true, true, false, true), 'checking');
});

test('progress notices skip unchanged snapshots and read saved content only for newly ready slots or final reconciliation', async () => {
  let batch: Batch = {id: 'batch_1', status: 'queued', slots: [{id: 'output_1', feature: 'carousels', status: 'pending', errorCode: null}]};
  const calls: string[] = [];
  let saved = [] as typeof output[];
  const api = createApi(session, async input => {
    const path = String(input); calls.push(path.split('/').at(-1)!);
    return Response.json({data: path.endsWith('/generation') ? batch : saved});
  });
  const controller = new AbortController();
  const operation = {projectId: 'project_1', kind: 'generation' as const, id: 'batch_1'};
  let snapshot = {batch: {...batch}, outputs: [] as typeof output[], known: true};
  async function read(status: Batch['status'], ready = 0, terminal = false) {
    batch = {...batch, status, slots: batch.slots.map(slot => ({...slot, status: ready ? 'ready' : 'pending'}))};
    const [progress, outputs] = await readGenerationResults(api, 'project_1', controller.signal, snapshot, {
      event: terminal ? 'terminal' : 'changed', operation, progress: {status, ready, failed: 0},
    });
    assert.equal(progress.status, 'fulfilled'); assert.equal(outputs.status, 'fulfilled');
    if (progress.status === 'fulfilled' && progress.value && outputs.status === 'fulfilled') snapshot = {batch: progress.value, outputs: outputs.value as typeof output[], known: true};
  }
  await read('queued'); assert.deepEqual(calls, []);
  await read('transcribing'); await read('generating'); assert.deepEqual(calls, ['generation', 'generation']);
  saved = [output];
  await read('generating', 1); assert.deepEqual(calls.slice(-2), ['generation', 'outputs']);
  await read('generating', 1); assert.equal(calls.length, 4);
  await read('completed', 1, true); assert.deepEqual(calls.slice(-2), ['generation', 'outputs']);
  assert.equal(snapshot.outputs[0].id, output.id);
  calls.length = 0;
  await readGenerationResults(api, 'project_1', controller.signal, snapshot);
  assert.deepEqual(calls, ['generation', 'outputs'], 'recovery always reconciles content even when cached counts match');
});

test('a matching ready notice retries missing outputs instead of treating older saved content as current', async () => {
  const batch: Batch = {id: 'batch_1', status: 'generating', slots: [
    {id: 'output_1', feature: 'carousels', status: 'ready', errorCode: null},
    {id: 'output_2', feature: 'carousels', status: 'ready', errorCode: null},
  ]};
  const calls: string[] = [];
  const saved = [output, {...output, id: 'output_2', assets: undefined}];
  const api = createApi(session, async input => {
    const path = String(input); calls.push(path.split('/').at(-1)!);
    return Response.json({data: path.endsWith('/generation') ? batch : saved});
  });
  const [, result] = await readGenerationResults(api, 'project_1', new AbortController().signal, {batch, outputs: [], known: true}, {
    event: 'changed', operation: {projectId: 'project_1', kind: 'generation', id: batch.id}, progress: {status: 'generating', ready: 2, failed: 0},
  });
  assert.deepEqual(calls, ['generation', 'outputs']);
  assert.equal(result.status, 'fulfilled');
  if (result.status === 'fulfilled') assert.equal(result.value.length, 2);
});

test('transcription retries are explicit zero-output operations and reject misleading shapes', () => {
  const retry = {id:'retry_1',intent:'transcription_retry',status:'transcribing',slots:[],errorCode:null};
  assert.equal(readBatch(retry).intent, 'transcription_retry');
  assert.equal(generationHeadline(readBatch(retry), ''), 'Preparing transcript…');
  for (const [feature] of formats) assert.equal(formatProgress(feature, readBatch(retry), null, false), null);
  for (const change of [{intent:'unknown'}, {status:'generating'}, {status:'partial'}, {slots:[{id:'slot',feature:'blogs',status:'pending',errorCode:null}]}, {errorCode:{}}]) assert.throws(() => readBatch({...retry,...change}));
});

test('transcription availability trusts the backend recovery decision and permanent reason', () => {
  const data = {...availabilityContext, sourceAvailable:true,transcriptAvailable:false,sourceExpiresAt:null,transcriptExpiresAt:null,activeBatch:false,outputs:Object.fromEntries(formats.map(([key])=>[key,{available:false,reason:'transcription_not_retryable'}])),transcription:{status:'failed',retryAvailable:false,reason:'transcription_not_retryable',errorCode:'no_audio'}};
  assert.equal(readAvailability(data).transcription?.retryAvailable,false);
  assert.equal(readAvailability({...data,transcription:{status:'failed',retryAvailable:true,reason:'available'}}).transcription?.retryAvailable,true);
  for (const transcription of [{status:'unknown',retryAvailable:false,reason:'available'}, {status:'ready',retryAvailable:true,reason:'available'}, {status:'failed',retryAvailable:true,reason:'requires_reimport'}, {status:'failed',retryAvailable:false,reason:'unknown'}]) assert.throws(()=>readAvailability({...data,transcription}));
  assert.equal(canReleaseSubmission(new ApiError(409,'transcription_not_retryable','blocked'),'transcription',false),true);
  assert.equal(canReleaseSubmission(new ApiError(409,'transcription_not_retryable','blocked'),'transcription',true),false);
});

test('retry transcription accepts a finite generation stream with an empty immutable command', async () => {
  const operation={projectId:'project_1',kind:'generation',id:'retry_1'};
  let calls=0;
  const api=createApi(session,async (path,init)=>{
    calls++;
    assert.equal(path,'/v1/projects/project_1/retry-transcription');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'),'transcription_123');
    assert.equal(new Headers(init?.headers).get('Accept'),'text/event-stream');
    assert.equal(init?.body,'{}');
    return new Response(`event: accepted\ndata: ${JSON.stringify({version:1,operation,status:'completed',ready:0,failed:0})}\n\nevent: terminal\ndata: ${JSON.stringify({version:1,operation,status:'completed',ready:0,failed:0,terminal:true,outcome:'succeeded'})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  });
  const accepted=[];
  assert.deepEqual(await api.submit('/v1/projects/project_1/retry-transcription',new AbortController().signal,{key:'transcription_123',body:{}},value=>accepted.push(value),true),operation);
  assert.deepEqual(accepted,[operation]);assert.equal(calls,1);
});

test('transcription retry keys stay separate from import and other signed-in accounts', async () => {
  const {pendingRetry}=await import('../src/features/projects/pending-retry.ts');
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as Storage;
  const pending=pendingRetry(storage,'account_1','project_1','transcription');
  pending.save('transcription_123');
  assert.equal(pendingRetry(storage,'account_1','project_1','transcription').read(),'transcription_123');
  assert.equal(pendingRetry(storage,'account_2','project_1','transcription').read(),null);
  assert.equal(pendingRetry(storage,'account_1','project_1').read(),null);
  pending.clear('different_key');assert.equal(pending.read(),'transcription_123');
  pending.clear('transcription_123');assert.equal(pending.read(),null);
});

test('duplicate generated output has clear manual recovery copy', async () => {
  const {generationFailureMessage}=await import('../src/features/projects/generation-response.ts');
  assert.equal(generationFailureMessage({id:'batch_1',status:'failed',slots:[{id:'slot',feature:'blogs',status:'failed',errorCode:'duplicate_generated_output'}]}),'The result repeated existing content. Try another focus.');
});


test('project availability requires access and writing option projections', () => {
  const data = { ...availabilityContext, sourceAvailable: true, transcriptAvailable: true, sourceExpiresAt: null, transcriptExpiresAt: null, activeBatch: false, outputs: Object.fromEntries(formats.map(([key]) => [key, { available: true, reason: 'available' }])) };
  assert.deepEqual(readAvailability(data).preferences, availabilityContext.preferences);
  for (const change of [
    {access: undefined}, {access: {...data.access, active: 'yes'}}, {access: {...data.access, reason: null}}, {access: {...data.access, expiresAt: 'tomorrow'}},
    {preferences: undefined}, {preferences: {...data.preferences, languages: ['English', 1]}}, {preferences: {...data.preferences, languages: ['']}},
    ...[undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(voice => ({preferences: {...data.preferences, limits: {...data.preferences.limits, voice}}})),
  ]) assert.throws(() => readAvailability({...data, ...change}));
  for (const reason of ['generation_not_configured', 'feature_not_implemented']) {
    assert.equal(readAvailability({...data, outputs: {...data.outputs, blogs: {available: false, reason}}}).outputs.blogs.reason, reason);
    assert.throws(() => readAvailability({...data, outputs: {...data.outputs, blogs: {available: true, reason}}}));
  }
  assert.equal(readAvailability({...data, transcription: {status: 'failed', retryAvailable: false, reason: 'generation_not_configured'}}).transcription?.retryAvailable, false);
});


test('minimal public generation snapshots preserve every stage, brand status and repeated formats', () => {
  for (const status of ['queued', 'transcribing', 'generating', 'completed', 'partial', 'failed'] as const) {
    const slotStatus = status === 'completed' ? 'ready' : status === 'failed' ? 'failed' : 'pending';
    const dto = {id: 'batch_minimal', status, slots: [{id: 'slot_1', feature: 'blogs', status: slotStatus, errorCode: slotStatus === 'failed' ? 'provider_unavailable' : null}], errorCode: status === 'failed' ? 'provider_unavailable' : null, brand: {status: 'applied'}};
    assert.deepEqual(readBatch(JSON.parse(JSON.stringify(dto))), dto);
  }
  const mixed = {id: 'legacy_multi', status: 'partial', slots: [
    {id: 'first', feature: 'x_posts', status: 'ready', errorCode: null},
    {id: 'second', feature: 'x_posts', status: 'failed', errorCode: 'duplicate_generated_output'},
    {id: 'third', feature: 'blogs', status: 'failed', errorCode: 'provider_unavailable'},
  ], errorCode: null};
  assert.deepEqual(readBatch(mixed), mixed);
  assert.equal(formatProgress('x_posts', readBatch(mixed), null, false), null);
  const legacy = {...mixed, selection: {x_posts: 2, blogs: 1}, createdAt: 'old-cache', updatedAt: 'old-cache', slots: mixed.slots.map((slot, ordinal) => ({...slot, ordinal, attempts: 3}))};
  assert.deepEqual(readBatch(legacy), legacy, 'older cached snapshots remain readable without requiring removed metadata');
});

test('minimal transcription retry snapshots keep zero outputs and failure reference', () => {
  for (const status of ['queued', 'transcribing', 'completed', 'failed'] as const) {
    const dto = {id: 'transcription_minimal', intent: 'transcription_retry', status, slots: [], errorCode: status === 'failed' ? 'no_audio' : null};
    const batch = readBatch(dto);
    assert.deepEqual(batch, dto);
    for (const [feature] of formats) assert.equal(formatProgress(feature, batch, null, false), null);
    assert.equal(generationWasReset(batch), false);
  }
});

test('retention modes are optional and validated without coercion', () => {
  for (const retentionMode of [undefined, 'fixed', 'while_paid']) {
    assert.equal(readOutputs([{ ...output, retentionMode }], 'project_1')[0].retentionMode, retentionMode);
  }
  for (const retentionMode of [null, true, 1, 'forever', { toString: () => 'while_paid' }]) {
    assert.throws(() => readOutputs([{ ...output, retentionMode }], 'project_1'), /Unexpected generated content/);
  }
  assert.throws(() => readOutputs([{ ...output, retentionMode: 'while_paid', expiresAt: null }], 'project_1'));
});

test('trial admission rejection releases only a first command and never an uncertain earlier request', () => {
  for (const operation of ['import', 'retry', 'generation', 'transcription'] as const) {
    for (const [status, code] of [[403, 'trial_identity_required'], [403, 'trial_already_used'], [403, 'trial_work_limited'], [429, 'trial_rate_limited']] as const) {
      const error = new ApiError(status, code, 'rejected');
      assert.equal(canReleaseSubmission(error, operation, false), true);
      assert.equal(canReleaseSubmission(error, operation, true), false);
      assert.equal(canReleaseSubmission(new ApiError(500, code, 'unknown outcome'), operation, false), false);
    }
    assert.equal(canReleaseSubmission(new ApiError(503, 'trial_not_configured', 'awaiting setup'), operation, false), false);
  }
});


test('source-control failures use safe immediate and terminal messages without changing failed status', async () => {
  const { generationFailureMessage } = await import('../src/features/projects/generation-response.ts');
  const { errorMessage } = await import('../src/shared/api/client.ts');
  const messages = {
    unsupported_focus: 'The selected source does not support this focus. Try a focus supported by the source.',
    source_window_conflict: 'This source window cannot preserve complete speech or necessary context. Choose another window.',
    source_window_empty: 'This source window contains no complete spoken words. Choose another window.',
  };
  for (const [code, message] of Object.entries(messages)) {
    const batch = readBatch({id:'batch_source',status:'failed',slots:[{id:'slot_source',feature:'blogs',status:'failed',errorCode:code}]});
    assert.equal(generationFailureMessage(batch), message);
    assert.equal(errorMessage(new ApiError(422, code, 'Private focus and provider reasoning')), message);
    assert.equal(batch.status, 'failed');
    assert.equal(batch.slots[0].status, 'failed');
  }
  assert.equal(generationFailureMessage({id:'batch_source',status:'failed',slots:[{id:'slot_source',feature:'blogs',status:'failed',errorCode:'unknown_provider_failure'}]}), 'Couldn’t create your content.');
});

test('thread outputs validate grouped posts, actual delivery and canonical copy text alongside legacy outputs', async () => {
  const { outputThread, threadPostText } = await import('../src/features/projects/generation-response.ts');
  const thread = {id:'thread_1',feature:'x_posts',expiresAt:'2030-01-01T00:00:00Z',text:'1/2 First\n\n2/2 Second',data:{kind:'thread',status:'ok',posts:['First','Second'],numbering:'include'},deliveredPosts:2,credits:2,requestedMaxPosts:6};
  const parsed=readOutputs([thread,{...output,assets:undefined}],'project_1');
  assert.equal(outputThread(parsed[1]),null);
  assert.equal(threadPostText(outputThread(parsed[0])!,1),'2/2 Second');
  const single={...thread,text:'1/1 Complete thought',data:{...thread.data,posts:['Complete thought']},deliveredPosts:1,credits:1};
  assert.equal(readOutputs([single],'project_1')[0].deliveredPosts,1);
  const unnumbered={...thread,text:'First\n\nSecond',data:{...thread.data,numbering:'exclude'}};
  assert.equal(threadPostText(outputThread(readOutputs([unnumbered],'project_1')[0])!,0),'First');
  for(const changes of [
    {feature:'blogs'}, {credits:6}, {deliveredPosts:3}, {requestedMaxPosts:1}, {requestedMaxPosts:11},
    {text:'1/6 First\n\n2/6 Second'}, {data:{...thread.data,posts:[]}}, {data:{...thread.data,posts:['First',' ']}},
    {data:{...thread.data,numbering:'auto'}}, {data:{...thread.data,status:'unsupported_focus'}},
    {data:undefined}, {assets:[{id:'a',contentType:'image/png',downloadPath:'/v1/projects/project_1/outputs/thread_1/assets/a/download'}]},
  ]) assert.throws(()=>readOutputs([{...thread,...changes}],'project_1'));
});

test('thread slot metadata retains reservation and actual delivery while rejecting impossible credits',()=>{
  const slot={id:'thread_1',feature:'x_posts',status:'ready',errorCode:null,maxCredits:10,credits:6,deliveredPosts:6};
  assert.equal(readBatch({id:'batch_thread',status:'completed',slots:[slot]}).slots[0].deliveredPosts,6);
  for(const change of [{credits:10},{deliveredPosts:11},{maxCredits:5},{status:'pending'},{feature:'blogs'}]) assert.throws(()=>readBatch({id:'batch_thread',status:'completed',slots:[{...slot,...change}]}));
});

test('only known first control rejections release submission; uncertain replay stays immutable',()=>{
  for(const [status,code] of [[400,'invalid_generation_controls'],[403,'generation_threads_unavailable'],[503,'generation_controls_unavailable']] as const) {
    const error=new ApiError(status,code,'Rejected before acceptance');
    assert.equal(canReleaseSubmission(error,'generation',false),true);
    assert.equal(canReleaseSubmission(error,'generation',true),false);
  }
  assert.equal(canReleaseSubmission(new ApiError(503,'service_unavailable','Uncertain'),'generation',false),false);
});

 test('import transcription batches remain transcript-only', () => {
  const batch = readBatch({id:'eager_batch',intent:'import_transcription',status:'transcribing',slots:[],errorCode:null});
  assert.equal(batch.intent,'import_transcription');
  assert.match(generationHeadline(batch),/transcript/i);
  assert.throws(()=>readBatch({...batch,status:'generating'}));
 });

test('transcript stage notices merge into known batches without extra reads', async () => {
 const calls: string[]=[];
 const api=createApi(session,async input=>{calls.push(String(input));return Response.json({data:null});});
 const batch: Batch={id:'retry_1',intent:'transcription_retry',status:'transcribing',slots:[],transcriptReady:false,transcriptionStage:'preparing_audio'};
 const [result]=await readGenerationResults(api,'project_1',new AbortController().signal,{batch,outputs:[],known:true},{event:'changed',operation:{projectId:'project_1',kind:'generation',id:'retry_1'},progress:{status:'transcribing',ready:0,failed:0,transcriptReady:true,transcriptionStage:'transcribing'}});
 assert.deepEqual(calls,[]);
 assert.equal(result.status,'fulfilled');
 if(result.status==='fulfilled') {assert.equal(result.value?.transcriptionStage,'transcribing');assert.equal(result.value?.transcriptReady,true);}
});
