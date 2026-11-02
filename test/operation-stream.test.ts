import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApi, errorMessage, type StudioApi } from "../src/shared/api/client.ts";
import { consumeOperation, type Operation, type OperationEvent } from "../src/shared/api/operation-stream.ts";
import { observeOperation } from "../src/features/projects/observe-operation.ts";
import { pendingBatch } from "../src/features/projects/generation-response.ts";
import { pendingRetry } from "../src/features/projects/pending-retry.ts";

const session = { getToken: async () => "token", isCurrent: () => true };
const operation: Operation = { projectId: "project", kind: "generation", id: "batch" };
const frame = (event: string, op = operation, extra: object = {}) => `event: ${event}\ndata: ${JSON.stringify({ version: 1, operation: op, ...extra })}\n\n`;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function connection(signal?: AbortSignal) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; }, cancel() { cancelled = true; } });
  signal?.addEventListener("abort", () => { if (!cancelled) { cancelled = true; source.error(new DOMException("Aborted", "AbortError")); } }, { once: true });
  return { response: new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }),
    send(value: string) { source.enqueue(new TextEncoder().encode(value)); },
    close() { source.close(); }, get cancelled() { return cancelled; } };
}

test("SSE consumes byte-fragmented UTF-8, multiline JSON, CR/LF, comments and multiple frames without dispatching incomplete EOF", async () => {
  const raw = `\uFEFF: heartbeat\r\nevent: changed\rdata: {"version":1,\r\ndata: "operation":${JSON.stringify(operation)},"label":"नमस्ते"}\r\n\r\n` + frame("terminal") + 'event: accepted\ndata: {"version":1';
  const bytes = new TextEncoder().encode(raw);
  const seen: OperationEvent[] = [];
  let checks = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  await consumeOperation(new Response(body, { headers: { "content-type": "text/event-stream" } }), event => seen.push(event), () => { checks++; });
  assert.deepEqual(seen.map(event => event.event), ["changed", "terminal"]);
  assert.deepEqual(seen[0].operation, operation);
  assert.ok(checks > 100);
});

test("malformed event envelopes and unbounded unfinished frames fail safely and release body", async () => {
  for (const value of ['event: changed\ndata: nope\n\n', frame("changed", { ...operation, projectId: "../private" }), "data: " + "x".repeat(70_000)]) {
    const stream = connection();
    stream.send(value); stream.close();
    await assert.rejects(consumeOperation(stream.response, () => assert.fail("bad event delivered"), () => {}));
  }
});

test("generation accepted resolves before EOF and shares its healthy POST, with operation identities fenced by project", async () => {
  const connections: ReturnType<typeof connection>[] = [];
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = createApi(session, async (path, init) => {
    calls.push({ path: String(path), init });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
    assert.equal(new Headers(init?.headers).get("Accept"), "text/event-stream");
    const stream = connection(init?.signal ?? undefined); connections.push(stream); return stream.response;
  });
  const command = new AbortController();
  let accepted = false;
  const submitted = api.submit("/v1/projects/project/generate", command.signal, { key: "original-key", body: { outputs: { blogs: 1 } } }, () => { accepted = true; }, true);
  await flush(); connections[0].send(frame("accepted")); await submitted;
  assert.equal(accepted, true); assert.equal(connections[0].cancelled, false);
  const observer = new AbortController(); const events: string[] = [];
  const watching = api.stream("/v1/projects/project/operations/generation/batch/events", observer.signal, event => events.push(event.event));
  await flush(); assert.equal(calls.length, 1);
  connections[0].send(frame("changed")); await flush(); assert.deepEqual(events, ["accepted", "changed"]);
  const other = new AbortController();
  const foreign = api.stream("/v1/projects/other/operations/generation/batch/events", other.signal, () => {});
  await flush(); assert.equal(calls.length, 2); assert.equal(calls[1].init?.method, "GET");
  connections[1].close(); await foreign;
  connections[0].send(frame("terminal")); await watching;
  assert.equal(connections[0].cancelled, true);
  const returned = api.stream("/v1/projects/project/operations/generation/batch/events", observer.signal, () => {});
  await flush(); assert.equal(calls.length, 3); connections[2].close(); await returned;
});

test("accepted import closes immediately, superseded replay resolves identity, and unknown acceptance preserves exact command", async () => {
  const op: Operation = { projectId: "project", kind: "import", id: "import-id" };
  let stream!: ReturnType<typeof connection>;
  const api = createApi(session, async (_path, init) => { stream = connection(init?.signal ?? undefined); return stream.response; });
  const accepted = api.submit("/v1/projects", new AbortController().signal, { key: "same-key", body: { fileId: "source" } }, value => assert.deepEqual(value, op));
  await flush(); stream.send(frame("accepted", op)); await accepted; await flush(); assert.equal(stream.cancelled, true);
  const superseded = createApi(session, async () => Response.json({ error: { code: "operation_superseded", accepted: true, operation: op } }, { status: 409 }));
  assert.deepEqual(await superseded.submit("/v1/projects", new AbortController().signal, { key: "same-key" }, () => {}), op);
  const payloads: string[] = [];
  const lost = createApi(session, async (_path, init) => { payloads.push(String(init?.body)); assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "same-key"); throw new TypeError("Offline"); });
  for (let i = 0; i < 2; i++) await assert.rejects(lost.submit("/v1/projects", new AbortController().signal, { key: "same-key", body: { fileId: "source" } }, () => assert.fail("unaccepted")));
  assert.equal(payloads.length, 2); assert.equal(payloads[0], payloads[1]);
});

test("stream authentication, abort and account fences reject before old-account events are delivered", async () => {
  let current = true; let token = 0; let stream!: ReturnType<typeof connection>;
  const api = createApi({ getToken: async () => `token-${++token}`, isCurrent: () => current }, async (_path, init) => { stream = connection(init?.signal ?? undefined); return stream.response; });
  const watching = api.stream("/v1/projects/project/operations/generation/batch/events", new AbortController().signal, () => assert.fail("old account event"));
  await flush(); current = false; stream.send(frame("changed"));
  await assert.rejects(watching, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(stream.cancelled, true);
  await assert.rejects(api.submit("/v1/projects/project/generate", new AbortController().signal, { key: "saved-key" }, () => assert.fail("old account accepted")), error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(token, 2);
});

function fakeObserver() {
  const listeners: ((event: OperationEvent) => void)[] = [];
  const signals: AbortSignal[] = [];
  const failures: ((error: unknown) => void)[] = [];
  const api = Object.assign(async () => null, { stream: (_path: string, signal: AbortSignal, notify: (event: OperationEvent) => void) => {
    listeners.push(notify); signals.push(signal);
    return new Promise<void>((resolve, reject) => { failures.push(reject); signal.addEventListener("abort", () => resolve(), { once: true }); });
  } }) as unknown as StudioApi;
  return { api, listeners, signals, failures };
}

test("notifications during canonical reads coalesce and terminal read failures retry independently without reconnecting", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = fakeObserver(); let reads = 0; let release!: () => void; let failFinal = true;
  const errors: [unknown, boolean][] = [];
  const stop = observeOperation(mock.api, async signal => {
    reads++;
    if (reads === 2) await new Promise<void>(resolve => { release = resolve; });
    signal.throwIfAborted();
    if (reads === 4 && failFinal) { failFinal = false; throw new TypeError("Offline"); }
    return reads >= 5 ? null : operation;
  }, (error, retrying) => errors.push([error, retrying]));
  await flush(); assert.equal(mock.listeners.length, 1);
  mock.listeners[0]({ event: "changed", operation }); await flush(); assert.equal(reads, 2);
  for (let i = 0; i < 5; i++) mock.listeners[0]({ event: "changed", operation });
  release(); await flush(); assert.equal(reads, 3);
  mock.listeners[0]({ event: "terminal", operation }); await flush();
  assert.equal(reads, 4); assert.equal(errors.at(-1)?.[1], true); assert.equal(mock.signals[0].aborted, true);
  t.mock.timers.tick(3000); await flush(); assert.equal(reads, 5); assert.equal(mock.listeners.length, 1);
  t.mock.timers.tick(600_000); await flush(); assert.equal(reads, 5); stop();
});

test("stream loss uses canonical fallback and read-only reconnect without elapsed cutoffs; auth rejection stops retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = fakeObserver(); let reads = 0;
  const stop = observeOperation(mock.api, async () => { reads++; return operation; }, () => {});
  await flush(); mock.failures[0](new TypeError("Offline")); await flush();
  t.mock.timers.tick(3000); await flush(); assert.equal(reads, 2); assert.equal(mock.listeners.length, 2);
  t.mock.timers.tick(600_000); await flush(); assert.equal(reads, 2);
  mock.failures[1](new ApiError(401, "authentication_required", "Sign in again")); await flush();
  t.mock.timers.tick(600_000); await flush(); assert.equal(reads, 2); stop();
});

test("hidden, return and unmount abort streams and reads and fence stale operation notices", async () => {
  const target = new EventTarget(); const visibility = Object.assign(target, { hidden: false });
  const mock = fakeObserver(); let reads = 0; let lateSignal!: AbortSignal; let late!: () => void;
  const stop = observeOperation(mock.api, async signal => {
    reads++;
    if (reads === 2) { lateSignal = signal; await new Promise<void>(resolve => { late = resolve; }); }
    signal.throwIfAborted(); return operation;
  }, () => {}, () => false, visibility);
  await flush(); mock.listeners[0]({ event: "changed", operation }); await flush();
  visibility.hidden = true; target.dispatchEvent(new Event("visibilitychange"));
  assert.equal(mock.signals[0].aborted, true); assert.equal(lateSignal.aborted, true);
  visibility.hidden = false; target.dispatchEvent(new Event("visibilitychange")); late(); await flush();
  assert.equal(reads, 3); assert.equal(mock.listeners.length, 2);
  mock.listeners[0]({ event: "terminal", operation }); await flush(); assert.equal(reads, 3);
  stop(); assert.equal(mock.signals[1].aborted, true);
});

test("only matching persisted retry and generation requests are cleared", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } as Storage;
  const batch = pendingBatch(storage, "account", "project");
  batch.save({ key: "newer-key", selection: { blogs: 1 } }); batch.clear("older-key"); assert.equal(batch.read()?.key, "newer-key"); batch.clear("newer-key"); assert.equal(batch.read(), null);
  const retry = pendingRetry(storage, "account", "project");
  retry.save("newer-key"); retry.clear("older-key"); assert.equal(retry.read(), "newer-key"); retry.clear("newer-key"); assert.equal(retry.read(), null);
});

test("connection failures during a canonical read respect reconnect backoff instead of reopening in a tight loop", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = fakeObserver(); let reads = 0; let release!: () => void;
  const stop = observeOperation(mock.api, async () => {
    if (++reads === 2) await new Promise<void>(resolve => { release = resolve; });
    return operation;
  }, () => {});
  await flush(); mock.listeners[0]({ event: "changed", operation }); await flush();
  mock.failures[0](new TypeError("Disconnected")); await flush();
  release(); await flush(); assert.equal(mock.listeners.length, 1);
  t.mock.timers.tick(2999); await flush(); assert.equal(mock.listeners.length, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(mock.listeners.length, 2); stop();
});

test("transient initial or final snapshot read failures retain synchronization until a successful saved read", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = fakeObserver(); let reads = 0;
  const stop = observeOperation(mock.api, async () => {
    if (++reads < 3) throw new TypeError("Offline");
    return null;
  }, () => {});
  await flush(); t.mock.timers.tick(3000); await flush(); assert.equal(reads, 2);
  t.mock.timers.tick(6000); await flush(); assert.equal(reads, 3); assert.equal(mock.listeners.length, 0);
  t.mock.timers.tick(600_000); await flush(); assert.equal(reads, 3); stop();
});

test("a delayed canonical read cannot clear a permanent stream authentication failure or resume observation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = fakeObserver(); let reads = 0; let release!: () => void;
  const errors: [unknown, boolean][] = [];
  const stop = observeOperation(mock.api, async () => {
    if (++reads === 2) await new Promise<void>(resolve => { release = resolve; });
    return operation;
  }, (cause, retrying) => errors.push([cause, retrying]));
  await flush(); mock.listeners[0]({ event: "changed", operation }); await flush();
  mock.listeners[0]({ event: "stream_error", operation, code: "authentication_required" });
  mock.failures[0](new ApiError(401, "authentication_required", "Sign in again")); await flush();
  const errorCount = errors.length;
  release(); await flush();
  assert.equal(errors.length, errorCount);
  assert.ok(errors.at(-1)?.[0] instanceof ApiError);
  assert.equal((errors.at(-1)![0] as ApiError).code, "authentication_required");
  assert.equal(errors.at(-1)?.[1], false);
  t.mock.timers.tick(600_000); await flush();
  assert.equal(reads, 2); assert.equal(mock.listeners.length, 1); stop();
});

test('validated generation summaries survive parsing; malformed summaries fail instead of skipping reads', async () => {
  const seen: OperationEvent[] = [];
  await consumeOperation(new Response(frame('changed', operation, {status: 'generating', terminal: false, ready: 1, failed: 0}), {headers: {'Content-Type': 'text/event-stream'}}), event => seen.push(event), () => {});
  assert.deepEqual(seen[0].progress, {status: 'generating', ready: 1, failed: 0});
  await consumeOperation(new Response(frame('terminal', operation, {status: 'superseded', terminal: true, outcome: 'superseded'}), {headers: {'Content-Type': 'text/event-stream'}}), event => seen.push(event), () => {});
  assert.equal(seen[1].event, 'terminal');
  assert.equal(seen[1].progress, undefined);
  for (const value of [{status: 'invented', ready: 0, failed: 0}, {status: 'queued', ready: -1, failed: 0}, {status: 'queued', ready: 0}]) {
    await assert.rejects(consumeOperation(new Response(frame('changed', operation, value), {headers: {'Content-Type': 'text/event-stream'}}), () => assert.fail('invalid summary dispatched'), () => {}), /Unexpected generation notice/);
  }
});

test('identity-only initial frames do not duplicate canonical reads but a terminal notice always reconciles', async () => {
  const mock = fakeObserver(); let reads = 0;
  const stop = observeOperation(mock.api, async (_signal, notice) => { reads++; return notice?.event === 'terminal' ? null : operation; }, () => {});
  await flush(); assert.equal(reads, 1);
  mock.listeners[0]({event: 'accepted', operation});
  mock.listeners[0]({event: 'changed', operation, refresh: true});
  await flush(); assert.equal(reads, 1);
  mock.listeners[0]({event: 'changed', operation, progress: {status: 'generating', ready: 0, failed: 0}});
  await flush(); assert.equal(reads, 2);
  mock.listeners[0]({event: 'terminal', operation, refresh: true});
  await flush(); assert.equal(reads, 3); stop();
});

test("explicit restoration submits the same empty command and observes its import operation", async () => {
  const op: Operation={projectId:"project",kind:"import",id:"restore-operation"};
  let stream!:ReturnType<typeof connection>;
  let count=0;
  const api=createApi(session,async(path,init)=>{
    assert.equal(path,"/v1/projects/project/restore-source");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"),"restore-key");
    assert.equal(init?.body,undefined);
    if(++count===1)throw new TypeError("Offline");
    stream=connection(init?.signal??undefined);return stream.response;
  });
  const command=()=>api.submit("/v1/projects/project/restore-source",new AbortController().signal,{key:"restore-key"},value=>assert.deepEqual(value,op));
  await assert.rejects(command());
  const retry=command();await flush();stream.send(frame("accepted",op));assert.deepEqual(await retry,op);
  await flush();assert.equal(stream.cancelled,true);assert.equal(count,2);
});

test("restoration reload retains an uncertain key until matching acceptance, despite a later rejection", async () => {
  const {canReleaseSubmission}=await import('../src/features/projects/submission-response.ts');
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as Storage;
  pendingRetry(storage,"account","project","restoration").save("restore-original");
  const reloaded=pendingRetry(storage,"account","project","restoration");
  let stream!:ReturnType<typeof connection>;
  let attempts=0;
  const api=createApi(session,async(_path,init)=>{
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"),"restore-original");
    if(++attempts===1)return Response.json({error:{code:"source_identity_unverified"}},{status:409});
    stream=connection(init?.signal??undefined);return stream.response;
  });
  await assert.rejects(api.submit("/v1/projects/project/restore-source",new AbortController().signal,{key:reloaded.read()!},()=>assert.fail("not accepted")),error=>{
    assert.equal(canReleaseSubmission(error,"restoration",true),false);return true;
  });
  assert.equal(reloaded.read(),"restore-original");
  const accepted=api.submit("/v1/projects/project/restore-source",new AbortController().signal,{key:reloaded.read()!},()=>reloaded.clear("restore-original"));
  await flush();assert.equal(reloaded.read(),"restore-original");
  stream.send(frame("accepted",{projectId:"project",kind:"import",id:"restore-operation"}));
  await accepted;assert.equal(reloaded.read(),null);
});


test("hiding before restoration acceptance explains uncertainty, retains the key, and never resubmits automatically", async t => {
  const { canReleaseSubmission } = await import("../src/features/projects/submission-response.ts");
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: visibility });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } as Storage;
  const pending = pendingRetry(storage, "account", "project", "restoration");
  pending.save("restore-original");
  let attempts = 0;
  const api = createApi(session, async (_path, init) => {
    attempts++;
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "restore-original");
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  });
  const outer = new AbortController();
  const submitted = api.submit("/v1/projects/project/restore-source", outer.signal, { key: pending.read()! }, () => assert.fail("not accepted"));
  await flush();
  visibility.hidden = true;
  visibility.dispatchEvent(new Event("visibilitychange"));
  await assert.rejects(submitted, error => {
    assert.equal(outer.signal.aborted, false);
    assert.match(errorMessage(error), /could not confirm whether restoration started.*Check its status/);
    assert.equal(canReleaseSubmission(error, "restoration", false), false);
    return true;
  });
  visibility.hidden = false;
  visibility.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(attempts, 1);
  assert.equal(pending.read(), "restore-original");
});

test("import summaries validate optional telemetry and preserve legacy/malformed terminal reconciliation", async () => {
  const op: Operation = { projectId: "project", kind: "import", id: "import-1" };
  const progress = { attempt: 1, stage: "download", transferredBytes: 42, totalBytes: null };
  const summary = { status: "importing", importAttempt: 1, importUpdatedAt: 100, importProgress: progress };
  const seen: OperationEvent[] = [];
  for (const [event, extra] of [
    ["changed", summary], ["changed", { ...summary, importProgress: null }], ["changed", {}],
    ["changed", { ...summary, importProgress: { ...progress, attempt: 2 } }],
    ["changed", { ...summary, importUpdatedAt: -1 }],
    ["terminal", { ...summary, status: "failed", importProgress: "bad" }],
  ] as const) {
    await consumeOperation(new Response(frame(event, op, extra), { headers: { "content-type": "text/event-stream" } }), event => seen.push(event), () => {});
  }
  assert.deepEqual(seen[0].importState, { status: "importing", attempt: 1, updatedAt: 100, progress });
  assert.equal(seen[1].importState?.progress, null);
  for (const event of seen.slice(2)) assert.equal(event.importState, undefined);
  assert.equal(seen.at(-1)?.event, "terminal");
});

test("a delayed terminal whose canonical state is still pending reconnects instead of stranding the operation", async () => {
  const mock = fakeObserver(); let reads = 0;
  const stop = observeOperation(mock.api, async () => ++reads < 3 ? operation : null, () => {});
  await flush();
  mock.listeners[0]({ event: "terminal", operation }); await flush();
  assert.equal(reads, 2); assert.equal(mock.signals[0].aborted, true); assert.equal(mock.listeners.length, 2);
  mock.listeners[1]({ event: "terminal", operation }); await flush();
  assert.equal(reads, 3); assert.equal(mock.signals[1].aborted, true); assert.equal(mock.listeners.length, 2);
  stop();
});

test('generation stage summaries carry optional validated stage and readiness', async () => {
 const op: Operation={projectId:'project',kind:'generation',id:'retry'};
 const seen: OperationEvent[]=[];
 for(const transcriptionStage of ['transcribing','invented']) {
  await consumeOperation(new Response(frame('changed',op,{status:'transcribing',ready:0,failed:0,transcriptReady:true,transcriptionStage}),{headers:{'content-type':'text/event-stream'}}),event=>seen.push(event),()=>{});
 }
 assert.equal(seen[0].progress?.transcriptionStage,'transcribing');
 assert.equal(seen[0].progress?.transcriptReady,true);
 assert.equal(seen[1].progress?.transcriptionStage,undefined);
});
