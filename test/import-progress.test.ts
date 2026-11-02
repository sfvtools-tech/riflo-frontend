import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProject, importProgressView, reconcileImportProgress, type Project, type ImportProgress } from '../src/features/projects/project-response.ts';
const project: Project = { id: 'project', importOperationId: 'import_a', status: 'importing', source: { source: 'youtube', videoId: 'abcdefghijk', name: 'Video', bytes: null, durationSeconds: null }, createdAt: '2026-10-30T00:00:00Z', sourceExpiresAt: null, errorCode: null };
const progress: ImportProgress = { attempt: 1, stage: 'download', transferredBytes: 84 * 1024 ** 2, totalBytes: null };
test('downloads show received bytes only; upload percentages require valid stage totals', () => {
  assert.deepEqual(importProgressView({...project, importProgress: {...progress,totalBytes:168 * 1024 ** 2}}), {label:'Downloading video',percent:null,detail:'84 MB received'});
  assert.deepEqual(importProgressView({...project, importProgress: progress}), {label:'Downloading video',percent:null,detail:'84 MB received'});
  assert.deepEqual(importProgressView({...project, importProgress: {...progress, stage:'upload',totalBytes:168 * 1024 ** 2}}), {label:'Uploading to storage',percent:50,detail:'84 MB / 168 MB queued for upload'});
  assert.equal(importProgressView({...project, importProgress:{...progress, stage:'upload',totalBytes:progress.transferredBytes}}).label,'Uploading to storage');
  assert.deepEqual(importProgressView({...project, importProgress:{...progress,stage:'upload',totalBytes:progress.transferredBytes}}), {label:'Uploading to storage',percent:100,detail:'84 MB / 84 MB queued for upload. Waiting for storage confirmation.'});
  assert.equal(importProgressView({...project, importProgress:{...progress,stage:'upload'}}).detail,'84 MB queued for upload');
  assert.equal(importProgressView({...project, source:{...project.source,bytes:100}}).percent,null);
  assert.equal(importProgressView({...project, importProgress:{...progress,stage:'prepare',transferredBytes:0}}).percent,null);
});
test('missing and malformed telemetry falls back without breaking older project records', () => {
  assert.equal(readProject(project).importProgress,undefined);
  for (const invalid of [null, {}, {...progress,attempt:0}, {...progress,stage:'finished'}, {...progress,transferredBytes:-1}, {...progress,transferredBytes:Infinity}, {...progress,totalBytes:0}, {...progress,totalBytes:1}, {...progress,totalBytes:'unknown'}, {...progress,stage:'prepare'}]) {
    const next=readProject({...project,importProgress:invalid});
    assert.equal(next.importProgress,undefined);
    assert.equal(importProgressView(next).percent,null);
  }
  for (const status of ['queued','failed','source_ready','deleted']) {
    const next=readProject({...project,status,importProgress:progress});
    assert.equal(next.importProgress,undefined);
    assert.equal(importProgressView(next).percent,null);
  }
});
test('canonical progress resists older bytes/stages/attempts and resets on retry or terminal state', () => {
  const before={...project,importProgress:{...progress,stage:'upload' as const}};
  for(const after of [progress,{...before.importProgress,transferredBytes:1}]) assert.deepEqual(reconcileImportProgress(before,{...project,importProgress:after}).importProgress,before.importProgress);
  assert.deepEqual(reconcileImportProgress(before,{...project,importProgress:{...progress,attempt:2,transferredBytes:0}}).importProgress,{...progress,attempt:2,transferredBytes:0});
  for(const status of ['queued','failed','source_ready']) assert.equal(reconcileImportProgress(before,readProject({...project,status})).importProgress,undefined);
  const retry={...project,importOperationId:'import_b',importProgress:{...progress,transferredBytes:0}};
  assert.deepEqual(reconcileImportProgress(before,retry),retry);
  assert.equal(reconcileImportProgress(before,project).importProgress,undefined);
});

test('parallel import uses transfer percentage and independent transcript readiness', () => {
 const uploading = {...project, importProgress:{...progress,stage:'upload' as const,totalBytes:168 * 1024 ** 2}};
 assert.equal(importProgressView({...uploading,preparation:'transcribing'}).label,'Processing video');
 const ready = importProgressView({...uploading,preparation:'ready'});
 assert.equal(ready.label,'Saving video'); assert.equal(ready.percent,50);
 const transcribing = {...project,importProgress:{...progress,stage:'transcribe' as const,transferredBytes:0,totalBytes:null}};
 assert.equal(importProgressView({...transcribing,preparation:'pending'}).detail,'Your transcript is in the queue.');
 assert.equal(importProgressView({...transcribing,preparation:'transcribing',transcriptionStage:'transcribing'}).detail,'Transcribing your video.');
});
