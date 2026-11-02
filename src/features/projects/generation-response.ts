import { readControls, readControlsAvailability, readControlsSnapshot, type GenerationControls, type ControlsAvailability, type ControlsSnapshot } from './generation-controls.ts';
import { readLifecycle, type Lifecycle } from "../account/lifecycle-response.ts";
import { readBrandRequest, type BrandRequest } from "../brand/brand-response.ts";
import type { OperationEvent } from "../../shared/api/operation-stream.ts";
import { ApiError, generationSourceMessages, type StudioApi } from "../../shared/api/client.ts";
export const formats = [
  ["x_posts", "X posts", "A thought worth passing on."],
  ["linkedin_posts", "LinkedIn posts", "Bring your point of view to work."],
  ["blogs", "Blog", "Give the idea room to breathe."],
  ["newsletters", "Newsletter", "A conversation for the inbox."],
  ["carousels", "Carousel", "A story, one slide at a time."],
  ["short_videos", "Short video", "Keep the original voice in frame."],
] as const;
export type Format = (typeof formats)[number][0];
export type Selection = Partial<Record<Format, number>>;
export type Batch = {
  transcriptReady?: boolean;
  transcriptionStage?: "preparing_audio" | "transcribing";
  controls?: ControlsSnapshot;
  intent?: "transcription_retry" | "import_transcription";
  errorCode?: string | null;
  brand?: { status: "applied" | "none" | "unavailable" | "not_applicable" };
  id: string;
  status:
    | "queued"
    | "transcribing"
    | "generating"
    | "completed"
    | "partial"
    | "failed";
  slots: {
    id: string;
    feature: Format;
    status: "pending" | "ready" | "failed";
    errorCode: string | null;
    credits?: number;
    maxCredits?: number;
    deliveredPosts?: number;
  }[];
};
export const retentionModes = ["fixed", "while_paid"] as const;
export type RetentionMode = (typeof retentionModes)[number];
const retentionMode = (value: unknown) => value === undefined || retentionModes.some(mode => mode === value);
export type ThreadData = { kind: "thread"; status: "ok"; posts: string[]; numbering: "include" | "exclude" };
export type Output = {
  data?: ThreadData | Record<string, unknown>;
  deliveredPosts?: number;
  credits?: number;
  requestedMaxPosts?: number;
  retentionMode?: RetentionMode;
  id: string;
  feature: Format;
  text: string;
  expiresAt: string;
  assets?: {
    id: string;
    contentType: "image/png" | "video/mp4";
    downloadPath: string;
  }[];
};
export function outputThread(output: Output): ThreadData | null {
  return output.feature === "x_posts" && output.data?.kind === "thread" ? output.data as ThreadData : null;
}
export function threadPostText(thread: ThreadData, index: number): string {
  return `${thread.numbering === "include" ? `${index + 1}/${thread.posts.length} ` : ""}${thread.posts[index]}`;
}
export function generationWasReset(batch: Batch | null): boolean {
  return batch?.status === "failed" && batch.slots.length > 0 &&
    batch.slots.every(slot => slot.status === "failed" && slot.errorCode === "generation_reset");
}
export function generationFailureMessage(batch: Batch | null): string {
  if (batch?.slots.some(slot => slot.status === "failed" && slot.errorCode === "duplicate_generated_output")) {
    return "The result repeated existing content. Try another focus.";
  }
  const sourceFailure = batch?.slots.find(slot => slot.status === "failed" && slot.errorCode && Object.hasOwn(generationSourceMessages, slot.errorCode));
  return sourceFailure?.errorCode ? generationSourceMessages[sourceFailure.errorCode] : "Couldn’t create your content.";
}
export function generationHeadline(batch: Batch, content: string): string {
  if ((batch.intent === "transcription_retry" || batch.intent === "import_transcription")) return batch.status === "queued" ? "Waiting to prepare transcript…" : "Preparing transcript…";
  const action = batch.status === "queued" ? "Waiting to start"
    : batch.status === "transcribing" ? "Preparing transcript for" : "Generating";
  return `${action} ${content || "content"}…`;
}
export function formatProgress(
  feature: Format,
  batch: Batch | null,
  selection: Selection | null,
  sending: boolean,
): string | null {
  if (selection) {
    return sending && (selection[feature] ?? 0) > 0 ? "Sending…" : null;
  }
  if (!batch || !["queued", "transcribing", "generating"].includes(batch.status) ||
      !batch.slots.some(slot => slot.feature === feature && slot.status === "pending")) {
    return null;
  }
  if (batch.status === "queued") { return "Queued…"; }
  if (batch.slots.length > 1) { return "Waiting…"; }
  return batch.status === "transcribing" ? "Transcribing…" : "Generating…";
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const known = (v: unknown): v is Format => formats.some(([key]) => key === v);
export function readBatch(v: unknown): Batch {
  if (
    !record(v) ||
    (typeof v.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v.id)) ||
    ![
      "queued",
      "transcribing",
      "generating",
      "completed",
      "partial",
      "failed",
    ].includes(String(v.status)) ||
    !Array.isArray(v.slots) ||
    !v.slots.every(
      (s) =>
        record(s) &&
        typeof s.id === "string" &&
        known(s.feature) &&
        ["pending", "ready", "failed"].includes(String(s.status)) &&
        (s.errorCode === null || typeof s.errorCode === "string"),
    )
  )
    throw new Error("Unexpected generation progress.");
  if (v.transcriptReady !== undefined && typeof v.transcriptReady !== "boolean") throw new Error("Unexpected transcript readiness.");
  if (v.transcriptionStage !== undefined && !["preparing_audio", "transcribing"].includes(String(v.transcriptionStage))) throw new Error("Unexpected transcription stage.");
  if (v.intent !== undefined && (!["transcription_retry", "import_transcription"].includes(String(v.intent)) || v.slots.length !== 0 || ["generating", "partial"].includes(String(v.status)))) throw new Error("Unexpected transcription progress.");
  if (v.errorCode !== undefined && v.errorCode !== null && typeof v.errorCode !== "string") throw new Error("Unexpected transcription error.");
  if (v.brand !== undefined && (!record(v.brand) || !["applied", "none", "unavailable", "not_applicable"].includes(String(v.brand.status)))) throw new Error("Unexpected generation preferences.");
  for (const slot of v.slots) {
    if (slot.credits !== undefined && (!Number.isSafeInteger(slot.credits) || slot.credits < 0)) throw new Error("Unexpected generation credits.");
    if (slot.maxCredits !== undefined && (slot.feature !== "x_posts" || !Number.isSafeInteger(slot.maxCredits) || slot.maxCredits < 2 || slot.maxCredits > 10 || slot.credits > slot.maxCredits)) throw new Error("Unexpected thread reservation.");
    if (slot.deliveredPosts !== undefined && (slot.feature !== "x_posts" || slot.status !== "ready" || !Number.isSafeInteger(slot.deliveredPosts) || slot.deliveredPosts < 1 || slot.deliveredPosts > 10 || slot.credits !== slot.deliveredPosts || slot.maxCredits === undefined || slot.deliveredPosts > slot.maxCredits)) throw new Error("Unexpected thread delivery.");
  }
  if (v.controls !== undefined) readControlsSnapshot(v.controls);
  return v as Batch;
}
export function readOutputs(v: unknown, projectId: string): Output[] {
  if (
    !Array.isArray(v) ||
    !v.every(
      (o) =>
        record(o) &&
        typeof o.id === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(o.id) &&
        known(o.feature) &&
        typeof o.text === "string" &&
        typeof o.expiresAt === "string" &&
        Number.isFinite(Date.parse(o.expiresAt)) &&
        retentionMode(o.retentionMode) &&
        (o.assets === undefined ||
          (Array.isArray(o.assets) &&
            o.assets.every(
              (a) =>
                record(a) &&
                typeof a.id === "string" &&
                /^[A-Za-z0-9_-]{1,128}$/.test(a.id) &&
                ["image/png", "video/mp4"].includes(String(a.contentType)) &&
                a.downloadPath ===
                  `/v1/projects/${projectId}/outputs/${o.id}/assets/${a.id}/download`,
            ))),
    )
  )
    throw new Error("Unexpected generated content.");
  for (const output of v) {
    const data = output.data;
    const thread = record(data) && data.kind === "thread";
    if (!thread) {
      if ([output.deliveredPosts, output.requestedMaxPosts].some(value => value !== undefined)) throw new Error("Unexpected thread metadata.");
      continue;
    }
    if (output.feature !== "x_posts" || data.status !== "ok" || !["include", "exclude"].includes(String(data.numbering)) ||
        !Array.isArray(data.posts) || data.posts.length < 1 || data.posts.length > 10 || !data.posts.every(post => typeof post === "string" && post.trim().length > 0) ||
        !Number.isSafeInteger(output.requestedMaxPosts) || output.requestedMaxPosts < 2 || output.requestedMaxPosts > 10 ||
        output.deliveredPosts !== data.posts.length || output.deliveredPosts > output.requestedMaxPosts || output.credits !== output.deliveredPosts || output.assets?.length) {
      throw new Error("Unexpected generated thread.");
    }
    const parsed = data as ThreadData;
    if (output.text !== parsed.posts.map((_, index) => threadPostText(parsed, index)).join("\n\n")) throw new Error("Unexpected thread text.");
  }
  return v as Output[];
}

export type GenerationSnapshot = { batch: Batch | null; outputs: Output[]; known: boolean };
export function generationNoticeMatches(batch: Batch | null, notice: OperationEvent): boolean {
  return !!batch && notice.event !== "terminal" && notice.operation.id === batch.id &&
    notice.progress?.status === batch.status &&
    notice.progress.ready === batch.slots.filter(slot => slot.status === "ready").length &&
    notice.progress.failed === batch.slots.filter(slot => slot.status === "failed").length;
}
export async function readGenerationResults(api: StudioApi, projectId: string, signal: AbortSignal, snapshot?: GenerationSnapshot, notice?: OperationEvent) {
  const missingReady = snapshot?.batch?.slots.some(slot => slot.status === "ready" && !snapshot.outputs.some(output => output.id === slot.id));
  if (snapshot?.known && !missingReady && notice && generationNoticeMatches(snapshot.batch, notice)) {
    signal.throwIfAborted();
    return [{ status: "fulfilled", value: snapshot.batch && { ...snapshot.batch, ...(notice.progress?.transcriptReady !== undefined ? { transcriptReady: notice.progress.transcriptReady } : {}), ...(notice.progress?.transcriptionStage ? { transcriptionStage: notice.progress.transcriptionStage } : {}) } }, { status: "fulfilled", value: snapshot.outputs }] as const;
  }
  const [progress] = await Promise.allSettled([
    api(`/v1/projects/${projectId}/generation`, signal).then(readBatch).catch(cause => {
      if (cause instanceof ApiError && cause.code === "generation_not_found") return null;
      throw cause;
    }),
  ]);
  signal.throwIfAborted();
  const next = progress.status === "fulfilled" ? progress.value : null;
  const newReady = next?.slots.some(slot => slot.status === "ready" && !snapshot?.outputs.some(output => output.id === slot.id));
  if (snapshot?.known && notice?.progress && notice.event !== "terminal" && progress.status === "fulfilled" && !newReady) {
    return [progress, { status: "fulfilled", value: snapshot.outputs }] as const;
  }
  // Read outputs after progress so completion cannot be paired with an older output list.
  const [saved] = await Promise.allSettled([
    api(`/v1/projects/${projectId}/outputs`, signal).then(value => readOutputs(value, projectId)),
  ]);
  signal.throwIfAborted();
  return [progress, saved] as const;
}
export function pendingBatch(
  storage: Storage,
  identity: string,
  project: string,
) {
  const key = `riflo:batch:${identity}:${project}`;
  return {
    read(): { key: string; selection: Selection; brand?: BrandRequest; controls?: GenerationControls } | null {
      try {
        const v = JSON.parse(storage.getItem(key) || "null");
        if (
          !record(v) ||
          typeof v.key !== "string" ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(v.key) ||
          !record(v.selection) ||
          !Object.entries(v.selection).every(
            ([k, n]) =>
              known(k) && Number.isSafeInteger(n) && (n as number) >= 0,
          ) ||
          !Object.values(v.selection).some((n) => (n as number) > 0)
        )
          return null;
        if (v.brand !== undefined) readBrandRequest(v.brand);
        if (v.controls !== undefined) readControls(v.controls, v.selection as Selection);
        return v as { key: string; selection: Selection; brand?: BrandRequest; controls?: GenerationControls };
      } catch {
        return null;
      }
    },
    save(v: { key: string; selection: Selection; brand?: BrandRequest; controls?: GenerationControls }) {
      storage.setItem(key, JSON.stringify(v));
    },
    clear(requestKey?: string) {
      if (requestKey && this.read()?.key !== requestKey) return;
      storage.removeItem(key);
    },
  };
}

export type WritingPreferenceOptions = {
  languages: string[];
  limits: { audience: number; voice: number; language: number; spelling: number };
};
export type Availability = {
  controls?: ControlsAvailability;
  lifecycle?: Lifecycle;
  credits?: { remaining: number; costs: Record<Format, number> };
  access: { active: boolean; reason: string; expiresAt: string | null };
  preferences: WritingPreferenceOptions;
  transcription?: { status: "ready" | "processing" | "failed" | "not_started" | "unavailable"; retryAvailable: boolean; reason: string; errorCode?: string | null };
  sourceAvailable: boolean;
  transcriptAvailable: boolean;
  sourceExpiresAt: string | null;
  transcriptExpiresAt: string | null;
  transcriptRetentionMode?: RetentionMode;
  activeBatch: boolean;
  outputs: Record<Format, { available: boolean; reason: string }>;
};
export const availabilityMessages: Record<string, string> = {
  generation_not_configured: "Generation is currently unavailable.",
  feature_not_implemented: "This format is currently unavailable.",
  transcription_not_retryable: "This video could not be transcribed. Choose another source.",
  generation_in_progress: "Generation is already in progress.",
  requires_reimport: "Import the video again to create this format.",
  transcript_not_ready: "Prepare the transcript before creating content.",
  source_not_ready: "Available once your video is imported.",
  subscription_required: "Active account access is required.",
  feature_not_in_plan: "Not included in your plan.",
  allowance_exceeded: "Your remaining allowance has been used.",
};
export function readAvailability(value: unknown): Availability {
  const date = (v: unknown) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
  if (!record(value) || !record(value.access) ||
      typeof value.access.active !== "boolean" || typeof value.access.reason !== "string" || !date(value.access.expiresAt) ||
      !record(value.preferences) || !Array.isArray(value.preferences.languages) ||
      !value.preferences.languages.every(item => typeof item === "string" && item.trim().length > 0) ||
      !record(value.preferences.limits) ||
      !["audience", "voice", "language", "spelling"].every(field => {
        const limit = (value.preferences as WritingPreferenceOptions).limits[field as keyof WritingPreferenceOptions["limits"]];
        return Number.isSafeInteger(limit) && limit > 0;
      })) throw new Error("Unexpected generation availability.");
  if (!record(value) || typeof value.sourceAvailable !== "boolean" || typeof value.transcriptAvailable !== "boolean" || typeof value.activeBatch !== "boolean" || !date(value.sourceExpiresAt) || !date(value.transcriptExpiresAt) || !record(value.outputs) || !formats.every(([feature]) => {
    const item = (value.outputs as Record<string, unknown>)[feature];
    return record(item) && typeof item.available === "boolean" && typeof item.reason === "string" && ["available", ...Object.keys(availabilityMessages)].includes(item.reason) && item.available === (item.reason === "available");
  })) {
    throw new Error("Unexpected generation availability.");
  }
  if (!retentionMode(value.transcriptRetentionMode)) throw new Error("Unexpected transcript retention.");
  if (value.lifecycle !== undefined) readLifecycle(value.lifecycle);
  if (value.transcription !== undefined) {
    const t = value.transcription;
    if (!record(t) || !["ready", "processing", "failed", "not_started", "unavailable"].includes(String(t.status)) || typeof t.retryAvailable !== "boolean" || !["available", "transcript_ready", "generation_in_progress", "transcription_not_retryable", "transcription_not_failed", "generation_not_configured", "requires_reimport", "source_not_ready", "subscription_required"].includes(String(t.reason)) || (t.errorCode !== undefined && t.errorCode !== null && typeof t.errorCode !== "string") || (t.retryAvailable && (t.status !== "failed" || t.reason !== "available"))) throw new Error("Unexpected transcription availability.");
  }
  if (value.credits !== undefined) {
    const credits = value.credits;
    if (!record(credits) || !Number.isSafeInteger(credits.remaining) || (credits.remaining as number) < 0 ||
        !record(credits.costs) || !formats.every(([key]) => {
      const cost = (credits.costs as Record<string, unknown>)[key];
      return typeof cost === "number" && Number.isSafeInteger(cost) && cost > 0;
    })) throw new Error("Unexpected creation credits.");
  }
  if (value.controls !== undefined) readControlsAvailability(value.controls);
  return value as Availability;
}

export function formatAction(allowed: boolean, checking: boolean, temporary: boolean, hasSaved: boolean) {
  if (checking) return "checking";
  if (allowed && !temporary) return "create";
  if (hasSaved) return "view";
  return temporary ? "waiting" : "unavailable";
}
