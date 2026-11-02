import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retentionRefreshDelay } from '../src/features/projects/retention.ts';

test('retention refresh uses the next finite future boundary and rearms long deadlines', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  assert.equal(retentionRefreshDelay([null, undefined, 'invalid', new Date(now).toISOString()], now), null);
  assert.equal(retentionRefreshDelay([new Date(now + 500).toISOString(), new Date(now + 100).toISOString()], now), 150);
  const deadline = new Date(now + 60 * 86400000).toISOString();
  assert.equal(retentionRefreshDelay([deadline], now), 2_147_483_647);
  assert.equal(retentionRefreshDelay([deadline], now + 2_147_483_647), 2_147_483_647);
  assert.equal(retentionRefreshDelay([deadline], Date.parse(deadline) - 100), 150);
});
