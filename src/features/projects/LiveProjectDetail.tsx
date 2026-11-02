import { ChevronLeft } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useContentMotion, useHeightMotion, useReadyMotion } from "../../shared/ui/motion";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../shared/ui/Icon";
import { importErrorMessage, restorationErrorMessage, errorMessage, type StudioApi } from "../../shared/api/client";
import { ImportRetry } from "./ImportRetry";
import { pollProject } from "./project-poll";
import {
  importPending,
  importProgressView,
  readProject,
  type Project,
} from "./project-response";

export function LiveProjectDetail({
  api,
  children,
}: {
  api: StudioApi;
  children?: (project: Project) => ReactNode;
}) {
  const id = window.location.pathname.split("/")[2];
  const [project, setProject] = useState<Project | null>(() => api.snapshot(`/v1/projects/${id}`, readProject));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const initial = api.snapshot(`/v1/projects/${id}`, readProject);
    setProject(current => current?.id === id ? initial ?? current : initial);
    setError("");
    return pollProject(api, id, initial, setProject, (cause, retrying) => {
      setError(cause === null ? "" : `${errorMessage(cause)}${retrying
        ? " Showing the last update. Checking import progress again automatically."
        : ""}`);
    });
  }, [api, id, attempt]);
  useEffect(() => {
    if (!project?.sourceExpiresAt || project.status !== "source_ready") return;
    const delay = Date.parse(project.sourceExpiresAt) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => setAttempt(value => value + 1), Math.min(delay + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [project?.sourceExpiresAt, project?.status, attempt]);
  const refreshProject = useCallback(() => setAttempt(value => value + 1), []);
  const motion = useReadyMotion(project !== null);
  return (
    <div ref={motion} className="project-workspace-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a className="back-link" href="/projects"><ChevronLeft size={16} aria-hidden="true" />All projects</a>
      </div>
      {error && (
        <div className="inline-notice" role="alert">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="button" onClick={() => setAttempt(attempt + 1)}>
            Refresh project
          </Button>
        </div>
      )}
      {!project && !error && <PageSkeleton kind="project" />}
      {project && (
        <>
          <header className="project-source-summary">
            <div className="page-heading project-detail-heading">
              <div>
                <div className="project-title-row">
                  <h1 className="project-title">{project.source.name}</h1>
                  <Button asChild variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground">
                    <a href={`/projects/${project.id}/settings`} aria-label="Project settings" title="Project settings"><Icon name="settings" size={18} /></a>
                  </Button>
                </div>
              </div>
            </div>
            <div id="project-create-content" className="project-create-content" />
            <div className="project-source-footer">
              <SourceActivity api={api} project={project} onRetried={next => { setProject(next); refreshProject(); }} onRefresh={refreshProject} />
            </div>
          </header>
          {children?.(project)}
        </>
      )}
    </div>
  );
}

function SourceActivity({ api, project, onRetried, onRefresh }: {
  api: StudioApi; project: Project; onRetried: (project: Project) => void; onRefresh: () => void;
}) {
  const ready = project.status === "source_ready";
  const failed = project.status === "failed";
  const restoring = project.importIntent === "source_restore";
  const transfer = importProgressView(project);
  const motion = useContentMotion(transfer.label);
  const primary = importPending(project) || failed;
  const heightMotion = useHeightMotion();
  return (
    <div ref={heightMotion} className="source-stage-motion"><section className={`source-band source-activity${ready ? " source-activity-ready" : primary ? " source-activity-main" : ""}`} aria-labelledby={ready ? undefined : "source-activity-heading"}>
      {!ready && <span className={`source-band-icon${failed ? " source-activity-error" : ""}`}>
        <Icon name={failed ? "close" : "video"} size={24} />
      </span>}
      <div className="source-activity-copy">
        {primary && <p className="source-activity-eyebrow">{restoring ? "Restoring your source" : "Video import"}</p>}
        {!ready && <h2 ref={node => { motion.current = node; }} id="source-activity-heading" aria-live="polite">{restoring && failed ? "Restoration failed" : transfer.label}</h2>}

        {project.status === "importing" && <div className="import-transfer" data-meter={transfer.percent !== null}>
          <div className="import-transfer-meter">
            {transfer.percent !== null && <>
            <div className="import-transfer-track" role="progressbar" aria-label="Video upload"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={transfer.percent ?? undefined}
              aria-valuetext={`${transfer.percent}%. ${transfer.detail}`}>
              <span style={{ transform: `scaleX(${transfer.percent / 100})` }} />
            </div>
            <strong className="import-transfer-percent" aria-hidden="true">{transfer.percent}%</strong>
            </>}
          </div>
          <p className="import-transfer-detail"><span className="generation-spinner" aria-hidden="true" />{transfer.detail}</p>
        </div>}
        {importPending(project) && <p>
          {project.status === "queued" && <span className="import-queue-status"><span className="generation-spinner" aria-hidden="true" />Your video is in the queue.</span>}
          {restoring ? "You can leave this page; restoration continues in the background." : "You can leave this page; the import continues in the background."} This page updates automatically.
        </p>}
        {failed && <>
          <p>{restoring ? "Restoration could not finish. Check the original video and the reason below before trying again." : importErrorMessage(project.errorCode)}</p>
          <details className="source-error-details"><summary>Error details</summary><p>Error reference: {project.errorCode ?? "unknown"}.</p></details>
        </>}
        {project.status === "source_expired" && <p>Your stored video copy has expired. Saved transcripts and outputs follow their own expiry dates.</p>}
        {restoring && project.errorCode && <p className="state-error" role="alert">{restorationErrorMessage(project.errorCode)}</p>}
        {(failed || restoring && project.errorCode || (project.sourceRestore?.reason === "source_access_required" || project.importRetry?.reason === "source_access_required")) && (project.sourceUrl ? <a className="text-link source-recovery-link" href={project.sourceUrl} target="_blank" rel="noopener noreferrer">Open original video <span className="sr-only">(opens in a new tab)</span><Icon name="external" size={14} /></a> : <a className="text-link source-recovery-link" href={`/projects/${project.id}/settings`}>View source in project settings</a>)}
        {failed && project.source.source === "drive" && (["drive_reconnect_required", "stale_connection"].includes(project.errorCode ?? "") || (restoring ? project.sourceRestore : project.importRetry)?.reason === "source_access_required") && <a className="text-link" href="/connections">Reconnect Google Drive</a>}
        <ImportRetry restore api={api} project={project} onRetried={onRetried} onRefresh={onRefresh} />
        <ImportRetry api={api} project={project} onRetried={onRetried} onRefresh={onRefresh} />
      </div>
    </section></div>
  );
}
