import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readUsage, usageLabels } from '../src/features/account/usage-response.ts';
import { readCapabilities } from '../src/features/account/account-response.ts';
import { formats, readAvailability } from '../src/features/projects/generation-response.ts';

const costs = Object.fromEntries(formats.map(([key]) => [key, key === 'short_videos' ? 4 : key === 'carousels' ? 2 : 1]));
const accounting = { mode: 'shared_credits', periodId: 'paid_period_1' };
const usage = {
  accounting, startsAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z',
  limits: { sourceSeconds: 18000, creationCredits: 120 },
  consumed: { sourceSeconds: 70.5, creationCredits: 5 },
  reserved: { sourceSeconds: 60, creationCredits: 4 },
  remaining: { sourceSeconds: 17869.5, creationCredits: 111 },
};

test('shared usage displays its two backend meters without manufacturing format quotas', () => {
  const saved = readUsage(usage);
  assert.deepEqual(saved, usage);
  assert.deepEqual(usageLabels(saved), [['sourceSeconds', 'Source video'], ['creationCredits', 'Creation credits']]);
  for (const change of [null, { mode: 'unknown', periodId: 'paid_period_1' }, { ...accounting, periodId: '../foreign' }, { ...accounting, periodId: 'short' }]) {
    assert.throws(() => readUsage({ ...usage, accounting: change }));
  }
  for (const field of ['limits', 'consumed', 'reserved', 'remaining'] as const) {
    for (const value of [undefined, -1, 1.5, Infinity, '120']) {
      assert.throws(() => readUsage({ ...usage, [field]: { ...usage[field], creationCredits: value } }));
    }
  }
});

test('shared capabilities preserve server prices and reject incomplete accounting', () => {
  const capability = { accounting: { ...accounting, creditCosts: costs }, subscription: { active: true, reason: 'active', expiresAt: usage.expiresAt }, features: {}, limits: usage.limits };
  assert.deepEqual(readCapabilities(capability), capability);
  assert.deepEqual(readCapabilities({ ...capability, limits: null }).accounting, capability.accounting);
  for (const accounting of [null, {}, { ...capability.accounting, creditCosts: { ...costs, short_videos: 0 } }, { ...capability.accounting, creditCosts: {} }]) {
    assert.throws(() => readCapabilities({ ...capability, accounting }));
  }
  assert.throws(() => readCapabilities({ ...capability, limits: { sourceSeconds: 18000 } }));
});

test('project availability validates shared balances and all six configurable costs', () => {
  const availability = {
    access: { active: true, reason: 'active', expiresAt: usage.expiresAt },
    preferences: { languages: ['English'], limits: { audience: 100, voice: 100, language: 80, spelling: 80 } },
    sourceAvailable: true, transcriptAvailable: true, sourceExpiresAt: null, transcriptExpiresAt: null, activeBatch: false,
    outputs: Object.fromEntries(formats.map(([key]) => [key, { available: true, reason: 'available' }])),
    credits: { remaining: 3, costs },
  };
  assert.deepEqual(readAvailability(availability).credits, availability.credits);
  for (const credits of [null, { remaining: -1, costs }, { remaining: 1.5, costs }, { remaining: 3, costs: {} }, { remaining: 3, costs: { ...costs, carousels: 1.5 } }]) {
    assert.throws(() => readAvailability({ ...availability, credits }));
  }
});
