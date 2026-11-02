import { test } from "node:test";
import assert from "node:assert/strict";
import { FirebaseError } from "firebase/app";
import { ApiError, createApi, type StudioApi } from "../src/shared/api/client.ts";
import { pollProject } from "../src/features/projects/project-poll.ts";
import type { Project } from "../src/features/projects/project-response.ts";

const queued: Project = {
  id: "test_project", status: "queued",
  source: { source: "drive", fileId: "test_video", name: "Video", bytes: 100, durationSeconds: 1 },
  createdAt: "2026-10-20T00:00:00Z", sourceExpiresAt: null, errorCode: null,
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("Firebase token network failures recover through the real API while permanent auth failures do not retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const code of ["auth/network-request-failed", "auth/user-token-expired", "auth/user-disabled"]) {
    let tokenCalls = 0;
    let fetchCalls = 0;
    const seen: (Project | null)[] = [];
    const errors: [unknown, boolean][] = [];
    const api = createApi({
      getToken: async () => {
        if (++tokenCalls === 1) { throw new FirebaseError(code, "Token request failed"); }
        return "test-token";
      },
      isCurrent: () => true,
    }, async () => {
      fetchCalls++;
      return Response.json({ data: { ...queued, status: "source_ready" } });
    });
    const stop = pollProject(api, queued.id, queued, value => seen.push(value), (cause, retrying) => errors.push([cause, retrying]));
    await flush();
    assert.equal(errors[0][1], code === "auth/network-request-failed");
    assert.equal(fetchCalls, 0);
    t.mock.timers.tick(2999); await flush();
    assert.equal(tokenCalls, 1);
    t.mock.timers.tick(1);
    for (let step = 0; step < 12; step++) { await flush(); }
    if (code === "auth/network-request-failed") {
      assert.equal(tokenCalls, 2);
      assert.equal(fetchCalls, 1);
      assert.equal(seen[0]?.status, "source_ready");
      assert.deepEqual(errors.at(-1), [null, false]);
    } else {
      assert.equal(tokenCalls, 1);
      assert.deepEqual(seen, []);
    }
    t.mock.timers.tick(60_000); await flush();
    assert.equal(tokenCalls, code === "auth/network-request-failed" ? 2 : 1);
    stop();
  }
});

test("active import recovers after transient polling failures and stops at the returned final state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const replies = [queued, new TypeError("Offline"), new ApiError(503, "unavailable", "Unavailable"), { ...queued, status: "failed" }];
  let calls = 0;
  const seen: (Project | null)[] = [];
  const errors: [unknown, boolean][] = [];
  const api = (async () => {
    const reply = replies[calls++];
    if (reply instanceof Error) { throw reply; }
    return reply;
  }) as StudioApi;
  const stop = pollProject(api, queued.id, null, value => seen.push(value), (cause, retrying) => errors.push([cause, retrying]));
  await flush();
  for (const delay of [3000, 3000, 6000]) {
    t.mock.timers.tick(delay - 1); await flush();
    const previous = calls;
    t.mock.timers.tick(1); await flush();
    assert.equal(calls, previous + 1);
  }
  assert.deepEqual(seen.map(value => value?.status), ["queued", "failed"]);
  assert.deepEqual(errors.map(([, retrying]) => retrying), [false, true, true, false]);
  t.mock.timers.tick(60_000); await flush();
  assert.equal(calls, 4);
  stop();
});

test("retry delay is capped and cancellation clears the scheduled check", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const api = (async () => { calls++; throw new TypeError("Offline"); }) as StudioApi;
  const stop = pollProject(api, queued.id, queued, () => assert.fail("keep known project"), () => {});
  await flush();
  for (const delay of [3000, 6000, 12000, 24000, 30000, 30000]) {
    const previous = calls;
    t.mock.timers.tick(delay - 1); await flush();
    assert.equal(calls, previous);
    t.mock.timers.tick(1); await flush();
    assert.equal(calls, previous + 1);
  }
  stop();
  t.mock.timers.tick(60_000); await flush();
  assert.equal(calls, 7);
});

test("successful checks reset retry backoff, including timeout and rate-limit recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const replies = [new ApiError(408, "timeout", "Timeout"), new ApiError(429, "limited", "Wait"),
    { ...queued, status: "importing" }, new TypeError("Offline"), { ...queued, status: "source_ready" }];
  let calls = 0;
  const api = (async () => {
    const reply = replies[calls++];
    if (reply instanceof Error) { throw reply; }
    return reply;
  }) as StudioApi;
  const stop = pollProject(api, queued.id, queued, () => {}, () => {});
  await flush();
  for (const delay of [3000, 6000, 3000, 3000]) {
    const previous = calls;
    t.mock.timers.tick(delay); await flush();
    assert.equal(calls, previous + 1);
  }
  t.mock.timers.tick(60_000); await flush();
  assert.equal(calls, 5);
  stop();
});

test("access loss clears project; other permanent errors do not retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [initial, cause] of [
    ...[401, 403, 404, 400].map(status => [queued, new ApiError(status, "error", "Unavailable")] as const),
    [queued, new Error("Malformed project")],
    [queued, new DOMException("Account changed", "AbortError")],
  ] as const) {
    let calls = 0;
    const seen: (Project | null)[] = [];
    const api = (async () => { calls++; throw cause; }) as StudioApi;
    const stop = pollProject(api, queued.id, initial, value => seen.push(value), (_cause, retrying) => assert.equal(retrying, false));
    await flush();
    t.mock.timers.tick(60_000); await flush();
    assert.equal(calls, 1);
    assert.deepEqual(seen, cause instanceof ApiError && [401, 403, 404].includes(cause.status) ? [null] : []);
    stop();
  }
});

test("cleanup aborts pending reads and suppresses late responses and failures", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const fail of [false, true]) {
    let finish!: (value: unknown) => void;
    let reject!: (cause: unknown) => void;
    let signal!: AbortSignal;
    const api = (async (_path: string, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise((resolve, rejectPromise) => { finish = resolve; reject = rejectPromise; });
    }) as StudioApi;
    const stop = pollProject(api, queued.id, queued, () => assert.fail("stale project"), () => assert.fail("stale error"));
    stop();
    assert.equal(signal.aborted, true);
    if (fail) { reject(new TypeError("Offline")); } else { finish(queued); }
    await flush();
    t.mock.timers.tick(60_000); await flush();
  }
});

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function importObserver() {
  let saved: Project = { ...queued, importOperationId: "import-1" };
  let gets = 0;
  const listeners: ((event: import("../src/shared/api/operation-stream.ts").OperationEvent) => void)[] = [];
  const failures: ((cause: unknown) => void)[] = [];
  const api = Object.assign(async () => { gets++; return saved; }, {
    stream: (_path: string, signal: AbortSignal, notify: typeof listeners[number]) => {
      listeners.push(notify);
      return new Promise<void>((resolve, reject) => { failures.push(reject); signal.addEventListener("abort", () => resolve(), { once: true }); });
    },
  }) as unknown as StudioApi;
  const operation = { projectId: queued.id, kind: "import" as const, id: "import-1" };
  const seen: (Project | null)[] = [];
  const stop = pollProject(api, queued.id, null, value => seen.push(value), () => {});
  const changed = (attempt: number, updatedAt: number, stage: "download" | "prepare" | "upload" | null, transferredBytes = 0, status: "queued" | "importing" = "importing") => listeners.at(-1)!({ event: "changed", operation,
    importState: { status, attempt, updatedAt, progress: stage ? { attempt, stage, transferredBytes, totalBytes: null } : null } });
  return { listeners, failures, seen, stop, operation, changed, get gets() { return gets; }, set saved(value: Project) { saved = value; } };
}

test("import bytes update directly without proportional GETs, fence attempt/stage/bytes, clear retries and reconcile completion", async () => {
  const mock = importObserver(); await settle(); assert.equal(mock.gets, 1);
  for (let i = 1; i <= 100; i++) { mock.changed(1, i, "download", i); await settle(); }
  assert.equal(mock.gets, 1); assert.equal(mock.seen.at(-1)?.importProgress?.transferredBytes, 100);
  mock.changed(1, 101, "prepare"); mock.changed(1, 102, "download", 200);
  assert.equal(mock.seen.at(-1)?.importProgress?.stage, "prepare");
  mock.changed(1, 103, "upload", 100); mock.changed(1, 104, "upload", 20);
  assert.equal(mock.seen.at(-1)?.importProgress?.transferredBytes, 100);
  mock.changed(1, 105, null); assert.equal(mock.seen.at(-1)?.importProgress, null);
  mock.changed(1, 104, "upload", 150); mock.changed(1, 106, "upload", 150);
  assert.equal(mock.seen.at(-1)?.importProgress, null, "same-attempt late progress cannot undo retry clear");
  mock.changed(2, 107, "download", 1); mock.changed(1, 108, "upload", 200);
  assert.equal(mock.seen.at(-1)?.importProgress?.attempt, 2);
  mock.changed(2, 108, null, 0, "queued"); assert.equal(mock.seen.at(-1)?.status, "importing");
  mock.saved = { ...queued, importOperationId: "import-1", status: "source_ready" };
  mock.listeners[0]({ event: "terminal", operation: mock.operation }); await settle();
  assert.equal(mock.gets, 2); assert.equal(mock.seen.at(-1)?.status, "source_ready");
  mock.changed(2, 109, "download", 9); await settle();
  assert.equal(mock.seen.at(-1)?.status, "source_ready"); assert.equal(mock.gets, 2); mock.stop();
});

test("import legacy notices use canonical fallback; stream recovery and visibility reconcile without periodic reads", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: visibility });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const mock = importObserver(); await settle();
  mock.saved = { ...queued, importOperationId: "import-1", status: "importing" };
  mock.listeners[0]({ event: "changed", operation: mock.operation }); await settle(); assert.equal(mock.gets, 2);
  mock.changed(1, 1, "download", 20); await settle(); assert.equal(mock.gets, 2);
  t.mock.timers.tick(60_000); await settle(); assert.equal(mock.gets, 2);
  mock.failures[0](new TypeError("Offline")); await settle();
  t.mock.timers.tick(3000); await settle(); assert.equal(mock.gets, 3); assert.equal(mock.listeners.length, 2);
  visibility.hidden = true; visibility.dispatchEvent(new Event("visibilitychange"));
  mock.listeners[1]({ event: "changed", operation: mock.operation }); await settle(); assert.equal(mock.gets, 3);
  mock.saved = { ...queued, importOperationId: "import-1", status: "failed", errorCode: "download_failed" };
  visibility.hidden = false; visibility.dispatchEvent(new Event("visibilitychange")); await settle();
  assert.equal(mock.gets, 4); assert.equal(mock.seen.at(-1)?.status, "failed"); assert.equal(mock.seen.at(-1)?.importProgress, undefined);
  mock.stop();
});

test("newer SSE wins over an in-flight legacy GET; unrelated notices and auth errors cannot mutate progress", async () => {
  let notify!: (event: import("../src/shared/api/operation-stream.ts").OperationEvent) => void;
  let release!: (project: Project) => void;
  const operation = { projectId: queued.id, kind: "import" as const, id: "import-1" };
  const saved = { ...queued, status: "importing", importOperationId: operation.id };
  let gets = 0;
  const api = Object.assign(async () => ++gets === 1 ? saved : new Promise<Project>(resolve => { release = resolve; }), {
    stream: (_path: string, signal: AbortSignal, callback: typeof notify) => {
      notify = callback; return new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
    },
  }) as unknown as StudioApi;
  const seen: (Project | null)[] = [];
  const stop = pollProject(api, queued.id, null, value => seen.push(value), () => {});
  await settle();
  notify({ event: "changed", operation }); await settle(); assert.equal(gets, 2);
  const importState = { status: "importing" as const, attempt: 1, updatedAt: 1,
    progress: { attempt: 1, stage: "upload" as const, transferredBytes: 100, totalBytes: null } };
  notify({ event: "changed", operation, importState });
  release(saved); await settle(); assert.equal(seen.at(-1)?.importProgress?.transferredBytes, 100);
  const count = seen.length;
  for (const foreign of [{ ...operation, projectId: "foreign" }, { ...operation, id: "old-import" }]) {
    notify({ event: "changed", operation: foreign, importState: { ...importState, progress: null } });
    notify({ event: "terminal", operation: foreign });
  }
  assert.equal(seen.length, count); assert.equal(gets, 2);
  notify({ event: "stream_error", operation, code: "authentication_required" });
  notify({ event: "changed", operation, importState: { ...importState, updatedAt: 2, progress: null } });
  assert.equal(seen.length, count); stop();
});

test("in-flight canonical progress newer than an SSE overlay wins, while same-attempt retry clear remains cleared", async () => {
  for (const [noticeProgress, canonicalProgress, expected] of [
    [{ attempt: 2, transferredBytes: 100 }, { attempt: 1, transferredBytes: 20 }, { attempt: 2, transferredBytes: 100 }],
    [{ attempt: 2, transferredBytes: 100 }, { attempt: 2, transferredBytes: 20 }, { attempt: 2, transferredBytes: 100 }],
    [{ attempt: 2, transferredBytes: 100 }, { attempt: 3, transferredBytes: 1 }, { attempt: 3, transferredBytes: 1 }],
    [{ attempt: 2, transferredBytes: 100 }, { attempt: 2, transferredBytes: 200 }, { attempt: 2, transferredBytes: 200 }],
    [null, { attempt: 2, transferredBytes: 200 }, null],
    [null, { attempt: 3, transferredBytes: 1 }, { attempt: 3, transferredBytes: 1 }],
  ] as const) {
    let notify!: (event: import("../src/shared/api/operation-stream.ts").OperationEvent) => void;
    let release!: (project: Project) => void;
    const operation = { projectId: queued.id, kind: "import" as const, id: "import-1" };
    const saved = { ...queued, status: "importing", importOperationId: operation.id };
    let gets = 0;
    const api = Object.assign(async () => ++gets === 1 ? saved : new Promise<Project>(resolve => { release = resolve; }), {
      stream: (_path: string, signal: AbortSignal, callback: typeof notify) => {
        notify = callback; return new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
      },
    }) as unknown as StudioApi;
    const seen: (Project | null)[] = [];
    const stop = pollProject(api, queued.id, null, value => seen.push(value), () => {});
    await settle(); notify({ event: "changed", operation }); await settle();
    notify({ event: "changed", operation, importState: { status: "importing", attempt: 2, updatedAt: 2,
      progress: noticeProgress ? { ...noticeProgress, stage: "download", totalBytes: null } : null } });
    release({ ...saved, importProgress: { ...canonicalProgress, stage: "download", totalBytes: null } });
    await settle();
    assert.deepEqual(seen.at(-1)?.importProgress, expected ? { ...expected, stage: "download", totalBytes: null } : null);
    stop();
  }
});

test("queued SSE during a GET cannot hide canonical importing progress", async () => {
  let notify!: (event: import("../src/shared/api/operation-stream.ts").OperationEvent) => void;
  let release!: (project: Project) => void;
  const operation = { projectId: queued.id, kind: "import" as const, id: "import-1" };
  const saved = { ...queued, importOperationId: operation.id };
  let gets = 0;
  const api = Object.assign(async () => ++gets === 1 ? saved : new Promise<Project>(resolve => { release = resolve; }), {
    stream: (_path: string, signal: AbortSignal, callback: typeof notify) => {
      notify = callback; return new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
    },
  }) as unknown as StudioApi;
  const seen: (Project | null)[] = [];
  const stop = pollProject(api, queued.id, null, value => seen.push(value), () => {});
  await settle(); notify({ event: "changed", operation }); await settle();
  notify({ event: "changed", operation, importState: { status: "queued", attempt: 0, updatedAt: 1, progress: null } });
  const progress = { attempt: 1, stage: "download" as const, transferredBytes: 20, totalBytes: null };
  release({ ...saved, status: "importing", importProgress: progress }); await settle();
  assert.equal(seen.at(-1)?.status, "importing"); assert.deepEqual(seen.at(-1)?.importProgress, progress); stop();
});
