import { ApiError, type StudioApi } from "../../shared/api/client.ts";
import { observeOperation } from "./observe-operation.ts";
import { importPending, readImportProgress, readProject, reconcileImportProgress, type Project } from "./project-response.ts";

export function pollProject(
  api: StudioApi,
  id: string,
  initial: Project | null,
  onProject: (project: Project | null) => void,
  onError: (cause: unknown, retrying: boolean) => void,
) {
  let known = initial;
  let updates = 0;
  let latest: { operationId: string; attempt: number; updatedAt: number; cleared: boolean } | undefined;

  return observeOperation(api, async signal => {
    try {
      const beforeRead = updates;
      const saved = readProject(await api(`/v1/projects/${id}`, signal));
      let next = reconcileImportProgress(known, saved);
      // A notice can arrive while a legacy/recovery GET is in flight. Keep its newer
      // pending state, but let canonical terminal state and replacement operations win.
      if (updates !== beforeRead && known && importPending(known) && importPending(next) && known.importOperationId === next.importOperationId) {
        const canonicalProgress = readImportProgress(next.importProgress);
        // Reconciliation above already selected the newest attempt/stage/bytes.
        // Preserve an in-flight retry clear only through its own attempt.
        const progress = !canonicalProgress || (!known.importProgress && canonicalProgress.attempt <= (latest?.attempt ?? 0))
          ? known.importProgress : next.importProgress;
        next = { ...next, ...(known.preparation ? { preparation: known.preparation, transcriptionStage: known.transcriptionStage } : {}), status: known.status === "importing" || next.status === "importing" ? "importing" : "queued", importProgress: progress };
      }
      if (latest?.operationId !== next.importOperationId) latest = undefined;
      signal.throwIfAborted();
      known = next;
      onProject(next);
      return importPending(next) && next.importOperationId ? { projectId: id, kind: "import", id: next.importOperationId } : null;
    } catch (cause) {
      if (!signal.aborted && cause instanceof ApiError && [401, 403, 404].includes(cause.status)) onProject(null);
      throw cause;
    }
  }, onError, () => !!known && importPending(known) && !known.importOperationId, undefined, notice => {
    const state = notice.importState;
    if (!state) return false; // Older servers still send invalidation-only notices.
    if (!known || !importPending(known) || notice.operation.kind !== "import" ||
        notice.operation.projectId !== known.id || notice.operation.id !== known.importOperationId) return true;
    const before = readImportProgress(known.importProgress);
    const attempt = Math.max(before?.attempt ?? 0, latest?.attempt ?? 0);
    if (state.attempt < attempt || (latest && state.attempt === latest.attempt &&
        (state.updatedAt < latest.updatedAt || (latest.cleared && !!state.progress))) ||
        (state.attempt === attempt && known.status === "importing" && state.status === "queued")) return true;
    const next = reconcileImportProgress(known, { ...known, status: state.status, transcriptionStage: state.transcriptionStage, ...(state.preparation ? { preparation: state.preparation } : {}), importProgress: state.progress });
    latest = { operationId: notice.operation.id, attempt: state.attempt, updatedAt: state.updatedAt,
      cleared: state.status === "importing" && !state.progress };
    known = next;
    updates++;
    onProject(next);
    return true;
  });
}
