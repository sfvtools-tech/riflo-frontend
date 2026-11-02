import { ChevronLeft } from "lucide-react";
import { routeHref, type PreviewState } from "../../app/routes";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { ApiError, errorMessage, type StudioApi } from "../../shared/api/client";
import { Icon } from "../../shared/ui/Icon";
import { retentionRefreshDelay } from "./retention";
import { DeleteProject } from "./DeleteProject";
import { readProject, sourceLabel, videoDuration, videoSize, type Project } from "./project-response";
import { readAvailability, type Availability } from "./generation-response";

export function ProjectSettings({ api }: { api: StudioApi }) {
  const id = window.location.pathname.split("/")[2];
  const path = `/v1/projects/${id}`;
  const [project, setProject] = useState<Project | null>(() => api.snapshot(path, readProject));
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setMissing(false);
    api(path, controller.signal).then(readProject).then(value => {
      if (controller.signal.aborted) return;
      setProject(value.status === "deleted" ? null : value);
      setMissing(value.status === "deleted");
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setProject(null);
      if (cause instanceof ApiError && cause.status === 404) setMissing(true);
      else setError(errorMessage(cause));
    });
    return () => controller.abort();
  }, [api, path, attempt]);
  return <div className="project-settings-page max-w-3xl">
    <a className="back-link" href={missing ? "/projects" : `/projects/${id}`}><ChevronLeft size={16} aria-hidden="true" />{missing ? "All projects" : "Back to project"}</a>
    <header className="mb-10 mt-6">
      <h1 className="!font-sans !text-3xl !font-semibold !tracking-tight">Project settings</h1>
      {project && <p className="mt-3 break-words text-sm text-muted-foreground">{project.source.name}</p>}
    </header>
    {missing ? <section role="status"><h2 className="font-sans text-xl font-semibold tracking-normal">This project is no longer available.</h2><p className="mt-3 text-sm text-muted-foreground">It may have been deleted, or you may not have access to it.</p></section>
      : error ? <section role="alert"><h2 className="font-sans text-xl font-semibold tracking-normal">Could not load project settings.</h2><p className="my-4 text-sm text-muted-foreground">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button></section>
      : !project ? <div role="status" className="py-8 text-sm text-muted-foreground">Loading project settings…</div>
      : <>
        <section aria-labelledby="project-source-heading">
          <h2 id="project-source-heading" className="font-sans text-base font-semibold tracking-normal">Source video</h2>
          <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-6 gap-y-5 text-sm leading-6">
            <dt className="text-muted-foreground">Platform</dt><dd className="m-0">{sourceLabel(project.source)}</dd>
            {project.source.durationSeconds !== null && <><dt className="text-muted-foreground">Duration</dt><dd className="m-0">{videoDuration(project.source.durationSeconds)}</dd></>}
            {project.source.bytes !== null && <><dt className="text-muted-foreground">File size</dt><dd className="m-0">{videoSize(project.source.bytes)}</dd></>}
            {project.sourceUrl && <><dt className="text-muted-foreground">Original video</dt><dd className="m-0"><a className="text-link inline-flex min-h-11 items-center gap-2" href={project.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open original video (opens in a new tab)">Open original <Icon name="external" size={14} /></a></dd></>}
          </dl>
        </section>
        <section className="mt-8 border-0 border-t border-solid border-border pt-8" aria-labelledby="project-retention-heading">
          <h2 id="project-retention-heading" className="font-sans text-base font-semibold tracking-normal">Storage & availability</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">

            <ProjectRetention api={api} id={id} />
          </div>
        </section>
        <section className="mt-10 flex flex-wrap items-center justify-between gap-5 border-0 border-t border-solid border-border pt-8" aria-labelledby="project-delete-heading">
          <div><h2 id="project-delete-heading" className="font-sans text-base font-semibold tracking-normal">Delete project</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Remove this project and its saved content from Riflo. Your original video stays unchanged.</p></div>
          <DeleteProject api={api} project={project} />
        </section>
      </>}
  </div>;
}

function ProjectRetention({ api, id }: { api: StudioApi; id: string }) {
  const path = `/v1/projects/${id}/generation/availability`;
  const [availability, setAvailability] = useState<Availability | null>(() => api.snapshot(path, readAvailability));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api(path, controller.signal).then(readAvailability).then(value => {
      if (!controller.signal.aborted) setAvailability(value);
    }).catch(cause => { if (!controller.signal.aborted) { setAvailability(null); setError(errorMessage(cause)); } });
    return () => controller.abort();
  }, [api, path, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", visible);
    const delay = retentionRefreshDelay([availability?.sourceExpiresAt, availability?.transcriptExpiresAt, availability?.access.expiresAt, availability?.lifecycle?.nextChangeAt], Date.now());
    const timer = delay === null ? undefined : setTimeout(refresh, delay);
    return () => { document.removeEventListener("visibilitychange", visible); clearTimeout(timer); };
  }, [availability, attempt]);
  if (error) return <div role="alert"><p>Availability could not be checked. {error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Retry availability</Button></div>;
  if (!availability) return <p role="status">Checking availability…</p>;
  return <>
    {availability.sourceExpiresAt && <p>Stored video copy expiry: {new Date(availability.sourceExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} (your local time).</p>}
    <p>{availability.sourceAvailable ? "Stored video copy available." : "Stored video copy is not currently available."}</p>
    {availability.transcriptAvailable ? <p>Transcript available{availability.transcriptRetentionMode === "while_paid" ? " while your paid access continues" : availability.transcriptExpiresAt ? ` until ${new Date(availability.transcriptExpiresAt).toLocaleString()}` : ""}.</p>
      : availability.sourceAvailable && availability.transcription?.status === "not_started" ? <p>A transcript is prepared during import for new projects. Older projects prepare it when you first generate eligible content.</p> : <p>Transcript is not currently available.</p>}
    {!availability.sourceAvailable && availability.transcriptAvailable && <p>You can still create eligible formats from your transcript. New video clips require importing the original again.</p>}
  </>;
}

export function PreviewProjectSettings({ state }: { state: PreviewState }) {
  const projectPath = window.location.pathname.replace(/\/settings\/?$/, "");
  return <div className="project-settings-page max-w-3xl">
    <a className="back-link" href={routeHref(projectPath, true, state)}><ChevronLeft size={16} aria-hidden="true" />Back to project</a>
    <header className="mb-10 mt-6"><h1 className="!font-sans !text-3xl !font-semibold !tracking-tight">Project settings</h1><p className="mt-3 text-sm text-muted-foreground">Finding your creative rhythm</p></header>
    <section><h2 className="font-sans text-base font-semibold tracking-normal">Source video</h2><dl className="mt-5 grid grid-cols-2 gap-5 text-sm"><dt>Platform</dt><dd className="m-0">{projectPath.endsWith("sample-youtube") ? "YouTube" : "Google Drive"}</dd><dt>Duration</dt><dd className="m-0">12:40</dd><dt>File size</dt><dd className="m-0">84 MB</dd></dl></section>
    <section className="mt-8 border-0 border-t border-solid border-border pt-8"><h2 className="font-sans text-base font-semibold tracking-normal">Storage & availability</h2><p className="mt-4 text-sm text-muted-foreground">{state === "expired" ? "The original sample video has expired." : "This is a sample project. No source video is stored."}</p></section>
    <section className="mt-10 border-0 border-t border-solid border-border pt-8"><h2 className="font-sans text-base font-semibold tracking-normal">Delete project</h2><p className="mt-3 text-sm text-muted-foreground">Sample projects cannot be deleted.</p></section>
  </div>;
}
