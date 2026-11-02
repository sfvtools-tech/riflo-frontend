import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLifecycle } from '../src/features/account/lifecycle-response.ts';
import { readCapabilities, intakeAvailable } from '../src/features/account/account-response.ts';
import { readUsage } from '../src/features/account/usage-response.ts';
import { accessMessage } from '../src/features/account/access-message.ts';
import { formats, readAvailability } from '../src/features/projects/generation-response.ts';

const lifecycle = {
  trial: { state: 'active', startsAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z' },
  paid: { state: 'active', plan: 'lower', startsAt: '2026-10-03T00:00:00Z', expiresAt: '2026-11-03T00:00:00Z', cancelAtPeriodEnd: true, nextPlan: null },
  nextChangeAt: '2026-10-08T00:00:00Z',
};
const counts = { sourceSeconds: 2700, creationCredits: 15 };
const period = { kind: 'trial', active: true, accounting: { mode: 'shared_credits', periodId: 'trial_period_1' }, startsAt: lifecycle.trial.startsAt, expiresAt: lifecycle.trial.expiresAt, limits: counts, consumed: {sourceSeconds: 0, creationCredits: 0}, reserved: {sourceSeconds: 0, creationCredits: 0}, remaining: counts };
const usage = { ...period, accounting: { mode: 'shared_credits' }, lifecycle, periods: [period] };

test('lifecycle usage preserves separate trial/paid owners and supports unstarted read-only usage', () => {
  const paid = {...period, kind: 'paid', accounting: {...period.accounting, periodId: 'paid_period_1'}, startsAt: lifecycle.paid.startsAt, expiresAt: lifecycle.paid.expiresAt};
  assert.deepEqual(readUsage({...usage, periods: [period, paid]}).periods, [period, paid]);
  assert.equal(readUsage({...usage, startsAt: null, expiresAt: null, periods: [], lifecycle: {...lifecycle, trial: {state: 'eligible', startsAt: null, expiresAt: null}}}).startsAt, null);
  for (const periods of [[period, period], [{...period, active: undefined}], [{...period, accounting: {mode: 'shared_credits'}}], [{...period, remaining: {...counts, sourceSeconds: 0.5}}]]) assert.throws(() => readUsage({...usage, periods}));
  assert.throws(() => readUsage({...usage, lifecycle: undefined}));
  assert.throws(() => readLifecycle({...lifecycle, paid: {...lifecycle.paid, cancelAtPeriodEnd: 'yes'}}));
  assert.throws(() => readLifecycle({...lifecycle, trial: {...lifecycle.trial, expiresAt: null}}));
});

test('eligible facts never bypass the explicit runtime intake gate or start a trial', () => {
  const eligible = {...lifecycle, trial: {state: 'eligible', startsAt: null, expiresAt: null}};
  const capability = { lifecycle: eligible, intake: {available: false, reason: 'trial_activation_disabled'}, subscription: {active: false, reason: 'subscription_required', expiresAt: null}, features: {}, limits: null };
  assert.equal(intakeAvailable(readCapabilities(capability)), false);
  assert.equal(intakeAvailable(readCapabilities({...capability, intake: {available: true, reason: 'trial_eligible'}})), true);
  assert.equal(accessMessage(capability.subscription, readLifecycle(eligible))?.label, 'Trial not started');
  assert.match(accessMessage(capability.subscription, readLifecycle(eligible))!.detail, /including an import that fails/);
  assert.equal(intakeAvailable({...capability, intake: undefined}), false);
  assert.throws(() => readCapabilities({...capability, intake: {available: 'true', reason: 'trial_eligible'}}));
});

test('project availability carries the trial deadline while paid effective access remains active', () => {
  const value = { lifecycle, access: {active: true, reason: 'active', expiresAt: lifecycle.paid.expiresAt}, preferences: {languages: ['English'], limits: {audience: 100, voice: 100, language: 80, spelling: 80}}, sourceAvailable: true, transcriptAvailable: true, sourceExpiresAt: null, transcriptExpiresAt: null, activeBatch: false, outputs: Object.fromEntries(formats.map(([key]) => [key, {available: true, reason: 'available'}])) };
  assert.equal(readAvailability(value).lifecycle?.nextChangeAt, lifecycle.trial.expiresAt);
  assert.throws(() => readAvailability({...value, lifecycle: {...lifecycle, nextChangeAt: 'broken'}}));
});

test('lifecycle states preserve backend authority and historical separate meters', () => {
  const zero = {sourceSeconds: 0, creationCredits: 0};
  const none = {state: 'none', plan: null, startsAt: null, expiresAt: null, cancelAtPeriodEnd: false, nextPlan: null};
  const unavailable = {state: 'unavailable', startsAt: null, expiresAt: null};
  for (const [trialState, paidState, active] of [
    ['active', 'none', true], ['unavailable', 'active', true], ['active', 'active', true],
    ['expired', 'expired', false], ['unavailable', 'withdrawn', false], ['unavailable', 'scheduled', false],
  ] as const) {
    const trial = trialState === 'unavailable' ? unavailable : {...lifecycle.trial, state: trialState};
    const paid = paidState === 'none' ? none : {...lifecycle.paid, state: paidState};
    const facts = {trial, paid, nextChangeAt: null};
    const periods = [
      ...(trialState === 'unavailable' ? [] : [{...period, active: trialState === 'active', remaining: trialState === 'active' ? counts : zero}]),
      ...(paidState === 'none' ? [] : [{...period, kind: 'paid', active: paidState === 'active', accounting: {...period.accounting, periodId: 'paid_period_1'}, remaining: paidState === 'active' ? counts : zero}]),
    ];
    const result = readUsage({...usage, lifecycle: facts, periods});
    assert.deepEqual(result.periods, periods);
    assert.equal(accessMessage({active, reason: paidState === 'withdrawn' ? 'invalid_subscription' : 'subscription_expired', expiresAt: paid.expiresAt}, readLifecycle(facts)) === null, active);
  }
});

test('malformed lifecycle containers, states, plans, boundaries and nested periods fail closed', () => {
  for (const value of [null, [], {}, {...lifecycle, trial: null}, {...lifecycle, paid: []}, {...lifecycle, trial: {...lifecycle.trial, state: 'ready'}}, {...lifecycle, paid: {...lifecycle.paid, state: 'cancelled'}}, {...lifecycle, paid: {...lifecycle.paid, plan: 'premium'}}, {...lifecycle, paid: {...lifecycle.paid, nextPlan: 'premium'}}, {...lifecycle, nextChangeAt: undefined}, {...lifecycle, nextChangeAt: 'not-a-date'}, {...lifecycle, trial: {...lifecycle.trial, startsAt: lifecycle.trial.expiresAt}}, {...lifecycle, paid: {...lifecycle.paid, startsAt: lifecycle.paid.expiresAt}}]) assert.throws(() => readLifecycle(value));
  for (const invalid of [{...period, lifecycle}, {...period, periods: []}, {...period, kind: 'manual'}, {...period, accounting: {...period.accounting, periodId: 'x'}}, {...period, consumed: {...counts, creationCredits: 0.5}}, {...period, reserved: {...counts, sourceSeconds: Infinity}}]) assert.throws(() => readUsage({...usage, periods: [invalid]}));
});

test('lifecycle states and period kinds reject coercible non-string JSON values', () => {
  for (const state of [['active'], [['active']], {}, 1, null, false]) {
    for (const owner of ['trial', 'paid'] as const) {
      assert.throws(() => readLifecycle({...lifecycle, [owner]: {...lifecycle[owner], state}}));
    }
  }
  for (const kind of [['trial'], [['trial']], {}, 1, null, false]) {
    assert.throws(() => readUsage({...usage, periods: [{...period, kind}]}));
  }
  for (const kind of ['trial', 'paid']) {
    const first = {...period, kind};
    const second = {...period, kind, accounting: {...period.accounting, periodId: 'other_period_1'}};
    assert.throws(() => readUsage({...usage, periods: [first, second]}));
    assert.throws(() => readUsage({...usage, periods: [{...first, kind: [kind]}, {...second, kind: [kind]}]}));
  }
});

test('all scalar lifecycle states and plans remain valid', () => {
  for (const state of ['eligible', 'active', 'expired', 'unavailable']) {
    assert.equal(readLifecycle({...lifecycle, trial: {...lifecycle.trial, state}}).trial.state, state);
  }
  for (const state of ['none', 'scheduled', 'active', 'expired', 'withdrawn']) {
    assert.equal(readLifecycle({...lifecycle, paid: {...lifecycle.paid, state}}).paid.state, state);
  }
  for (const plan of [null, 'lower', 'higher']) {
    const result = readLifecycle({...lifecycle, paid: {...lifecycle.paid, plan, nextPlan: plan}});
    assert.equal(result.paid.plan, plan);
    assert.equal(result.paid.nextPlan, plan);
  }
});

test('trial and paid usage snapshots never cross account changes or accept late old-account reads', async () => {
  const {createApi} = await import('../src/shared/api/client.ts');
  let current = true;
  let release!: (value: Response) => void;
  let held = false;
  const api = createApi({getToken: async () => 'fixture-token', isCurrent: () => current}, async () => held ? new Promise<Response>(resolve => {release = resolve;}) : Response.json({data: usage}));
  await api('/v1/usage');
  assert.deepEqual(api.snapshot('/v1/usage', readUsage)?.periods, [period]);
  const other = createApi({getToken: async () => 'other-fixture-token', isCurrent: () => true}, async () => Response.json({data: {...usage, periods: []}}));
  assert.equal(other.snapshot('/v1/usage', readUsage), null);
  held = true;
  const late = api('/v1/usage');
  await new Promise(resolve => setImmediate(resolve));
  current = false;
  assert.equal(api.snapshot('/v1/usage', readUsage), null);
  release(Response.json({data: usage}));
  await assert.rejects(late, (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError');
  assert.equal(api.snapshot('/v1/usage', readUsage), null);
  await other('/v1/usage');
  assert.deepEqual(other.snapshot('/v1/usage', readUsage)?.periods, []);
});

test('lifecycle boundaries reject normalized calendar dates and require UTC ISO timestamps', () => {
  for (const invalid of ['2026-02-30T00:00:00Z', '2026-02-30T00:00:00.000Z', '2026-10-01', '2026-10-01T00:00:00', '2026-10-01T00:00:00+00:00']) {
    for (const owner of ['trial', 'paid'] as const) {
      assert.throws(() => readLifecycle({...lifecycle, [owner]: {...lifecycle[owner], startsAt: invalid}}));
      assert.throws(() => readLifecycle({...lifecycle, [owner]: {...lifecycle[owner], expiresAt: invalid}}));
    }
    assert.throws(() => readLifecycle({...lifecycle, nextChangeAt: invalid}));
  }
  for (const valid of ['2026-10-08T00:00:00Z', '2026-10-08T00:00:00.123Z']) assert.equal(readLifecycle({...lifecycle, nextChangeAt: valid}).nextChangeAt, valid);
});
