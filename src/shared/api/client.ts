import { consumeOperation, readOperation, type OperationEvent, type Operation } from "./operation-stream.ts";
export const generationSourceMessages: Record<string, string> = {
  unsupported_focus: "The selected source does not support this focus. Try a focus supported by the source.",
  source_window_conflict: "This source window cannot preserve complete speech or necessary context. Choose another window.",
  source_window_empty: "This source window contains no complete spoken words. Choose another window.",
};
const sourceMessages: Record<string, string> = {
  ...generationSourceMessages,
  invalid_generation_controls: "Check your generation choices and source window before trying again.",
  generation_controls_unavailable: "Generation customization is not available yet. Refresh availability before trying again.",
  generation_defaults_unavailable: "Generation defaults are temporarily unavailable. Please try again.",
  generation_threads_unavailable: "Threads require shared creation credits. Choose Single post or check your account access.",
  source_changed: "The original video has changed. Import it as a new project to keep existing transcripts and outputs separate.",
  source_identity_unverified: "We cannot verify that this video matches the saved transcript. Import it as a new project.",
  source_restore_not_available: "This source cannot currently be restored. Refresh the project or import the video as a new project.",
  trial_identity_required: "Sign out, then sign in with a verified Google account to start a trial.",
  trial_already_used: "This Google account has already used its trial. Sign in to the original Riflo account or use paid access.",
  trial_work_limited: "This trial has reached its processing request limit. Paid access remains available.",
  trial_rate_limited: "Too many trial requests. Please wait before trying again.",
  trial_not_configured: "Trial processing is awaiting setup. Please try again later.",
  transcription_not_retryable: "This video could not be transcribed. Open the original or choose another source.",
  transcript_not_ready: "Prepare the transcript before creating content.",
  transcription_not_failed: "Transcription is no longer failed. Refresh to check its progress.",
  brand_unavailable: "Brand settings are temporarily unavailable. You can still create content with source defaults.",
  retry_cooldown: "Please wait before retrying this import.",
  import_not_failed: "This import is no longer failed. Refresh the project to check its progress.",
  requires_reimport: "The original video has expired. Import it again to create this format.",
  generation_in_progress: "Generation is already in progress. Check its results before starting more work.",
  allowance_exceeded:
    "This selection exceeds your remaining allowance. Choose fewer outputs or another source.",
  queue_full:
    "Your processing queue is full. Wait for current work to finish, then try again.",
  subscription_required:
    "Active account access is needed to start new work. Saved results remain available.",
  feature_not_in_plan:
    "This format is not included in your account access. Choose another format.",
  feature_unavailable:
    "This output format is not available. Choose another format.",
  invalid_outputs:
    "Choose output counts within your current allowance and batch limits.",
  source_not_ready:
    "The source is not ready for generation. Refresh the project to check its progress.",
  source_allowance_expired:
    "This source belongs to an earlier allowance period. Import a new source to generate content.",
  generation_exists:
    "This project already has a generation request. Checking its results now.",
  idempotency_conflict:
    "This request does not match the saved request. Refresh to check the original work before trying again.",
  project_not_found: "This project is no longer available to your account.",
  invalid_source: "Choose a supported video source and check its link again.",
  stale_connection:
    "Your Drive connection changed. Refresh its status before checking the video again.",
  drive_reconnect_required: "Reconnect Google Drive, then select this file in the Picker.",
  unsupported_video: "Choose a downloadable video outside the trash.",
  source_too_large: "This video exceeds your source limits. Choose a smaller video.",
  source_too_long: "This video exceeds your source limits. Choose a shorter video.",
  drive_file_unavailable:
    "This Drive video is unavailable. Check its access or choose another video.",
  invalid_youtube_link:
    "Use a link to one YouTube video or Short, without a playlist.",
  youtube_video_restricted:
    "Choose a public or unlisted video without age, sign-in or live restrictions.",
  youtube_video_unavailable:
    "This YouTube video is unavailable. Check the link or choose another video.",
  youtube_verification_required:
    "YouTube could not verify access to this video. Riflo could not import it.",
  youtube_download_failed:
    "YouTube could not provide this video to Riflo.",
};

export type RetryAllowance = { requiredSeconds: number; remainingSeconds: number };
export function readRetryAllowance(value: unknown): RetryAllowance | null {
  if (!value || typeof value !== "object" || !("requiredSeconds" in value) || !("remainingSeconds" in value)) return null;
  const { requiredSeconds, remainingSeconds } = value;
  if (typeof requiredSeconds !== "number" || typeof remainingSeconds !== "number" || ![requiredSeconds, remainingSeconds].every(seconds => Number.isFinite(seconds) && seconds >= 0 && seconds <= Number.MAX_SAFE_INTEGER)) return null;
  return { requiredSeconds, remainingSeconds };
}

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds: number | null;
  allowance: RetryAllowance | null;
  acceptedOperation?: Operation;
  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null, allowance: RetryAllowance | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.allowance = allowance;
  }
}

export type TokenSession = {
  getToken: () => Promise<string>;
  isCurrent: () => boolean;
};
export function createApi(
  session: TokenSession,
  fetcher: typeof fetch = fetch,
  baseUrl: string = import.meta.env?.VITE_API_BASE_URL ?? "",
) {
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.origin !== baseUrl || url.username || url.password) throw new Error("API base URL must be an HTTPS origin.");
  }
  // Snapshots last only as long as this signed-in studio. Every visit still reads the server.
  const snapshots = new Map<string, unknown>();
  const reads = new Map<string, number>();
  let revision = 0;
  const operationKey = (operation: Operation) => `${operation.projectId}/${operation.kind}/${operation.id}`;
  const commands = new Map<string, { listeners: Set<(event: OperationEvent) => void>; latest?: OperationEvent; done: Promise<void>; abort: () => void }>();
  async function request<T>(
    path: string,
    signal?: AbortSignal,
    options?: { method: "POST" | "DELETE" | "GET" | "PUT"; body?: unknown; key?: string; onEvent?: (event: OperationEvent) => void },
  ): Promise<T> {
    if (!/^\/v1\/[a-zA-Z0-9_/-]+$/.test(path)) {
      throw new Error("Invalid API path.");
    }
    const requestRevision = revision;
    const read = (reads.get(path) ?? 0) + 1;
    if (options && options.method !== "GET") {
      revision++;
      snapshots.clear();
    } else {
      reads.set(path, read);
    }
    const token = await session.getToken();
    const check = () => {
      signal?.throwIfAborted();
      if (!session.isCurrent()) {
        throw new DOMException("The signed-in account changed.", "AbortError");
      }
    };
    check();
    const response = await fetcher(`${baseUrl}${path}`, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options?.onEvent ? { Accept: "text/event-stream" } : {}),
        ...(options?.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options?.key ? { "Idempotency-Key": options.key } : {}),
      },
      body:
        options?.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    check();
    if (response.ok && options?.onEvent) {
      await consumeOperation(response, event => { check(); options.onEvent!(event); }, check);
      return undefined as T;
    }
    const body: unknown = await response.json().catch(() => null);
    check();
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        revision++;
        snapshots.clear();
      } else if (response.status === 404) {
        snapshots.delete(path);
      }
      const code =
        body &&
        typeof body === "object" &&
        "error" in body &&
        body.error &&
        typeof body.error === "object" &&
        "code" in body.error
          ? String(body.error.code)
          : "request_failed";
      const retryAllowance = response.status === 403 && code === "allowance_exceeded" && options?.method === "POST" && /^\/v1\/projects\/[A-Za-z0-9_-]+\/(?:retry-import|restore-source)$/.test(path);
      const initialAllowance = response.status === 403 && code === "allowance_exceeded" && options?.method === "POST" && path === "/v1/projects";
      const allowance = (retryAllowance || initialAllowance) && body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "allowance" in body.error ? readRetryAllowance(body.error.allowance) : null;
      const retryHeader = response.headers.get("Retry-After");
      const retrySeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
      const error = new ApiError(
        response.status,
        code,
        (retryAllowance
          ? path.endsWith("/restore-source")
            ? "Not enough source video allowance remains to restore this source. Other imported videos may have allowance reserved."
            : "Not enough source video allowance remains to retry this import. Other imported videos may have allowance reserved."
          : initialAllowance
            ? "Not enough source video allowance remains to import this video. Other imported videos may have allowance reserved."
            : sourceMessages[code]) ??
          (response.status === 401
            ? "Your sign-in could not be verified. Sign out and try again."
            : response.status === 403
              ? "Your account does not have access to this action."
              : response.status === 503
                ? "This service is awaiting setup. Please try again later."
                : "The request did not finish. Please try again."),
        retrySeconds !== null && Number.isSafeInteger(retrySeconds) ? retrySeconds : null,
        allowance,
      );
      if (response.status === 409 && code === "operation_superseded" && body && typeof body === "object" && "error" in body) {
        const detail = body.error as Record<string, unknown>;
        if (detail.accepted === true) error.acceptedOperation = readOperation(detail.operation);
      }
      throw error;
    }
    if (!body || typeof body !== "object" || !("data" in body)) {
      throw new ApiError(
        502,
        "invalid_response",
        "The server returned an unexpected response.",
      );
    }
    if (!options && revision === requestRevision && reads.get(path) === read) {
      snapshots.delete(path);
      snapshots.set(path, body.data);
      if (snapshots.size > 50) {
        snapshots.delete(snapshots.keys().next().value!);
      }
    }
    if (options && options.method !== "GET") {
      revision++;
      snapshots.clear();
    }
    return body.data as T;
  }
  return Object.assign(request, {
    submit(path: string, signal: AbortSignal, command: { body?: unknown; key: string }, accepted: (operation: Operation) => void, keepOpen = false): Promise<Operation> {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const visibilityChanged = () => { if (document.hidden) abort(); };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibilityChanged);
      if (signal.aborted || (typeof document !== "undefined" && document.hidden)) abort();
      return new Promise((resolve, reject) => {
        let resolved: Operation | undefined;
        const listeners = new Set<(event: OperationEvent) => void>();
        const accept = (operation: Operation) => {
          signal.throwIfAborted();
          const expected = path === "/v1/projects" ? null : path.split("/")[3];
          if (operation.kind !== ((path.endsWith("/generate") || path.endsWith("/retry-transcription")) ? "generation" : "import") || (expected && operation.projectId !== expected)) throw new Error("Unexpected accepted operation.");
          resolved = operation;
          if (keepOpen) commands.set(operationKey(operation), { listeners, done, abort });
          try { accepted(operation); resolve(operation); } catch (cause) { reject(cause); abort(); }
          if (!keepOpen) abort();
        };
        const done = request<void>(path, controller.signal, { method: "POST", ...command, onEvent: event => {
          if (event.event === "accepted" && !resolved) accept(event.operation);
          if (resolved) {
            const active = commands.get(operationKey(resolved));
            if (active) active.latest = event;
          }
          for (const listener of listeners) listener(event);
          if (event.event === "terminal") abort();
        } }).catch(cause => {
          if (!resolved && cause instanceof ApiError && cause.acceptedOperation) accept(cause.acceptedOperation);
          else if (!resolved) reject(controller.signal.aborted && !signal.aborted && session.isCurrent()
            ? new Error(path.endsWith("/restore-source")
              ? "We could not confirm whether restoration started. Check its status before trying again."
              : "We could not confirm whether this request started. Check its status before trying again.")
            : cause);
          else if (!controller.signal.aborted) for (const listener of listeners) listener({ event: "stream_error", operation: resolved, code: cause instanceof ApiError && cause.status === 401 ? "authentication_required" : "observation_unavailable" });
        }).finally(() => {
          if (!resolved) reject(new Error("The request ended before acceptance could be confirmed."));
          if (resolved) commands.delete(operationKey(resolved));
          signal.removeEventListener("abort", abort);
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityChanged);
        });
      });
    },
    async stream(path: string, signal: AbortSignal, onEvent: (event: OperationEvent) => void, command?: { body?: unknown; key: string }) {
      const parts = path.split("/");
      const id = parts.at(-2)!;
      const active = !command && commands.get([parts[3], parts[5], id].join("/"));
      if (!active) return request<void>(path, signal, { method: command ? "POST" : "GET", ...command, onEvent });
      const abort = () => active.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      active.listeners.add(onEvent);
      try {
        if (active.latest) onEvent(active.latest);
        await active.done;
      } finally { active.listeners.delete(onEvent); signal.removeEventListener("abort", abort); }
    },
    snapshot<T>(path: string, parse: (value: unknown) => T): T | null {
      if (!session.isCurrent()) {
        snapshots.clear();
        return null;
      }
      if (!snapshots.has(path)) return null;
      try {
        return parse(snapshots.get(path));
      } catch {
        snapshots.delete(path);
        return null;
      }
    },
    async blob(path: string, contentType: string, signal?: AbortSignal) {
      if (
        !/^\/v1\/projects\/[A-Za-z0-9_-]{1,128}\/outputs\/[A-Za-z0-9_-]{1,128}\/(?:download|assets\/[A-Za-z0-9_-]{1,128}\/download)$/.test(
          path,
        )
      ) {
        throw new Error("Invalid download path.");
      }
      const token = await session.getToken();
      const check = () => {
        signal?.throwIfAborted();
        if (!session.isCurrent())
          throw new DOMException(
            "The signed-in account changed.",
            "AbortError",
          );
      };
      check();
      const response = await fetcher(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
      });
      check();
      if (!response.ok)
        throw new ApiError(
          response.status,
          "download_failed",
          "This file could not be opened. It may have expired. Try again.",
        );
      if (response.headers.get("content-type")?.split(";")[0] !== contentType)
        throw new Error("Unexpected file type.");
      const blob = await response.blob();
      check();
      return blob;
    },
  });
}

export type StudioApi = ReturnType<typeof createApi>;
export function errorMessage(error: unknown) {
  if (error instanceof ApiError && !["allowance_exceeded", "trial_rate_limited"].includes(error.code) && sourceMessages[error.code]) return sourceMessages[error.code];
  if (error instanceof ApiError && error.code === "trial_rate_limited" && error.retryAfterSeconds !== null && Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
    return `${error.message} Try again in ${error.retryAfterSeconds} ${error.retryAfterSeconds === 1 ? "second" : "seconds"}.`;
  }
  if (!(error instanceof ApiError) && error instanceof TypeError && /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/.test(error.message)) {
    return "We couldn’t connect to Riflo. Check your connection and try again.";
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function restorationErrorMessage(code: string) {
  return code === "allowance_exceeded"
    ? "Restoration could not finish because source video allowance was unavailable. Check usage and available source-processing minutes before trying again."
    : sourceMessages[code] ?? "Restoration could not finish. Check the original video and try again when available.";
}

export function importErrorMessage(code: string | null) {
  return code === "allowance_exceeded"
    ? "This import exceeds your source video allowance. Check usage or choose a shorter video."
    : (code && sourceMessages[code]) || "The import could not finish. Check that the original video is accessible, then retry when available or choose another source.";
}
