import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHeightMotion, useReadyMotion } from "../../shared/ui/motion";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { navigate } from "../../app/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { ApiError, errorMessage, type StudioApi } from "../../shared/api/client";
import { intakeAvailable, type Capabilities, type Connection } from "../account/account-response";
import {
  importPending,
  readProjects,
  importProgressView,
  videoDuration,
  sourceLabel,
  type Project,
} from "./project-response";
import { ImportVideo } from "./ImportVideo";
import { useSession } from "../../shared/auth/session";
import { observeOperation } from "./observe-operation";
import { pendingImport } from "./pending-import";

export function ProjectLibrary({
  api,
  capabilities,
  connection,
  onAccessChange,
  onConnectionRefresh,
  checkingAccess = false,
  onDriveRecoveryChange,
}: {
  api: StudioApi;
  capabilities: Capabilities | null;
  connection: Connection | null;
  onAccessChange: () => void;
  onConnectionRefresh: () => void;
  checkingAccess?: boolean;
  onDriveRecoveryChange: (open: boolean) => void;
}) {
  const { user } = useSession();
  const hasPendingImport = !!user && pendingImport(sessionStorage, user.uid).read() !== null;
  const [projects, setProjects] = useState<Project[] | null>(() => api.snapshot("/v1/projects", readProjects));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [focusImport, setFocusImport] = useState(false);
  const importToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusImport && adding) {
      document.querySelector<HTMLElement>('#project-import input:not(:disabled), #project-import a, #project-import button:not(:disabled)')?.focus();
      setFocusImport(false);
    }
  }, [focusImport, adding]);
  useEffect(() => {
    let known = projects;
    return observeOperation(api, async signal => {
      try {
        const list = readProjects(await api("/v1/projects", signal));
        signal.throwIfAborted();
        known = list;
        setProjects(list);
        return null;
      } catch (cause) {
        if (!signal.aborted && cause instanceof ApiError && [401, 403, 404].includes(cause.status)) setProjects(null);
        throw cause;
      }
    }, cause => setError(cause === null ? "" : errorMessage(cause)), () => !!known?.some(importPending));
  }, [api, attempt]);
  const motion = useReadyMotion(projects !== null);
  const importMotion = useHeightMotion(capabilities !== null);
  const canImport =
    !!capabilities && !checkingAccess && intakeAvailable(capabilities) &&
    capabilities.services?.intake.configured === true;
  // Saved projects do not depend on account or source availability checks.
  return (
    <div ref={motion} className={adding ? "project-library import-open" : "project-library"} onKeyDown={event => {
      if (adding && event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setAdding(false);
        importToggle.current?.focus();
      }
    }}>
      <div className="library-heading">
        <div className="library-heading-copy">
          <h1>{adding ? "Import a video" : "All projects"}
            {!adding && projects !== null && <span className="library-count">{projects.length}</span>}
          </h1>
          <p>{adding ? "Bring your original from Google Drive or YouTube." : "Your videos and everything you create from them."}</p>
        </div>
        <Button
          ref={importToggle}
          variant={adding ? "outline" : "default"}
          className={hasPendingImport ? "library-pending" : undefined}
          aria-expanded={adding}
          aria-controls="project-import"
          disabled={!adding && !canImport && !hasPendingImport}
          onClick={event => { setFocusImport(!adding && event.detail === 0); setAdding(!adding); }}
        >
          <Icon name={adding ? "close" : "plus"} />
          {adding ? "Close import" : hasPendingImport ? "Check import status" : "New project"}
        </Button>
      </div>
      {capabilities && !canImport && !checkingAccess && (
        <p className="inline-notice">
          {intakeAvailable(capabilities)
            ? "Video importing is awaiting setup. Your existing projects remain available."
            : "Active account access is needed to import a new video."}
        </p>
      )}
      <div ref={importMotion} className="import-region"><div className="import-region-content">
      {adding && capabilities && (
        <ImportVideo
          api={api}
          onDriveRecoveryChange={onDriveRecoveryChange}
          capabilities={capabilities}
          checkingAccess={checkingAccess}
          connection={connection}
          onAccessChange={onAccessChange}
          onConnectionRefresh={onConnectionRefresh}
          onComplete={(projectId) => {
            navigate(`/projects/${projectId}`);
          }}
        />
      )}
      </div></div>
      {error && (
        <div className="inline-notice library-error" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Refresh projects
          </Button>
        </div>
      )}
      {!projects && !error ? (
        <PageSkeleton kind="projects" contentOnly />
      ) : projects?.length === 0 ? (!adding && (
        <div className="empty-panel">
          <span className="round-icon">
            <Icon name="play" size={24} />
          </span>
          <h2>Start with something worth sharing.</h2>
          <p>
            A recording, a conversation, a good idea spoken out loud. Bring one
            video from Drive or YouTube and give it room to grow.
          </p>
          {canImport && !adding && (
            <Button
              onClick={(event) => { setFocusImport(event.detail === 0); setAdding(true); }}
            >
              Bring your first video <ChevronRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      )) : (
        projects && (
          <section className="project-ledger library-ledger" aria-label="All projects">
            <div className="library-columns" aria-hidden="true">
              <span>Project</span><span>Status</span><span>Added</span><span />
            </div>
            <ul className="library-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <a className="project-row library-row" href={`/projects/${project.id}`}>
                    <span className="library-identity">
                      <Icon name="play" size={18} />
                      <span className="project-row-name">
                        <strong>{project.source.name}</strong>
                        <span>{sourceLabel(project.source)} · {videoDuration(project.source.durationSeconds)}</span>
                      </span>
                    </span>
                    <span className="library-row-details">
                      <span className={`status-pill${project.status === "failed" || project.preparation === "failed" ? " state-error" : ""}`}>
                        <span />{importProgressView(project).label}
                      </span>
                      <span className="library-added">{new Date(project.createdAt).toLocaleDateString()}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
