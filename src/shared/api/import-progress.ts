export type ImportProgress = {
  attempt: number;
  stage: "download" | "prepare" | "upload" | "transcribe";
  transferredBytes: number;
  totalBytes: number | null;
};

export function readImportProgress(value: unknown): ImportProgress | null {
  const p = value as ImportProgress | null;
  if (!p || !Number.isSafeInteger(p.attempt) || p.attempt < 1 ||
      !["download", "prepare", "upload", "transcribe"].includes(p.stage) ||
      !Number.isSafeInteger(p.transferredBytes) || p.transferredBytes < 0 ||
      (p.totalBytes !== null && (!Number.isSafeInteger(p.totalBytes) || p.totalBytes <= 0 || p.totalBytes < p.transferredBytes)) ||
      (["prepare", "transcribe"].includes(p.stage) && (p.transferredBytes !== 0 || p.totalBytes !== null))) return null;
  return p;
}
