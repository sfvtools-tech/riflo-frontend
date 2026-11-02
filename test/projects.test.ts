import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importProgressView, readImportProgress, parseDriveLink, readVideo, readProject, readProjects, importPending, sourceLabel, videoSize, importIntentKey } from '../src/features/projects/project-response.ts';
import { createApi } from '../src/shared/api/client.ts';
import { pendingImport } from '../src/features/projects/pending-import.ts';

const video = {fileId: 'test_video-123', name: '<script>test fixture</script>', mimeType: 'video/mp4', bytes: 4096, durationSeconds: null};
const project = {id: 'test_project-123', status: 'queued', source: video, createdAt: '2026-10-18T00:00:00.000Z', sourceExpiresAt: null, attempts: 0, errorCode: null};

test('original links remain provider-bound and optional for older project responses', () => {
  assert.equal(readProject(project).sourceUrl, undefined);
  assert.equal(readProject({...project, sourceUrl:null}).sourceUrl, null);
  const driveLink = `https://drive.google.com/file/d/${video.fileId}/view?resourcekey=original_key`;
  assert.equal(readProject({...project, status:'source_expired', sourceUrl:driveLink}).sourceUrl, driveLink);
  const youtube = {...project, source:{source:'youtube',videoId:'abcdefghijk',name:'Video',mimeType:'video/mp4',bytes:null,durationSeconds:60},sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk'};
  assert.equal(readProject(youtube).sourceUrl, youtube.sourceUrl);
  for (const sourceUrl of ['javascript:alert(1)', 'https://evil.example/video', `https://drive.google.com/file/d/different/view`, `https://drive.google.com/file/d/${video.fileId}/view?resourcekey=key&resourcekey=second`, `https://drive.google.com/file/d/${video.fileId}/view?redirect=https://evil.example`]) {
    assert.throws(() => readProject({...project,sourceUrl}));
  }
});

test('pending imports restore the complete canonical input and stay account scoped', () => {
  const values = new Map<string,string>();
  const storage = {get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as Storage;
  const intent={input:{fileId:video.fileId,resourceKey:'original_key'},details:video,key:'request_original'};
  pendingImport(storage,'first').save(intent);
  assert.deepEqual(pendingImport(storage,'first').read(),intent);
  assert.equal(pendingImport(storage,'second').read(),null);
  pendingImport(storage,'first').clear({...intent,key:'another_request'});
  assert.deepEqual(pendingImport(storage,'first').read(),intent,'a different request cannot clear unresolved work');
  pendingImport(storage,'first').clear(intent);
  storage.setItem(importIntentKey('first',intent.input),intent.key);
  assert.deepEqual(pendingImport(storage,'first').read(),{...intent,details:null});
  pendingImport(storage,'first').clear(intent);
  assert.equal(pendingImport(storage,'first').read(),null);
  for(const malformed of ['broken',JSON.stringify({...intent,input:{...intent.input,source:'youtube'}}),JSON.stringify({...intent,details:{...video,fileId:'different'}}),JSON.stringify({...intent,key:'bad'})]) {
    storage.setItem('riflo:import:first',malformed);
    assert.deepEqual(pendingImport(storage,'first').read(),{invalid:true});
    assert.equal(pendingImport(storage,'second').read(),null);
  }
});

test('Drive links extract file identity without fetching user supplied URLs', () => {
  assert.deepEqual(parseDriveLink('https://drive.google.com/file/d/test_video-123/view?resourcekey=key_123'), {fileId: 'test_video-123', resourceKey: 'key_123'});
  assert.deepEqual(parseDriveLink('https://drive.google.com/open?id=test_video-123'), {fileId: 'test_video-123'});
  for (const link of ['javascript:alert(1)', 'http://drive.google.com/file/d/a', 'https://drive.google.com.evil.test/file/d/a', 'https://evil.test@drive.google.com/file/d/a', 'https://drive.google.com:444/file/d/a', 'https://drive.google.com/drive/folders/a', 'https://drive.google.com/open?id=../secret', 'https://drive.google.com/file/d/a?resourcekey=', `https://drive.google.com/file/d/${'a'.repeat(257)}`]) {
    assert.throws(() => parseDriveLink(link), undefined, link);
  }
});

test('project responses reject malformed lifecycle data and retain plain source text', () => {
  assert.deepEqual(readProject(project), project);
  assert.deepEqual(readProjects([project]), [project]);
  assert.equal(readVideo(video).name, '<script>test fixture</script>');
  for (const change of [{id: '../private'}, {status: 'completed'}, {createdAt: null}, {createdAt: 'not a date'}, {sourceExpiresAt: undefined}, {errorCode: {}}, {errorCode: undefined}, {source: {...video, bytes: Infinity}}, {source: {...video, durationSeconds: -1}}]) {
    assert.throws(() => readProject({...project, ...change}), undefined, JSON.stringify(change));
  }
  assert.throws(() => readProjects({projects: []}));
  assert.throws(() => readProjects([project, null]));
  for (const status of ['queued', 'importing', 'source_ready', 'source_expired', 'failed', 'deleted']) {
    assert.equal(importPending(readProject({...project, status})), status === 'queued' || status === 'importing');
  }
});

test('uncertain import retries preserve request identity and private JSON transport', async () => {
  let calls = 0;
  const api = createApi({getToken: async () => 'test-id-token', isCurrent: () => true}, async (path, init) => {
    calls++;
    assert.equal(path, '/v1/projects');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, JSON.stringify({fileId: video.fileId}));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Idempotency-Key'), 'test-import-key');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('Authorization'), 'Bearer test-id-token');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    if (calls === 1) { throw new TypeError('test lost acknowledgement'); }
    return Response.json({data: project});
  });
  const options = {method: 'POST' as const, body: {fileId: video.fileId}, key: 'test-import-key'};
  await assert.rejects(api('/v1/projects', undefined, options), /lost acknowledgement/);
  assert.deepEqual(await api('/v1/projects', undefined, options), project);
  assert.equal(calls, 2);
});

test('account changes cannot submit a pending import with the previous token', async () => {
  let current = true;
  const api = createApi({getToken: async () => {current = false; return 'old-account-token';}, isCurrent: () => current}, async () => {assert.fail('stale mutation reached network');});
  await assert.rejects(api('/v1/projects', undefined, {method: 'POST', body: {fileId: video.fileId}, key: 'test-import-key'}), {name: 'AbortError'});
});

test('YouTube source responses retain provider identity and reject malformed metadata', () => {
  const input = {source: 'youtube' as const, videoId: 'abcdefghijk'};
  const source = {source: 'youtube' as const, videoId: input.videoId, name: '<script>plain source text</script>', mimeType: 'video/mp4', bytes: null, durationSeconds: null};
  assert.deepEqual(readProject({...project, source}).source, source);
  assert.equal(sourceLabel(source), 'YouTube');
  assert.equal(sourceLabel(video), 'Google Drive');
  assert.equal(videoSize(null), 'Size checked during import');
  assert.equal(videoSize(1), '1 B');
  assert.equal(videoSize(1023), `${(1023).toLocaleString()} B`);
  assert.equal(videoSize(1024), '1 KB');
  assert.equal(videoSize(12000), `${(11.7).toLocaleString()} KB`);
  assert.equal(videoSize(1024 ** 2), '1 MB');
  assert.equal(videoSize(1024 ** 3), '1 GB');
  for (const details of [
    {...source, videoId: 'short'}, {...source, fileId: 'drive-file'}, {...source, source: 'unknown'},
    {...source, bytes: -1}, {...source, bytes: Infinity}, {...source, bytes: '123'},
    {...video, videoId: input.videoId}, {...video, bytes: null},
  ]) assert.throws(() => readVideo(details));

});

test('import request storage keeps legacy Drive keys while separating providers and accounts', () => {
  const youtube = {source: 'youtube' as const, videoId: 'abcdefghijk'};
  const originalDrive = {fileId: 'video-id', resourceKey: 'resource-key'};
  assert.equal(importIntentKey('alice', originalDrive), 'riflo-import:alice:video-id:resource-key');
  assert.equal(importIntentKey('alice', {fileId: 'video-id'}), 'riflo-import:alice:video-id:');
  assert.equal(importIntentKey('alice', youtube), 'riflo-youtube-import:alice:abcdefghijk');
  assert.notEqual(importIntentKey('alice', youtube), importIntentKey('bob', youtube));
  assert.notEqual(importIntentKey('alice', youtube), importIntentKey('alice', {fileId: 'youtube', resourceKey: youtube.videoId}));
});


test('same-project retry persists one key per account through lost responses and reloads', async () => {
  const {pendingRetry} = await import('../src/features/projects/pending-retry.ts');
  const entries = new Map<string, string>();
  const storage = {getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key)} as Storage;
  const pending = pendingRetry(storage, 'account_a', 'project_a');
  pending.save('retry_request_123');
  assert.equal(pendingRetry(storage, 'account_a', 'project_a').read(), 'retry_request_123');
  assert.equal(pendingRetry(storage, 'account_b', 'project_a').read(), null);
  assert.equal(pendingRetry(storage, 'account_a', 'project_b').read(), null);
  entries.set('riflo:import-retry:account_a:project_a', '../bad');
  assert.equal(pending.read(), null);
  pending.clear();
  assert.equal(pending.read(), null);
});


test('retry allowance is backend-driven and rejects unsafe numbers or contradictory availability', () => {
  const importRetry = {available: false, reason: 'allowance_exceeded', availableAt: '2026-10-18T00:00:00Z', allowance: {requiredSeconds: 1025, remainingSeconds: 775}};
  assert.deepEqual(readProject({...project, status: 'failed', importRetry}).importRetry, importRetry);
  for (const remainingSeconds of [-1, Infinity, NaN, '775', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readProject({...project, importRetry: {...importRetry, allowance: {...importRetry.allowance, remainingSeconds}}}));
  }
  assert.equal(readProject({...project, importRetry: {...importRetry, allowance: {...importRetry.allowance, remainingSeconds: 775.267967}}}).importRetry?.allowance?.remainingSeconds, 775.267967);
  assert.throws(() => readProject({...project, importRetry: {...importRetry, available: true}}));
  assert.equal(readProject({...project, importRetry: {...importRetry, reason: 'subscription_required'}}).importRetry?.available, false);
});

test('public project responses accept minimal provider metadata and ignore legacy internal extras', () => {
  const {mimeType: _mimeType, ...metadata} = video;
  const {attempts: _attempts, ...base} = project;
  const drive = {...base, source: {...metadata, source: 'drive'}, sourceUrl: `https://drive.google.com/file/d/${video.fileId}/view`};
  const youtube = {...base, source: {source: 'youtube', videoId: 'abcdefghijk', name: 'Video', bytes: null, durationSeconds: null}, sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk'};
  for (const value of [drive, youtube, {...base, source: metadata}, {...project, attempts: 'unused legacy value', source: {...video, mimeType: null, requiresProbe: 'unused'}}]) {
    assert.deepEqual(readProject(value), value);
    assert.deepEqual(readProjects([value]), [value]);
  }
  assert.equal(sourceLabel(readProject(drive).source), 'Google Drive');
  assert.equal(sourceLabel(readProject(youtube).source), 'YouTube');
  for (const source of [
    {...drive.source, fileId: '../private'}, {...drive.source, fileId: 'a'.repeat(257)}, {...drive.source, videoId: 'abcdefghijk'},
    {...youtube.source, videoId: 'short'}, {...youtube.source, fileId: 'drive'}, {...youtube.source, source: 'unknown'},
    {...drive.source, bytes: null}, {...drive.source, bytes: 0}, {...drive.source, bytes: 1.5}, {...drive.source, bytes: Number.MAX_SAFE_INTEGER + 1},
    {...youtube.source, bytes: undefined}, {...drive.source, name: ''}, {...drive.source, name: 'a'.repeat(4097)},
    {...youtube.source, durationSeconds: Infinity}, {...youtube.source, durationSeconds: undefined},
  ]) assert.throws(() => readProject({...base, source}));
  for (const sourceUrl of ['https://www.youtube.com/watch?v=lmnopqrstuv', 'https://youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&resourcekey=key']) {
    assert.throws(() => readProject({...youtube, sourceUrl}));
  }
  assert.equal(readProject({...drive, status: 'failed', errorCode: 'import_failed'}).errorCode, 'import_failed');
  for (const status of ['queued', 'importing', 'source_ready', 'source_expired', 'deleted']) {
    assert.equal(readProject({...project, status, errorCode: 'stale_failure'}).errorCode, 'stale_failure', 'legacy project responses may retain an old import error');
  }
});

test('legacy pending metadata still requires video MIME after project DTO slimming', () => {
  let saved: string | null = null;
  const storage = {getItem: () => saved, setItem: (_key: string, value: string) => {saved = value;}} as Storage;
  for (const mimeType of [undefined, null, '', 'application/octet-stream', 'text/html']) {
    assert.throws(() => readVideo({...video, mimeType}));
    saved = JSON.stringify({input: {fileId: video.fileId}, details: {...video, mimeType}, key: 'request_original'});
    assert.deepEqual(pendingImport(storage, 'first').read(), {invalid: true});
  }
});

test('minimal project responses parse across list, create and same-project retry requests', async () => {
  const {mimeType: _mimeType, ...source} = video;
  const {attempts: _attempts, ...base} = project;
  const minimal = {...base, source: {...source, source: 'drive'}};
  const calls: {path: string; init?: RequestInit}[] = [];
  const api = createApi({getToken: async () => 'test-token', isCurrent: () => true}, async (path, init) => {
    calls.push({path: String(path), init});
    return Response.json({data: init?.method === 'POST' ? minimal : [minimal]});
  });
  assert.deepEqual(readProjects(await api('/v1/projects')), [minimal]);
  assert.deepEqual(api.snapshot('/v1/projects', readProjects), [minimal]);
  assert.deepEqual(readProject(await api('/v1/projects', undefined, {method: 'POST', body: {fileId: video.fileId, resourceKey: 'original_key'}, key: 'request_original'})), minimal);
  assert.deepEqual(readProject(await api(`/v1/projects/${project.id}/retry-import`, undefined, {method: 'POST', key: 'retry_original'})), minimal);
  assert.equal(calls[1].init?.body, JSON.stringify({fileId: video.fileId, resourceKey: 'original_key'}));
  assert.equal(new Headers(calls[1].init?.headers).get('Idempotency-Key'), 'request_original');
  assert.equal(new Headers(calls[2].init?.headers).get('Idempotency-Key'), 'retry_original');
});

test('restoration response contract is additive and rejects unsafe availability or intent', () => {
  const sourceRestore = {available:true,reason:'revalidation_required',availableAt:null};
  assert.deepEqual(readProject({...project,importIntent:'source_restore',sourceRestore}).sourceRestore,sourceRestore);
  for(const reason of ['source_restore_not_available','retry_cooldown','allowance_exceeded','subscription_required']) {
    assert.equal(readProject({...project,sourceRestore:{...sourceRestore,available:false,reason}}).sourceRestore?.reason,reason);
    assert.throws(()=>readProject({...project,sourceRestore:{...sourceRestore,reason}}));
  }
  for(const change of [{available:'true'},{availableAt:'yesterday'},{reason:'unknown'}]) assert.throws(()=>readProject({...project,sourceRestore:{...sourceRestore,...change}}));
  assert.throws(()=>readProject({...project,importIntent:'restore_anything'}));
});

test('restoration recovery keeps a distinct account/project key across reload and uncertain rejection', async () => {
  const {pendingRetry} = await import('../src/features/projects/pending-retry.ts');
  const {canReleaseSubmission} = await import('../src/features/projects/submission-response.ts');
  const {ApiError,errorMessage} = await import('../src/shared/api/client.ts');
  const entries=new Map<string,string>();
  const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>entries.delete(key)} as Storage;
  const pending=pendingRetry(storage,'owner','project','restoration');pending.save('restore_request_123');
  assert.equal(pendingRetry(storage,'owner','project','restoration').read(),'restore_request_123');
  for(const kind of ['import','transcription'] as const) assert.equal(pendingRetry(storage,'owner','project',kind).read(),null);
  assert.equal(pendingRetry(storage,'other','project','restoration').read(),null);
  pending.clear('different_request');assert.equal(pending.read(),'restore_request_123');
  for(const code of ['source_changed','source_identity_unverified','source_restore_not_available']) {
    const error=new ApiError(409,code,'backend message');
    assert.equal(canReleaseSubmission(error,'restoration',false),true);
    assert.equal(canReleaseSubmission(error,'restoration',true),false);
    assert.match(errorMessage(error),/new project/);
  }
  assert.equal(canReleaseSubmission(new TypeError('Failed to fetch'),'restoration',false),false);
  pending.clear('restore_request_123');assert.equal(pending.read(),null);
});

test('restoration allowance rejection retains structured source minutes and restoration wording', async () => {
  const {ApiError}=await import('../src/shared/api/client.ts');
  const api=createApi({getToken:async()=> 'token',isCurrent:()=>true},async()=>Response.json({error:{code:'allowance_exceeded',allowance:{requiredSeconds:120,remainingSeconds:60}}},{status:403}));
  await assert.rejects(api('/v1/projects/project/restore-source',undefined,{method:'POST',key:'restore_key'}),error=>{
    assert.ok(error instanceof ApiError);assert.match(error.message,/restore this source/);assert.deepEqual(error.allowance,{requiredSeconds:120,remainingSeconds:60});return true;
  });
});


test('direct YouTube imports preserve the exact URL and key across recovery without cross-account leakage', () => {
  const values = new Map<string,string>();
  const storage = {get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as Storage;
  const url = 'https://youtu.be/abcdefghijk?t=15&si=Original';
  const intent = {input:{source:'youtube' as const,url},submittedURL:url,details:null,key:'original_request'};
  pendingImport(storage,'first').save(intent);
  assert.deepEqual(pendingImport(storage,'first').read(),intent);
  assert.equal(pendingImport(storage,'second').read(),null);
  for (const input of [{source:'youtube',url,videoId:'abcdefghijk'},{source:'youtube',url:42},{source:'youtube',url:''}]) {
    storage.setItem('riflo:import:first',JSON.stringify({...intent,input}));
    assert.deepEqual(pendingImport(storage,'first').read(),{invalid:true});
  }
  storage.setItem('riflo:import:first',JSON.stringify({...intent,submittedURL:'https://youtu.be/lmnopqrstuv'}));
  assert.deepEqual(pendingImport(storage,'first').read(),{invalid:true});
  const drive = {input:{fileId:'picked_B',resourceKey:'key_B'},submittedURL:'https://drive.google.com/file/d/picked_B/view?resourcekey=key_B',details:null,key:'drive_request'};
  pendingImport(storage,'first').save(drive);
  assert.deepEqual(pendingImport(storage,'first').read(),drive);
  storage.setItem('riflo:import:first',JSON.stringify({...drive,submittedURL:'https://drive.google.com/file/d/draft_A/view?resourcekey=key_A'}));
  assert.deepEqual(pendingImport(storage,'first').read(),{invalid:true});
  const legacy = {input:{source:'youtube' as const,videoId:'abcdefghijk'},details:null,key:'legacy_request'};
  storage.setItem('riflo:import:first',JSON.stringify(legacy));
  assert.deepEqual(pendingImport(storage,'first').read(),legacy);
  pendingImport(storage,'first').clear(legacy);
  storage.setItem(importIntentKey('first',legacy.input),legacy.key);
  assert.deepEqual(pendingImport(storage,'first').read(),legacy);
});

test('invalid YouTube URLs release only a first rejected request and import failures use actionable copy', async () => {
  const {canReleaseSubmission} = await import('../src/features/projects/submission-response.ts');
  const {ApiError,importErrorMessage} = await import('../src/shared/api/client.ts');
  const error = new ApiError(400,'invalid_youtube_link','invalid');
  assert.equal(canReleaseSubmission(error,'import',false),true);
  assert.equal(canReleaseSubmission(error,'import',true),false);
  assert.equal(importErrorMessage('youtube_verification_required'),'YouTube could not verify access to this video. Riflo could not import it.');
  assert.equal(importErrorMessage('youtube_download_failed'),'YouTube could not provide this video to Riflo.');
  assert.match(importErrorMessage('drive_file_unavailable'),/Check its access/);
  assert.match(importErrorMessage('unknown_code'),/retry.*another source/);
});

 test('eager imports distinguish stored video from transcript readiness without invented progress', () => {
  const pending = readProject({...project, status:'source_ready', preparation:'transcribing'});
  assert.equal(importProgressView(pending).label, 'Preparing transcript');
  assert.equal(importProgressView({...pending,preparation:'failed'}).label, 'Transcript needs attention');
  const progress = {attempt:1,stage:'transcribe',transferredBytes:0,totalBytes:null};
  const view = importProgressView(readProject({...project,status:'importing',preparation:'transcribing',importProgress:progress}));
  assert.equal(view.percent,null);
  assert.equal(view.label,'Preparing transcript');
  assert.equal(readImportProgress({...progress,totalBytes:100}),null);
  assert.throws(()=>readProject({...project,preparation:'unknown'}));
 });
