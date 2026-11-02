import { ApiError, type StudioApi } from "../../shared/api/client.ts";
import type { Operation, OperationEvent } from "../../shared/api/operation-stream.ts";

export const transientObservationError = (cause: unknown) => cause instanceof TypeError ||
  (cause instanceof Error && "code" in cause && cause.code === "auth/network-request-failed") ||
  (cause instanceof ApiError && ([408, 429].includes(cause.status) || cause.status >= 500));

// Canonical reads run serially; notices arriving during a read require one follow-up.
export function observeOperation(
  api: StudioApi,
  read: (signal: AbortSignal, notice?: OperationEvent) => Promise<Operation | null>,
  onError: (cause: unknown, retrying: boolean) => void,
  pollWithoutIdentity: () => boolean = () => false,
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | undefined = typeof document === "undefined" ? undefined : document,
  applyNotice?: (notice: OperationEvent) => boolean,
) {
  let stopped = false;
  let run = 0;
  let reads: AbortController | undefined;
  let stream: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let dirty = false;
  let fullRead = false;
  let pendingNotice: OperationEvent | undefined;
  let current: Operation | null = null;
  let terminal = false;
  let blocked = false;
  let reconnectWait = false;
  let delay = 3000;
  const same = (a: Operation | null, b: Operation | null) => a?.id === b?.id && a?.kind === b?.kind && a?.projectId === b?.projectId;
  const visible = () => !stopped && !visibility?.hidden;
  const schedule = () => {
    clearTimeout(timer);
    if (visible() && !blocked) {
      timer = setTimeout(() => { timer = undefined; reconnectWait = false; void refresh(); }, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  function attach(operation: Operation) {
    if (!visible() || terminal || blocked || reconnectWait || stream) return;
    const controller = new AbortController();
    stream = controller;
    const activeRun = run;
    let failure: unknown = new TypeError("Progress connection closed. Checking saved progress again.");
    void api.stream(`/v1/projects/${operation.projectId}/operations/${operation.kind}/${operation.id}/events`, controller.signal, event => {
      if (!visible() || blocked || activeRun !== run || controller.signal.aborted || !same(event.operation, current)) return;
      if (event.event === "stream_error") {
        failure = new ApiError(event.code === "authentication_required" ? 401 : 503, event.code ?? "observation_unavailable", event.code === "authentication_required" ? "Your sign-in needs to be restored. Sign out and sign in again." : "Progress connection interrupted. Checking saved progress again.");
        if (failure instanceof ApiError && failure.status === 401) { blocked = true; onError(failure, false); }
        return;
      }
      delay = 3000;
      if (event.event === "terminal") { terminal = true; controller.abort(); }
      // Acceptance carries identity only; the following snapshot closes the read/subscribe gap.
      if (event.event === "accepted" || (event.event === "changed" && event.refresh)) return;
      if (event.event === "changed" && applyNotice?.(event)) { onError(null, false); return; }
      void refresh(event);
    }).catch(cause => { failure = cause; }).finally(() => {
      if (activeRun !== run || stream !== controller) return;
      stream = undefined;
      if (!visible()) return;
      if (terminal) return;
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) blocked = true;
      onError(failure, !blocked);
      reconnectWait = true;
      schedule();
    });
  }
  async function refresh(notice?: OperationEvent) {
    if (!visible() || blocked) return;
    if (!notice) fullRead = true;
    else if (pendingNotice?.event !== "terminal") pendingNotice = notice;
    dirty = true;
    if (reading) return;
    reading = true;
    const activeRun = run;
    try {
      while (dirty && visible() && activeRun === run) {
        dirty = false;
        reads = new AbortController();
        const notice = fullRead ? undefined : pendingNotice;
        fullRead = false;
        pendingNotice = undefined;
        const next = await read(reads.signal, notice);
        if (activeRun !== run || !visible() || blocked) return;
        onError(null, false);
        if (!reconnectWait) { clearTimeout(timer); timer = undefined; }
        if (!same(next, current)) {
          stream?.abort(); stream = undefined;
          current = next; terminal = false;
        }
        if (!next) { terminal = true; stream?.abort(); stream = undefined; clearTimeout(timer); if (pollWithoutIdentity()) { delay = 3000; schedule(); delay = 3000; } }
        else {
          // A terminal notice can be older than the canonical pending state.
          // Once reconciliation finishes, observe that current operation again.
          if (terminal && !dirty) { stream = undefined; terminal = false; }
          if (!terminal) attach(next);
        }
      }
    } catch (cause) {
      if (activeRun !== run || !visible() || (cause instanceof Error && cause.name === "AbortError")) return;
      const retrying = transientObservationError(cause);
      onError(cause, retrying);
      if (retrying) schedule(); else { blocked = true; stream?.abort(); }
    } finally {
      reading = false;
      if (dirty && visible() && !blocked) void refresh();
    }
  }
  const visibilityChanged = () => {
    run++; reads?.abort(); stream?.abort(); stream = undefined; clearTimeout(timer); dirty = false;
    current = null; terminal = false; blocked = false; reconnectWait = false; delay = 3000;
    if (visible()) void refresh();
  };
  visibility?.addEventListener("visibilitychange", visibilityChanged);
  void refresh();
  return () => {
    stopped = true; run++; reads?.abort(); stream?.abort(); clearTimeout(timer);
    visibility?.removeEventListener("visibilitychange", visibilityChanged);
  };
}
