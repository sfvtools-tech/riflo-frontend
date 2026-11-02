import { readImportProgress, type ImportProgress } from "./import-progress.ts";
import { createParser } from "eventsource-parser";

export type Operation = { projectId: string; kind: "import" | "generation"; id: string };
export type OperationProgress = { transcriptReady?: boolean; transcriptionStage?: "preparing_audio" | "transcribing"; status: string; ready: number; failed: number };
export type ImportNotice = { transcriptionStage?: "preparing_audio" | "transcribing"; preparation?: "pending" | "transcribing" | "ready" | "failed"; status: "queued" | "importing"; attempt: number; updatedAt: number; progress: ImportProgress | null };
export type OperationEvent = { importState?: ImportNotice; refresh?: true; progress?: OperationProgress; event: "accepted" | "changed" | "terminal" | "stream_error"; operation: Operation; code?: string };
export function readOperation(value: unknown): Operation {
  const v = value as Operation | null;
  if (!v || ![v.id, v.projectId].every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) || !["import", "generation"].includes(v.kind)) throw new Error("Unexpected operation identity.");
  return { projectId: v.projectId, kind: v.kind, id: v.id };
}
export async function consumeOperation(response: Response, notify: (event: OperationEvent) => void, check: () => void) {
  if (response.headers.get("content-type")?.split(";")[0].trim() !== "text/event-stream" || !response.body) throw new Error("Unexpected progress response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createParser({ maxBufferSize: 65_536, onError(error) { if (error.type === "max-buffer-size-exceeded") throw error; }, onEvent(message) {
    if (!["accepted", "changed", "terminal", "stream_error"].includes(message.event ?? "")) return;
    const value = JSON.parse(message.data);
    if (value.version !== 1) throw new Error("Unexpected progress version.");
    const operation = readOperation(value.operation);
    if (message.event === "stream_error" && typeof value.code !== "string") throw new Error("Unexpected observation error.");
    let progress: OperationProgress | undefined;
    if (operation.kind === "generation" && value.status === "superseded") {
      if (message.event !== "terminal") throw new Error("Unexpected generation notice.");
    } else if (operation.kind === "generation" && value.status !== undefined) {
      if (!["queued", "transcribing", "generating", "completed", "partial", "failed"].includes(value.status) ||
          ![value.ready, value.failed].every(count => Number.isSafeInteger(count) && count >= 0)) {
        throw new Error("Unexpected generation notice.");
      }
      progress = { status: value.status, ready: value.ready, failed: value.failed, ...(typeof value.transcriptReady === "boolean" ? { transcriptReady: value.transcriptReady } : {}), ...(["preparing_audio", "transcribing"].includes(value.transcriptionStage) ? { transcriptionStage: value.transcriptionStage } : {}) };
    }
    // Missing or malformed optional telemetry falls back to a canonical project read.
    // Terminal events always reconcile, even if their telemetry is malformed.
    let importState: ImportNotice | undefined;
    if (operation.kind === "import" && message.event === "changed" &&
        ["queued", "importing"].includes(value.status) &&
        Number.isSafeInteger(value.importAttempt) && value.importAttempt >= 0 &&
        Number.isSafeInteger(value.importUpdatedAt) && value.importUpdatedAt >= 0) {
      const progress = readImportProgress(value.importProgress);
      if ((value.importProgress == null || progress?.attempt === value.importAttempt) &&
          (value.status !== "queued" || !progress)) {
        importState = { ...(["preparing_audio", "transcribing"].includes(value.transcriptionStage) ? { transcriptionStage: value.transcriptionStage } : {}), ...(["pending", "transcribing", "ready", "failed"].includes(value.preparation) ? { preparation: value.preparation } : {}), status: value.status, attempt: value.importAttempt, updatedAt: value.importUpdatedAt, progress };
      }
    }
    notify({ ...(importState ? { importState } : {}), event: message.event as OperationEvent["event"], operation, code: value.code, ...(value.refresh === true ? { refresh: true as const } : {}), ...(progress ? { progress } : {}) });
  } });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      check();
      if (done) { parser.feed(decoder.decode()); break; }
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
