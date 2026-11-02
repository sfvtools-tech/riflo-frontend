import { createId } from "../../shared/lib/id";
import { Button } from "../../components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorMessage, type StudioApi, type RetryAllowance } from "../../shared/api/client";
import { useSession } from "../../shared/auth/session";
import { readProject, type Project } from "./project-response";
import { canReleaseSubmission } from "./submission-response";
import { allowanceAmount } from "../account/usage-response";
import { pendingRetry } from "./pending-retry";

const allowanceSummary = (allowance: RetryAllowance) => `This import needs ${allowanceAmount("sourceSeconds", allowance.requiredSeconds)}; ${allowanceAmount("sourceSeconds", allowance.remainingSeconds)} remain.`;

export function ImportRetry({ api, project, onRetried, onRefresh, restore = false }: {
  api: StudioApi; project: Project; restore?: boolean; onRetried: (project: Project) => void; onRefresh: () => void;
}) {
  const { user } = useSession();
  const pending = useMemo(() => pendingRetry(sessionStorage, user!.uid, project.id, restore ? "restoration" : "import"), [user, project.id, restore]);
  const [request, setRequest] = useState(() => pending.read());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; quota: boolean; noImport: boolean; allowance: RetryAllowance | null } | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const availability = restore ? project.sourceRestore : project.importRetry;
  const endpoint = `/v1/projects/${project.id}/${restore ? "restore-source" : "retry-import"}`;
  const deadline = Math.max(retryAt ?? 0, availability?.reason === "retry_cooldown" ? Date.parse(availability.availableAt ?? "") || 0 : 0);
  useEffect(() => {
    if (!deadline) { return; }
    const timer = setTimeout(() => { setRetryAt(null); onRefresh(); }, Math.max(0, deadline - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [deadline, onRefresh]);
  async function retry() {
    if (operation.current && !operation.current.signal.aborted) { return; }
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    const hadPending = pending.read() !== null;
    const key = request ?? pending.read() ?? createId();
    try {
      pending.save(key);
      setRequest(key);
      try {
        await api.submit(endpoint, controller.signal, { key }, () => {
          pending.clear(key);
          setRequest(null);
          onRefresh();
        });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== "legacy_observation_unavailable") throw cause;
        const next = readProject(await api(endpoint, controller.signal, { method: "POST", key }));
        pending.clear(key);
        setRequest(null);
        onRetried(next);
      }
    } catch (cause) {
      if (controller.signal.aborted) { return; }
      const release = canReleaseSubmission(cause, restore ? "restoration" : "retry", hadPending);
      const quota = cause instanceof ApiError && cause.status === 403 && cause.code === "allowance_exceeded";
      setError({ message: errorMessage(cause), quota, noImport: quota && release, allowance: cause instanceof ApiError ? cause.allowance : null });
      if (release) { pending.clear(key); setRequest(null); }
      if (cause instanceof ApiError && cause.retryAfterSeconds !== null) {
        setRetryAt(Date.now() + cause.retryAfterSeconds * 1000);
      } else { onRefresh(); }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); operation.current = null; }
    }
  }
  const showRestore = project.status === "source_expired" || (project.importIntent === "source_restore" && project.status === "failed") || (project.sourceRestore !== undefined && project.sourceRestore.reason !== "source_restore_not_available");
  if (!request && (restore ? !showRestore : project.status !== "failed" || project.importIntent === "source_restore")) { return null; }
  return <div className="import-retry">
    {restore && <p>Restore a private Riflo copy from the original link. Successful restoration uses source-processing minutes. Your original Drive or YouTube video stays unchanged.</p>}
    {restore && !project.sourceRestore && <p className="state-warning">Restoration is unavailable for this project. Import the original video as a new project.</p>}
    {restore && availability?.reason === "source_restore_not_available" && <p className="state-warning">This source cannot currently be restored. Refresh its status or import the video as a new project.</p>}
    {availability?.reason === "source_access_required" && <p>Check that the original video is accessible. For Drive, reconnect or update file access before retrying.</p>}
    {availability?.reason === "allowance_exceeded" && <p className="state-warning" role="status">Not enough source video allowance remains.{!restore && project.importRetry?.allowance && ` ${allowanceSummary(project.importRetry.allowance)}`} Other imported videos may have allowance reserved. Open an existing ready project or <a className="text-link" href="/usage">check usage</a>.</p>}
    {availability?.reason === "subscription_required" && <p className="state-warning">{restore ? "Active paid access is required to restore this source." : "Active account access is required to retry this import."}</p>}
    {deadline > 0 && <p className="state-warning" role="status">Try again in about {Math.max(1, Math.ceil((deadline - Date.now()) / 60_000))} {Math.max(1, Math.ceil((deadline - Date.now()) / 60_000)) === 1 ? "minute" : "minutes"}.</p>}
    {error && <p className="state-error" role="alert">{error.message}{error.allowance && ` ${allowanceSummary(error.allowance)}`}{error.noImport && (restore ? " No restoration was started." : " No new import was started.")}{error.quota && <> Open an existing ready project or <a className="text-link" href="/usage">check usage</a>.</>}</p>}
    {request && !busy && !error && <p>{restore ? "We could not confirm whether restoration started. Check its status before trying again." : "We could not confirm whether your retry started. Check its status before trying again."}</p>}
    {busy && <p role="status">{restore ? "Checking restoration status…" : "Checking import status…"}</p>}
    <Button className="button button-primary" disabled={busy || deadline > Date.now() || (!request && !availability?.available)} onClick={() => void retry()}>{busy ? restore ? "Checking restoration status…" : "Checking import status…" : request ? restore ? "Check restoration status" : "Check import status" : restore ? "Restore source" : "Retry import"}</Button>
    <p className="quiet-note">{restore ? "Restoration starts only when you choose Restore source. It does not start content generation or recover expired transcripts." : "We’ll check the original link again. This does not start content generation."}</p>
    <a className="text-link" href="/projects">{restore ? "Import as a new project" : "Choose another source"}</a>
  </div>;
}
