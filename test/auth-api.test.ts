import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAuthConfig } from '../src/shared/auth/config.ts';
import { ApiError, createApi, errorMessage, restorationErrorMessage } from '../src/shared/api/client.ts';

const env = {
  VITE_FIREBASE_API_KEY: 'web-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'riflo.test',
  VITE_FIREBASE_PROJECT_ID: 'riflo',
  VITE_FIREBASE_APP_ID: 'app-id',
};
const session = { getToken: async () => 'id-token', isCurrent: () => true };
const abortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

test('Firebase settings are required and emulator access stays local to development', () => {
  assert.equal(readAuthConfig(env, false).emulator, null);
  for (const key of Object.keys(env)) {
    for (const value of [undefined, '', '  ', 123]) {
      assert.throws(() => readAuthConfig({ ...env, [key]: value }, true));
    }
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const address = `http://${host}:9099`;
    assert.equal(readAuthConfig({ ...env, VITE_FIREBASE_AUTH_EMULATOR_URL: address }, true).emulator, address);
    assert.throws(() => readAuthConfig({ ...env, VITE_FIREBASE_AUTH_EMULATOR_URL: address }, false));
  }
  for (const address of ['http://example.com:9099', 'https://localhost:9099', 'http://localhost:9099/path', 'http://localhost:9099?x=1', 'http://localhost:9099#x', 'http://user:pass@localhost:9099', 'not a URL']) {
    assert.throws(() => readAuthConfig({ ...env, VITE_FIREBASE_AUTH_EMULATOR_URL: address }, true));
  }
});

test('API attaches the current bearer token and returns only the data envelope', async () => {
  const controller = new AbortController();
  const api = createApi(session, async (path, init) => {
    assert.equal(path, '/v1/projects');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer id-token');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.signal, controller.signal);
    return Response.json({ data: { id: 'project' }, metadata: 'ignored' });
  });
  assert.deepEqual(await api('/v1/projects', controller.signal), { id: 'project' });
});

test('unsafe paths cannot request a token or reach the network', async () => {
  const api = createApi({ getToken: async () => { assert.fail('token requested'); }, isCurrent: () => true }, async () => { assert.fail('network requested'); });
  for (const path of ['https://evil.test/v1/projects', '//evil.test/v1/projects', '/v2/projects', '/v1/../private', '/v1/%2e%2e/private', '/v1/projects?token=x', '/v1/projects#x', '/v1/']) {
    await assert.rejects(api(path), /Invalid API path/);
  }
});

test('account changes during token retrieval prevent the request', async () => {
  let current = true;
  const api = createApi({ getToken: async () => { current = false; return 'old-token'; }, isCurrent: () => current }, async () => { assert.fail('stale account reached network'); });
  await assert.rejects(api('/v1/projects'), abortError);
});

test('account changes while reading a response discard stale data', async () => {
  let current = true;
  let release!: () => void;
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const api = createApi({ ...session, isCurrent: () => current }, async () => ({
    ok: true,
    json: async () => { reading(); await pending; return { data: 'private old-account data' }; },
  } as Response));
  const request = api('/v1/projects');
  await started;
  current = false;
  release();
  await assert.rejects(request, abortError);
});

test('aborted calls stop before network and discard responses already in flight', async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(createApi(session, async () => { assert.fail('aborted request reached network'); })('/v1/projects', before.signal), abortError);
  const during = new AbortController();
  const api = createApi(session, async () => { during.abort(); return Response.json({ data: 'stale' }); });
  await assert.rejects(api('/v1/projects', during.signal), abortError);
});

test('invalid envelopes and unreadable JSON fail explicitly', async () => {
  for (const response of [Response.json({}), Response.json(null), new Response('not JSON')]) {
    await assert.rejects(createApi(session, async () => response)('/v1/projects'), (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === 'invalid_response');
  }
});

test('HTTP failures preserve status and error code without exposing server messages', async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(createApi(session, async () => Response.json({ error: { code: 'denied', message: 'private server detail' } }, { status }))('/v1/projects'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, 'denied');
      assert.doesNotMatch(error.message, /private server detail/);
      return true;
    });
  }
  await assert.rejects(createApi(session, async () => new Response('unavailable', { status: 503 }))('/v1/projects'), (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === 'request_failed');
  const offline = new TypeError('offline');
  await assert.rejects(createApi(session, async () => { throw offline; })('/v1/projects'), (error: unknown) => error === offline);
});


test('account response rejects missing or non-text status reasons before rendering', async () => {
  const { readAccountResponse } = await import('../src/features/account/account-response.ts');
  const connection = { configured: true, connected: false };
  for (const reason of [undefined, null, 3, {}, []]) {
    assert.throws(() => readAccountResponse({ subscription: { active: false, reason }, features: {} }, connection), /unexpected account details/);
  }
  const capabilities = { subscription: { active: false, reason: 'subscription_expired', expiresAt: null }, features: {}, limits: null };
  assert.deepEqual(readAccountResponse(capabilities, connection), { capabilities, connection });
});

test('source availability follows backend flags and older responses enable only configured Drive', async () => {
  const {readAccountResponse, sourceAvailability} = await import('../src/features/account/account-response.ts');
  const capabilities = {subscription: {active: true, reason: 'active', expiresAt: null}, features: {}, limits: {}, services: {drive: {configured: true}, intake: {configured: true}, generation: {configured: false}}};
  const connection = {configured: true, connected: true};
  assert.deepEqual(sourceAvailability(readAccountResponse(capabilities, connection).capabilities), {drive: {configured: true}, youtube: {configured: false}});
  const sources = {drive: {configured: false}, youtube: {configured: true}};
  assert.deepEqual(sourceAvailability(readAccountResponse({...capabilities, services: {...capabilities.services, sources}}, connection).capabilities), sources);
  for (const malformed of [null, {}, {drive: {configured: false}}, {drive: {configured: 'yes'}, youtube: {configured: true}}]) {
    assert.throws(() => readAccountResponse({...capabilities, services: {...capabilities.services, sources: malformed}}, connection));
  }
});

test('workspace capabilities remain valid independently of unavailable or malformed Drive status', async () => {
  const {readCapabilities, readConnection} = await import('../src/features/account/account-response.ts');
  const capabilities = {subscription: {active: true, reason: 'active', expiresAt: null}, features: {}, limits: {}};
  assert.deepEqual(readCapabilities(capabilities), capabilities);
  for (const connection of [undefined, null, {}, {configured: true, connected: 'unknown'}, {configured: 'yes', connected: true}]) {
    assert.throws(() => readConnection(connection));
    assert.deepEqual(readCapabilities(capabilities), capabilities);
  }
  assert.deepEqual(readConnection({configured: false, connected: false}), {configured: false, connected: false});
  assert.deepEqual(readConnection({configured: true, connected: true}), {configured: true, connected: true});
});


test('display snapshots are account-instance scoped, validated and never replace fresh reads', async () => {
  let current = true;
  let calls = 0;
  let failure = false;
  const api = createApi({...session, isCurrent: () => current}, async () => {
    calls++;
    return failure ? Response.json({error: {code: 'unavailable'}}, {status: 503}) : Response.json({data: {count: calls}});
  });
  const parse = (value: unknown) => { assert.ok(value && typeof value === 'object' && 'count' in value); return value; };
  assert.equal(api.snapshot('/v1/projects', parse), null);
  await api('/v1/projects');
  assert.deepEqual(api.snapshot('/v1/projects', parse), {count: 1});
  await api('/v1/projects');
  assert.deepEqual(api.snapshot('/v1/projects', parse), {count: 2});
  failure = true;
  await assert.rejects(api('/v1/projects'));
  assert.deepEqual(api.snapshot('/v1/projects', parse), {count: 2});
  assert.equal(api.snapshot('/v1/projects', () => { throw Error('malformed'); }), null);
  failure = false;
  await api('/v1/projects');
  const another = createApi(session);
  assert.equal(another.snapshot('/v1/projects', parse), null);
  current = false;
  assert.equal(api.snapshot('/v1/projects', parse), null);
});

test('older reads and reads spanning mutations cannot overwrite display snapshots', async () => {
  const replies: Array<(value: Response) => void> = [];
  const api = createApi(session, () => new Promise(resolve => replies.push(resolve)));
  const first = api('/v1/projects');
  const second = api('/v1/projects');
  await new Promise(resolve => setImmediate(resolve));
  replies[1](Response.json({data: 'newer'})); await second;
  replies[0](Response.json({data: 'older'})); await first;
  assert.equal(api.snapshot('/v1/projects', String), 'newer');
  const stale = api('/v1/projects');
  const mutation = api('/v1/drive/connection', undefined, {method: 'DELETE'});
  await new Promise(resolve => setImmediate(resolve));
  replies[3](Response.json({data: {connected: false}})); await mutation;
  replies[2](Response.json({data: 'before-disconnect'})); await stale;
  assert.equal(api.snapshot('/v1/projects', String), null);
});

test('access denials remove previous display snapshots', async () => {
  let status = 200;
  const api = createApi(session, async () => Response.json(status === 200 ? {data: 'private'} : {error: {code: 'denied'}}, {status}));
  for (const denied of [401, 403, 404]) {
    status = 200; await api('/v1/projects');
    assert.equal(api.snapshot('/v1/projects', String), 'private');
    status = denied; await assert.rejects(api('/v1/projects'));
    assert.equal(api.snapshot('/v1/projects', String), null);
  }
});


test('denied read invalidates sibling snapshots and prevents in-flight siblings restoring access', async () => {
  const replies: Array<(value: Response) => void> = [];
  const api = createApi(session, () => new Promise(resolve => replies.push(resolve)));
  const saved = api('/v1/projects');
  await new Promise(resolve => setImmediate(resolve));
  replies[0](Response.json({data: 'saved'})); await saved;
  const denied = api('/v1/projects/example/outputs');
  const sibling = api('/v1/projects/example/generation');
  await new Promise(resolve => setImmediate(resolve));
  replies[1](Response.json({error: {code: 'denied'}}, {status: 403}));
  await assert.rejects(denied);
  replies[2](Response.json({data: 'stale sibling'})); await sibling;
  assert.equal(api.snapshot('/v1/projects', String), null);
  assert.equal(api.snapshot('/v1/projects/example/generation', String), null);
});


test('retry quota errors validate optional allowance and keep server text out of safe copy', async () => {
  const details = { requiredSeconds: 1025, remainingSeconds: 775 };
  const valid = [details, { requiredSeconds: 1025, remainingSeconds: 775.267967 }];
  for (const allowance of [...valid, undefined, null, [], {}, { ...details, remainingSeconds: '775' }, { ...details, requiredSeconds: -1 }, { ...details, remainingSeconds: Infinity }, { ...details, requiredSeconds: Number.MAX_SAFE_INTEGER + 1 }]) {
    const api = createApi(session, async () => new Response(JSON.stringify({ error: { code: 'allowance_exceeded', message: 'private server text', allowance } }), { status: 403 }));
    await assert.rejects(api('/v1/projects/failed_project/retry-import', undefined, { method: 'POST', key: 'quota-key' }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'allowance_exceeded');
      assert.deepEqual(error.allowance, valid.some(value => value === allowance) ? allowance : null);
      assert.match(error.message, /source video allowance/);
      assert.doesNotMatch(error.message, /private server text|fewer outputs|No new import/);
      return true;
    });
  }
});


test('initial import quota names source allowance and accepts only safe optional amounts', async () => {
  for (const allowance of [{ requiredSeconds: 420, remainingSeconds: 180 }, undefined, { requiredSeconds: -1, remainingSeconds: 180 }]) {
    const api = createApi(session, async () => Response.json({ error: { code: 'allowance_exceeded', message: 'private server text', allowance } }, { status: 403 }));
    await assert.rejects(api('/v1/projects', undefined, { method: 'POST', key: 'first-import' }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /source video allowance/);
      assert.doesNotMatch(error.message, /fewer outputs|private server text|retry this import/);
      assert.deepEqual(error.allowance, allowance?.requiredSeconds === 420 ? allowance : null);
      return true;
    });
  }
});


test('transport failures are readable without hiding API or integrity errors', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    assert.match(errorMessage(new TypeError(message)), /couldn’t connect to Riflo/);
  }
  for (const error of [new Error('Unexpected source details.'), new TypeError('Invalid API path.'), new ApiError(403, 'allowance_exceeded', 'Not enough allowance.')]) {
    assert.equal(errorMessage(error), error.message);
  }
});

test('trial restrictions use safe recovery copy and the server retry delay across command and preflight paths', async () => {
  for (const path of ['/v1/sources/youtube/validate', '/v1/drive/picker-session', '/v1/projects', '/v1/projects/project_1/generate', '/v1/projects/project_1/retry-transcription']) {
    for (const [status, code, expected] of [[403, 'trial_identity_required', /verified Google account/], [403, 'trial_already_used', /already used its trial/], [403, 'trial_work_limited', /processing request limit/], [429, 'trial_rate_limited', /Too many trial requests/], [503, 'trial_not_configured', /awaiting setup/]] as const) {
      const api = createApi(session, async () => Response.json({ error: { code, message: 'private provider details' } }, { status, headers: { 'Retry-After': '37' } }));
      await assert.rejects(api(path, undefined, path.endsWith('picker-session') ? undefined : { method: 'POST', key: 'trial-request' }), (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.match(errorMessage(error), expected);
        assert.doesNotMatch(errorMessage(error), /private provider/);
        assert.equal(error.retryAfterSeconds, 37);
        if (code === 'trial_rate_limited') assert.match(errorMessage(error), /Try again in 37 seconds\./);
        else assert.doesNotMatch(errorMessage(error), /37 seconds/);
        return true;
      });
    }
  }
  for (const delay of [null, 0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(errorMessage(new ApiError(429, 'trial_rate_limited', 'Please wait.', delay)), 'Please wait.');
  }
  assert.equal(errorMessage(new ApiError(429, 'trial_rate_limited', 'Please wait.', 1)), 'Please wait. Try again in 1 second.');
});


test('source limits accept backend-selected tiers and reject incomplete or unsafe bounds', async () => {
  const {readCapabilities} = await import('../src/features/account/account-response.ts');
  const base = {subscription:{active:true,reason:'active',expiresAt:null},features:{},limits:{}};
  for (const [maxSourceSeconds,maxSourceBytes] of [[1800,3e9],[2700,5e9],[3600,6e9],[1800,2*1024**3]]) {
    const operationalLimits={maxSourceSeconds,maxSourceBytes,maxQueuedProjects:2};
    assert.deepEqual(readCapabilities({...base,operationalLimits}).operationalLimits, operationalLimits);
  }
  assert.equal(readCapabilities(base).operationalLimits,undefined,'old responses may omit the optional limits');
  for (const operationalLimits of [{},{maxSourceSeconds:1800},{maxSourceSeconds:0,maxSourceBytes:3e9},{maxSourceSeconds:1800,maxSourceBytes:0},{maxSourceSeconds:NaN,maxSourceBytes:3e9},{maxSourceSeconds:1800,maxSourceBytes:Infinity},{maxSourceSeconds:1800.5,maxSourceBytes:3e9},{maxSourceSeconds:1800,maxSourceBytes:Number.MAX_SAFE_INTEGER+1},{maxSourceSeconds:1800,maxSourceBytes:'3000000000'}]) {
    assert.throws(()=>readCapabilities({...base,operationalLimits}));
  }
});


test('restoration provider failures retain the same recovery guidance for immediate and terminal errors', async () => {
  const cases = [
    [422, 'youtube_verification_required', /^YouTube could not verify access to this video\. Riflo could not import it\.$/],
    [422, 'youtube_video_restricted', /public or unlisted/],
    [422, 'youtube_video_unavailable', /Check the link or choose another video/],
    [502, 'youtube_download_failed', /^YouTube could not provide this video to Riflo\.$/],
    [404, 'drive_file_unavailable', /Check its access or choose another video/],
    [409, 'drive_reconnect_required', /Reconnect Google Drive.*Picker/],
    [409, 'stale_connection', /Refresh its status/],
    [422, 'unsupported_video', /downloadable video outside the trash/],
    [422, 'source_too_large', /exceeds your source limits/],
    [422, 'source_too_long', /exceeds your source limits/],
  ] as const;
  for (const [status, code, expected] of cases) {
    const api = createApi(session, async () => Response.json({ error: { code } }, { status }));
    await assert.rejects(api.submit('/v1/projects/project/restore-source', new AbortController().signal, { key: 'restore-key' }, () => assert.fail('not accepted')), error => {
      assert.ok(error instanceof ApiError);
      const terminal = restorationErrorMessage(code);
      assert.match(terminal, expected);
      assert.equal(terminal, errorMessage(error));
      return true;
    });
  }
});

test('terminal restoration allowance failure gives usage guidance without replacing immediate source allowance details', async () => {
  assert.equal(restorationErrorMessage('allowance_exceeded'), 'Restoration could not finish because source video allowance was unavailable. Check usage and available source-processing minutes before trying again.');
  for (const [path, action] of [
    ['/v1/projects', 'import this video'],
    ['/v1/projects/project/retry-import', 'retry this import'],
    ['/v1/projects/project/restore-source', 'restore this source'],
  ]) {
    const allowance = { requiredSeconds: 120, remainingSeconds: 60 };
    const api = createApi(session, async () => Response.json({ error: { code: 'allowance_exceeded', allowance } }, { status: 403 }));
    await assert.rejects(api(path, undefined, { method: 'POST', key: 'allowance-key' }), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(errorMessage(error), `Not enough source video allowance remains to ${action}. Other imported videos may have allowance reserved.`);
      assert.deepEqual(error.allowance, allowance);
      return true;
    });
  }
  assert.equal(restorationErrorMessage('unknown_failure'), 'Restoration could not finish. Check the original video and try again when available.');
});

test('configured HTTPS API origin applies to JSON, progress and protected downloads', async () => {
  const calls: string[] = [];
  const origin = 'https://203.0.113.10';
  const api = createApi({getToken: async () => 'fixture-token', isCurrent: () => true}, async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token');
    assert.equal(init?.credentials, 'same-origin');
    if (new Headers(init?.headers).get('Accept') === 'text/event-stream') return new Response(': heartbeat\n\n', {headers: {'Content-Type': 'text/event-stream'}});
    return String(input).endsWith('/download') ? new Response('image', {headers: {'Content-Type': 'image/png'}}) : Response.json({data: {}});
  }, origin);
  await api('/v1/capabilities');
  await api.stream('/v1/projects/p/operations/import/o/events', new AbortController().signal, () => {});
  await api.blob('/v1/projects/p/outputs/o/download', 'image/png');
  assert.deepEqual(calls, [origin + '/v1/capabilities', origin + '/v1/projects/p/operations/import/o/events', origin + '/v1/projects/p/outputs/o/download']);
  for (const value of ['http://example.com', 'https://example.com/', 'https://example.com/path']) assert.throws(() => createApi({getToken: async () => '', isCurrent: () => true}, fetch, value));
});
