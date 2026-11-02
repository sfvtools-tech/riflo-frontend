import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Execute the actual source-expiry hook with React's dependency comparison.
// No DOM is needed: this regression concerns rearming after the native timer cap.
const source = readFileSync(new URL('../src/features/projects/LiveProjectDetail.tsx', import.meta.url), 'utf8');
const hook = source.match(/useEffect\(\(\) => \{\s*if \(!project\?\.sourceExpiresAt[\s\S]*?\}, \[[^\]]*\]\);/)?.[0];
assert.ok(hook, 'source-expiry effect must be exercised');
const runHook = new Function('project', 'attempt', 'setAttempt', 'useEffect', 'Date', 'setTimeout', 'clearTimeout', hook);

test('paid source expiry rearms capped timers when canonical reads return unchanged dates', () => {
  const cap = 2_147_483_647;
  const start = Date.parse('2026-10-01T00:00:00Z');
  const expires = start + 60 * 86_400_000;
  let now = start;
  let attempt = 0;
  let previous: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  let serial = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const project = { status: 'source_ready', sourceExpiresAt: new Date(expires).toISOString() };
  const render = () => runHook(project, attempt, (update: (value: number) => number) => {
    attempt = update(attempt);
    // A canonical reload has the same status and expiry until actual expiry.
    render();
  }, (effect: () => (() => void) | undefined, dependencies: unknown[]) => {
    if (previous && dependencies.every((value, index) => Object.is(value, previous![index]))) return;
    cleanup?.();
    previous = dependencies;
    cleanup = effect();
  }, { now: () => now, parse: Date.parse }, (callback: () => void, delay: number) => {
    const id = ++serial;
    timers.set(id, { at: now + delay, callback });
    return id;
  }, (id: number) => timers.delete(id));
  render();
  const fireNext = () => {
    const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(entry, 'a future source refresh must remain scheduled');
    timers.delete(entry[0]);
    now = entry[1].at;
    entry[1].callback();
  };
  fireNext();
  assert.equal(now, start + cap);
  assert.equal(attempt, 1);
  assert.equal(timers.size, 1, 'refreshing the same canonical project must rearm the remaining source deadline');
  fireNext();
  fireNext();
  assert.equal(now, expires + 50);
  assert.equal(attempt, 3, 'the actual expiry boundary must trigger a canonical project refresh');
  cleanup?.();
});
