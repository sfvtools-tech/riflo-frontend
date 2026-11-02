import { readImportProgress, type ImportProgress } from "../../shared/api/import-progress.ts";
export { readImportProgress, type ImportProgress } from "../../shared/api/import-progress.ts";
import { readRetryAllowance } from "../../shared/api/client.ts";
export type DriveFile = { fileId: string; resourceKey?: string };
export type YouTubeInput = { source: "youtube"; videoId: string };
export type SourceInput = DriveFile | YouTubeInput | { source: "youtube"; url: string };
export type ProjectSource = {
  name: string;
  bytes: number | null;
  durationSeconds: number | null;
} & ({ source?: "drive"; fileId: string } | { source: "youtube"; videoId: string });
export type VideoDetails = ProjectSource & { mimeType: string };
export type Project = {
  transcriptionStage?: "preparing_audio" | "transcribing";
  preparation?: "pending" | "transcribing" | "ready" | "failed";
  importProgress?: ImportProgress | null;
  id: string;
  importOperationId?: string | null;
  importIntent?: "source_restore";
  sourceRestore?: { available: boolean; reason: string; availableAt: string | null };
  status: string;
  source: ProjectSource;
  sourceUrl?: string | null;
  createdAt: string;
  sourceExpiresAt: string | null;
  errorCode: string | null;
  importRetry?: { available: boolean; reason: string; availableAt: string | null; allowance?: { requiredSeconds: number; remainingSeconds: number } };
};
export function parseDriveLink(value: string): DriveFile {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a Google Drive video link.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "drive.google.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Use an https://drive.google.com video link.");
  }
  const fileId =
    /^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1] ??
    (url.pathname === "/open" ? url.searchParams.get("id") : null);
  const resourceKey = url.searchParams.get("resourcekey");
  if (
    !fileId ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(fileId) ||
    (resourceKey !== null && !/^[A-Za-z0-9_-]{1,256}$/.test(resourceKey))
  ) {
    throw new Error("This link does not identify a Drive file.");
  }
  return { fileId, ...(resourceKey ? { resourceKey } : {}) };
}
function readProjectSource(value: unknown): ProjectSource {
  const v = value as ProjectSource | null;
  if (
    !v ||
    (v.source === "youtube"
      ? typeof v.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(v.videoId) || "fileId" in v
      : (v.source !== undefined && v.source !== "drive") || typeof v.fileId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(v.fileId) || "videoId" in v) ||
    typeof v.name !== "string" ||
    !v.name ||
    v.name.length > 4096 ||
    (v.bytes !== null && (!Number.isSafeInteger(v.bytes) || v.bytes <= 0)) ||
    (v.source !== "youtube" && v.bytes === null) ||
    (v.durationSeconds !== null &&
      (!Number.isFinite(v.durationSeconds) || v.durationSeconds <= 0))
  ) {
    throw new Error("The server returned unexpected video details.");
  }
  return v;
}
export function readVideo(value: unknown): VideoDetails {
  const v = readProjectSource(value) as VideoDetails;
  if (typeof v.mimeType !== "string" || !v.mimeType.startsWith("video/")) {
    throw new Error("The server returned unexpected video details.");
  }
  return v;
}
const statuses = [
  "queued",
  "importing",
  "source_ready",
  "source_expired",
  "failed",
  "deleted",
];
export function readProject(value: unknown): Project {
  const p = value as Project | null;
  if (
    !p ||
    typeof p.id !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(p.id) ||
    !statuses.includes(p.status) ||
    (p.importOperationId !== undefined && p.importOperationId !== null && (typeof p.importOperationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(p.importOperationId))) ||
    (p.importIntent !== undefined && p.importIntent !== "source_restore") ||
    typeof p.createdAt !== "string" ||
    !Number.isFinite(Date.parse(p.createdAt)) ||
    (p.sourceExpiresAt !== null &&
      (typeof p.sourceExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(p.sourceExpiresAt)))) ||
    (p.errorCode !== null && typeof p.errorCode !== "string")
  ) {
    throw new Error("The server returned unexpected project details.");
  }
  if (p.importRetry !== undefined && (!p.importRetry || typeof p.importRetry.available !== "boolean" || !["import_not_failed", "source_access_required", "revalidation_required", "retry_cooldown", "allowance_exceeded", "subscription_required"].includes(p.importRetry.reason) || (p.importRetry.availableAt !== null && (typeof p.importRetry.availableAt !== "string" || !Number.isFinite(Date.parse(p.importRetry.availableAt)))))) {
    throw new Error("The server returned unexpected retry details.");
  }
  if (p.sourceRestore !== undefined && (!p.sourceRestore || typeof p.sourceRestore.available !== "boolean" || !["source_restore_not_available", "retry_cooldown", "revalidation_required", "allowance_exceeded", "subscription_required"].includes(p.sourceRestore.reason) || (p.sourceRestore.availableAt !== null && (typeof p.sourceRestore.availableAt !== "string" || !Number.isFinite(Date.parse(p.sourceRestore.availableAt)))) || (p.sourceRestore.available && p.sourceRestore.reason !== "revalidation_required"))) {
    throw new Error("The server returned unexpected source restoration details.");
  }
  const allowance = p.importRetry?.allowance;
  if (allowance !== undefined && !readRetryAllowance(allowance)) {
    throw new Error("The server returned unexpected retry allowance.");
  }
  if (p.importRetry?.available && ["allowance_exceeded", "subscription_required", "retry_cooldown", "import_not_failed"].includes(p.importRetry.reason)) {
    throw new Error("The server returned inconsistent retry availability.");
  }
  if (p.transcriptionStage !== undefined && !["preparing_audio", "transcribing"].includes(p.transcriptionStage)) throw new Error("Unexpected transcription stage.");
  if (p.preparation !== undefined && !["pending", "transcribing", "ready", "failed"].includes(p.preparation)) throw new Error("Unexpected project preparation.");
  readProjectSource(p.source);
  if (p.sourceUrl !== undefined && p.sourceUrl !== null) {
    let url: URL;
    try {
      url = new URL(p.sourceUrl);
    } catch {
      throw new Error("The server returned an unexpected original video link.");
    }
    const expected = p.source.source === "youtube"
      ? `https://www.youtube.com/watch?v=${p.source.videoId}`
      : `https://drive.google.com/file/d/${p.source.fileId}/view`;
    const resourceKey = url.searchParams.get("resourcekey");
    if (p.source.source !== "youtube" && resourceKey !== null && url.searchParams.getAll("resourcekey").length === 1 && /^[A-Za-z0-9_-]{1,256}$/.test(resourceKey)) {
      url.searchParams.delete("resourcekey");
    }
    if (url.href !== expected) {
      throw new Error("The server returned an unexpected original video link.");
    }
  }
  const progress = readImportProgress(p.importProgress);
  // Progress is optional telemetry: older or malformed records keep a safe status-only view.
  if (p.importProgress !== undefined && (p.status !== "importing" || !progress)) {
    const { importProgress: _progress, ...project } = p;
    return project;
  }
  return p;
}
export function readProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) {
    throw new Error("The server returned an unexpected project list.");
  }
  return value.map(readProject);
}
export const importPending = (project: Project) =>
  project.status === "queued" || project.status === "importing";
export const projectLabels: Record<string, string> = {
  queued: "Waiting to import",
  importing: "Importing video",
  source_ready: "Source ready",
  source_expired: "Source expired",
  failed: "Import failed",
  deleted: "Project deleted",
};
export function videoDuration(seconds: number | null) {
  return seconds === null
    ? "Duration checked during import"
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export const sourceLabel = (video: ProjectSource) => video.source === "youtube" ? "YouTube" : "Google Drive";
export function videoSize(bytes: number | null) {
  if (bytes === null) { return "Size checked during import"; }
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
export const importIntentKey = (uid: string, input: SourceInput) => "source" in input
  ? `riflo-youtube-import:${uid}:${"videoId" in input ? input.videoId : input.url}`
  : `riflo-import:${uid}:${input.fileId}:${input.resourceKey ?? ""}`;

export function importProgressView(project: Project) {
  const progress = project.status === "importing" ? readImportProgress(project.importProgress) : null;
  let label = progress ? { download: "Downloading video", prepare: "Preparing video", upload: "Uploading to storage", transcribe: "Preparing transcript" }[progress.stage] : project.status === "source_ready" && project.preparation && project.preparation !== "ready" ? project.preparation === "failed" ? "Transcript needs attention" : "Preparing transcript" : projectLabels[project.status];
  const percent = progress?.stage === "upload" && progress.totalBytes ? Math.floor(progress.transferredBytes / progress.totalBytes * 100) : null;
  const bytes = progress ? `${videoSize(progress.transferredBytes)}${progress.stage !== "upload" || progress.totalBytes === null ? "" : ` / ${videoSize(progress.totalBytes)}`}` : "";
  let detail = !progress ? "Progress details will appear when available." : progress.stage === "transcribe" ? "Preparing your transcript. This page updates automatically." : progress.stage === "prepare" ? "Checking and preparing your video." :
    progress.stage === "download" ? `${bytes} received` :
    `${bytes} queued for upload${percent === 100 ? ". Waiting for storage confirmation." : ""}`;
  if (progress?.stage === "upload" && project.preparation) {
    label = project.preparation === "ready" ? "Saving video" : project.preparation === "transcribing" ? "Processing video" : "Saving video";
  }
  if (project.status === "importing" && progress?.stage === "transcribe") {
    label = "Preparing transcript";
    detail = project.preparation === "pending" ? "Your transcript is in the queue." :
      project.transcriptionStage === "preparing_audio" ? "Preparing audio for transcription." :
      project.transcriptionStage === "transcribing" ? "Transcribing your video." :
      detail;
  }
  return { label, percent, detail };
}

export function reconcileImportProgress(previous: Project | null, next: Project): Project {
  if (!previous || next.status !== "importing" || previous.status !== "importing" || previous.importOperationId !== next.importOperationId) return next;
  const before = readImportProgress(previous.importProgress), after = readImportProgress(next.importProgress);
  if (!before || !after) return next;
  const stages = ["download", "prepare", "upload", "transcribe"];
  if (after.attempt < before.attempt || (after.attempt === before.attempt &&
      (stages.indexOf(after.stage) < stages.indexOf(before.stage) ||
       (after.stage === before.stage && after.transferredBytes < before.transferredBytes)))) {
    return { ...next, importProgress: before };
  }
  return next;
}
