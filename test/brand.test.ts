import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/shared/api/client.ts';
import { writingBrand, loadBrand, readBrand, readBrandRequest, saveBrand } from '../src/features/brand/brand-response.ts';

test('brand responses preserve hidden visual preferences and reject unexpected values', () => {
  assert.deepEqual(readBrand({ voice: 'Direct', colours: ['#123456'], fonts: ['Inter'] }), { voice: 'Direct', colours: ['#123456'], fonts: ['Inter'] });
  assert.equal(readBrand(null), null);
  for (const value of [[], { owner: 'other' }, { voice: 12 }, { avoidPhrases: ['one', 2] }]) assert.throws(() => readBrand(value));
});

test('writing request parsing rejects bypass overrides and unsupported fields', () => {
  assert.throws(() => readBrandRequest({ mode: 'none', overrides: {} }));
  assert.throws(() => readBrandRequest({ mode: 'saved', overrides: { writingExample: 'secret' } }));
});

test('brand reads share an account-scoped cache; save refreshes it without leaking between accounts', async () => {
  let reads = 0;
  const session = { getToken: async () => 'token', isCurrent: () => true };
  const api = createApi(session, async (_path, init) => {
    reads++;
    return Response.json({ data: init?.method === 'PUT' ? JSON.parse(String(init.body)) : { audience: 'Teachers' } });
  });
  assert.deepEqual(await Promise.all([loadBrand(api), loadBrand(api)]), [{ audience: 'Teachers' }, { audience: 'Teachers' }]);
  assert.equal(reads, 1);
  await saveBrand(api, { voice: 'Warm', colours: ['#123456'] }, new AbortController().signal);
  assert.deepEqual(await loadBrand(api), { voice: 'Warm', colours: ['#123456'] });
  assert.equal(reads, 2);
  const other = createApi(session, async () => Response.json({ data: null }));
  assert.equal(await loadBrand(other), null);
});

test('failed brand reads can be retried and cannot populate stale account data', async () => {
  let current = true, attempts = 0;
  const api = createApi({ getToken: async () => 'token', isCurrent: () => current }, async () => {
    attempts++;
    if (attempts === 1) return Response.json({ error: { code: 'brand_unavailable' } }, { status: 503 });
    return Response.json({ data: { voice: 'Direct' } });
  });
  await assert.rejects(loadBrand(api));
  assert.deepEqual(await loadBrand(api), { voice: 'Direct' });
  current = false;
  await assert.rejects(loadBrand(api, true), error => error instanceof DOMException && error.name === 'AbortError');
});

test('uncertain generation replay preserves original overrides through reload and rejects corrupt preferences', async () => {
  const { pendingBatch, readBatch } = await import('../src/features/projects/generation-response.ts');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
  const original = { key: 'original-request', selection: { x_posts: 1 }, brand: { mode: 'saved' as const, overrides: { audience: '', voice: '', language: '', spelling: '' } } };
  pendingBatch(storage, 'one', 'project').save(original);
  assert.deepEqual(pendingBatch(storage, 'one', 'project').read(), original);
  assert.equal(pendingBatch(storage, 'two', 'project').read(), null);
  values.set('riflo:batch:one:project', JSON.stringify({ ...original, brand: { mode: 'none', overrides: { voice: 'conflict' } } }));
  assert.equal(pendingBatch(storage, 'one', 'project').read(), null);
  assert.equal(readBatch({ id: 'batch', status: 'completed', slots: [], brand: { status: 'unavailable' } }).brand?.status, 'unavailable');
  assert.throws(() => readBatch({ id: 'batch', status: 'completed', slots: [], brand: { status: 'unknown' } }));
});

test('explicit reopen refreshes a remote update and deduplicates overlapping refresh reads', async () => {
  let remote = { voice: 'Original' }, reads = 0;
  let release: (() => void) | undefined;
  const api = createApi({ getToken: async () => 'token', isCurrent: () => true }, async () => {
    reads++;
    if (reads > 1) await new Promise<void>(resolve => { release = resolve; });
    return Response.json({ data: remote });
  });
  assert.deepEqual(await loadBrand(api), { voice: 'Original' });
  remote = { voice: 'Changed elsewhere' };
  const first = loadBrand(api, true), second = loadBrand(api, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
  assert.equal(first, second);
  release!();
  assert.deepEqual(await first, { voice: 'Changed elsewhere' });
  assert.deepEqual(await loadBrand(api), { voice: 'Changed elsewhere' });
  assert.equal(reads, 2);
});

test('background settings refresh preserves edits and clears while updating untouched and hidden fields', async () => {
  const { rebaseBrandEdits } = await import('../src/features/brand/brand-response.ts');
  const previous = { audience: 'Teachers', voice: 'Direct', name: 'Before', writingExample: 'Old sample', colours: ['#123456'], fonts: ['Inter'] };
  const latest = { audience: 'Experts', voice: 'Warm', name: 'After', colours: ['#654321'], fonts: ['Lora'], description: 'Updated elsewhere' };
  const edits = { ...previous, audience: 'Beginners', voice: '' };
  assert.deepEqual(rebaseBrandEdits(previous, latest, edits), {
    audience: 'Beginners', voice: '', name: 'After', colours: ['#654321'], fonts: ['Lora'], description: 'Updated elsewhere',
  });
  assert.equal(previous.writingExample, 'Old sample');
  assert.equal(edits.voice, '');
});

test('refreshed profiles compare values rather than field insertion order', async () => {
  const { rebaseBrandEdits, sameBrandProfile } = await import('../src/features/brand/brand-response.ts');
  const previous = { avoidPhrases: [] };
  const latest = { audience: 'Teachers', voice: 'Direct', avoidPhrases: [], name: 'Updated' };
  assert.equal(sameBrandProfile(rebaseBrandEdits(previous, latest, previous), latest), true);
  assert.equal(sameBrandProfile({ ...latest, voice: '' }, latest), false);
  assert.equal(sameBrandProfile({ colours: ['#123456'] }, { colours: ['#654321'] }), false);
});


test('one-time writing preferences inherit absent and blank text fields while retaining explicit choice clears', () => {
  assert.equal(writingBrand('saved', {}), undefined);
  assert.equal(writingBrand('saved', {audience: '', voice: '   '}), undefined);
  assert.deepEqual(writingBrand('saved', {audience: ' Teachers ', voice: ' Direct '}), {mode: 'saved', overrides: {audience: 'Teachers', voice: 'Direct'}});
  assert.deepEqual(writingBrand('saved', {language: '', spelling: ''}), {mode: 'saved', overrides: {language: '', spelling: ''}});
  assert.deepEqual(writingBrand('saved', {language: 'Hindi', spelling: 'UK English'}), {mode: 'saved', overrides: {language: 'Hindi', spelling: 'UK English'}});
  assert.deepEqual(writingBrand('none', {voice: 'Direct', language: ''}), {mode: 'none'});
  const edits = {language: '', spelling: ''};
  delete (edits as {language?: string}).language;
  assert.deepEqual(writingBrand('saved', edits), {mode: 'saved', overrides: {spelling: ''}});
});
