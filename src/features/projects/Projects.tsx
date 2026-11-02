import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { PreviewResults } from "./PreviewResults";
import { Icon } from "../../shared/ui/Icon";
import { routeHref, type PreviewState } from "../../app/routes";

const labels: Record<PreviewState, string> = {
  empty: "No projects yet",
  importing: "Importing video",
  source_ready: "Source ready",
  generating: "Generating content",
  partial: "Some content is ready",
  expired: "Source expired",
  unconfigured: "Setup needed",
};
export function Projects({
  preview,
  state,
}: {
  preview: boolean;
  state: PreviewState;
}) {
  const [sampleSource, setSampleSource] = useState<"drive" | "youtube">("drive");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE WORKSPACE</p>
          <h1>
            Your ideas,
            <br className="mobile-break" /> in motion
            <span className="accent-text">.</span>
          </h1>
          <p>Good things start with something you’ve already made.</p>
        </div>
        <Button disabled>
          <Icon name="plus" /> New project
        </Button>
      </div>
      {!preview || state === "unconfigured" ? (
        <div className="empty-panel">
          <span className="round-icon">
            <Icon name="link" size={28} />
          </span>
          <h2>Your workspace is taking shape.</h2>
          <p>
            Live sign-in and project connections are not set up yet. Explore the
            preview to see where your ideas will land.
          </p>
          {!preview && (
            <Button asChild><a href="/projects?preview=true">
              Explore sample workspace <ChevronRight size={16} aria-hidden="true" />
            </a></Button>
          )}
        </div>
      ) : state === "empty" ? (
        <div className="empty-panel">
          <span className="round-icon">
            <Icon name="plus" size={28} />
          </span>
          <h2>Your next idea starts here.</h2>
          <p>
            This is the sample empty state. When imports are connected, your
            first video will appear here.
          </p>
        </div>
      ) : (
        <>
          <fieldset className="source-choice preview-source-choice">
            <legend>Explore a sample source · nothing is imported</legend>
            {([['drive', 'Google Drive'], ['youtube', 'YouTube']] as const).map(([key, label]) => <label className="has-checked:border-primary has-checked:bg-secondary has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-offset-3 has-focus-visible:outline-ring forced-colors:has-focus-visible:outline-[Highlight] motion-reduce:transition-none" key={key} data-selected={sampleSource === key}><input className="accent-primary" type="radio" name="preview-source" value={key} checked={sampleSource === key} onChange={() => setSampleSource(key)} /><span><strong>{label}</strong><small>Illustrative sample only</small></span></label>)}
          </fieldset>
          <div className="section-heading">
            <h2>
              Your projects <span className="count">01</span>
            </h2>
            <span>Sample workspace</span>
          </div>
          <a
            className="project-card"
            href={routeHref(sampleSource === "youtube" ? "/projects/sample-youtube" : "/projects/sample", true, state)}
          >
            <div className="project-art">
              <span className="art-kicker">THE CREATIVE PRACTICE</span>
              <strong>
                Make space
                <br />
                for the
                <br />
                <em>good stuff.</em>
              </strong>
              <span className="art-orbit" aria-hidden="true" />
              <span className="video-tag">
                <Icon name="play" size={14} /> {sampleSource === "youtube" ? "YouTube" : "Google Drive"} sample · 12:40
              </span>
            </div>
            <div className="project-info">
              <span className="status-pill">
                <span />
                {labels[state]}
              </span>
              <h3>Finding your creative rhythm</h3>
              <p>
                A sample conversation about making time for meaningful work.
              </p>
              <div className="project-bottom">
                <span>Illustrative project</span>
                <span className="text-link">
                  Open project <ChevronRight size={16} aria-hidden="true" />
                </span>
              </div>
            </div>
          </a>
          <div className="gentle-note">
            <Icon name="spark" />
            <p>
              One source. A whole new set of starting points.
              <br />
              <span>
                Posts, longer reads, carousels and short videos—all in one
                place.
              </span>
            </p>
          </div>
        </>
      )}
    </>
  );
}

export function ProjectDetail({
  preview,
  state,
}: {
  preview: boolean;
  state: PreviewState;
}) {
  return (
    <div className="project-workspace-page">
      <a className="back-link" href={routeHref("/projects", preview, state)}><ChevronLeft size={16} aria-hidden="true" />All projects</a>
      <header className="project-source-summary">
        <div className="page-heading project-detail-heading">
          <div>
            <div className="project-title-row">
              <h1 className="project-title">{preview ? "Finding your creative rhythm" : "Your project"}</h1>
              <Button asChild variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground"><a href={routeHref(`${window.location.pathname.replace(/\/$/, "")}/settings`, preview, state)} aria-label="Project settings" title="Project settings"><Icon name="settings" size={18} /></a></Button>
            </div>
          </div>
        </div>
        <div id="project-create-content" className="project-create-content" />
        {state === "expired" && <div className="project-source-footer"><p className="state-warning">The original sample video has expired. Saved transcripts and outputs follow their own expiry dates.</p></div>}
      </header>
      {preview && <PreviewResults key={state} state={state} />}
    </div>
  );
}
