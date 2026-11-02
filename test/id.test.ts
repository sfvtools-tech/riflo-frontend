import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingImport } from '../src/features/projects/pending-import.ts';
import { pendingBatch } from '../src/features/projects/generation-response.ts';
import { pendingRetry } from '../src/features/projects/pending-retry.ts';
import { createId } from '../src/shared/lib/id.ts';

const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('IDs are UUID v7 and remain unique within one clock tick', (context) => {
  context.mock.method(Date, 'now', () => 1_792_000_000_000);
  const ids = Array.from({ length: 1_000 }, () => createId());
  assert.ok(ids.every(id => uuid7.test(id)));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ids);
});


test('pending UUID v4 requests retain their original keys and payloads', () => {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } as Storage;
  const key = 'b947fda8-02de-4a56-88de-3a3bcb71cf72';
  const imported = { key, input: { source: 'youtube' as const, videoId: 'abcdefghijk' }, details: null };
  pendingImport(storage, 'user').save(imported);
  assert.deepEqual(pendingImport(storage, 'user').read(), imported);
  const generated = { key, selection: { x_posts: 2 }, brand: { mode: 'none' as const } };
  pendingBatch(storage, 'user', 'project').save(generated);
  assert.deepEqual(pendingBatch(storage, 'user', 'project').read(), generated);
  for (const kind of ['import', 'transcription'] as const) {
    pendingRetry(storage, 'user', 'project', kind).save(key);
    assert.equal(pendingRetry(storage, 'user', 'project', kind).read(), key);
  }
});
