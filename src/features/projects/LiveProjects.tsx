import { Button } from "@/components/ui/button";
import { useReadyMotion } from "../../shared/ui/motion";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useEffect, useState } from "react";
import { errorMessage, type StudioApi } from "../../shared/api/client";
import {
  readCapabilities,
  intakeAvailable,
  readConnection,
  type Capabilities,
  type Connection,
} from "../account/account-response";
import { DriveConnection } from "./DriveConnection";
import { ProjectLibrary } from "./ProjectLibrary";
import { GenerationPanel } from "./GenerationPanel";
import { ProjectSettings } from "./ProjectSettings";
import { LiveProjectDetail } from "./LiveProjectDetail";
import { UsagePage } from "../account/UsagePage";
import { accessMessage } from "../account/access-message";
export function LiveProjects({ route, api }: { route: string; api: StudioApi }) {
  if (route === "project-settings") return <ProjectSettings key={window.location.pathname} api={api} />;
  if (route === "project") {
    return <LiveProjectDetail key={window.location.pathname} api={api}>
      {project => <GenerationPanel api={api} project={project} />}
    </LiveProjectDetail>;
  }
  return <AccountWorkspace route={route} api={api} />;
}

function AccountWorkspace({ route, api }: { route: string; api: StudioApi }) {
  const usesDrive = route === "projects" || route === "connections";
  const [capabilities, setCapabilities] = useState<Capabilities | null>(() => api.snapshot("/v1/capabilities", readCapabilities));
  const [connection, setConnection] = useState<Connection | null>(() => api.snapshot("/v1/drive/connection", readConnection));
  const [connectionError, setConnectionError] = useState("");
  const [connectionRefresh, setConnectionRefresh] = useState(0);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [driveRecoveryVisible, setDriveRecoveryVisible] = useState(false);
  useEffect(() => {
    const controller = new AbortController();

    setError("");
    setCheckingAccess(true);
    api("/v1/capabilities", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setCapabilities(readCapabilities(value));
          setCheckingAccess(false);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause));
        }
      });
    return () => controller.abort();
  }, [api, refresh, route]);
  useEffect(() => {
    if (!usesDrive) return;
    const controller = new AbortController();
    setCheckingConnection(true);
    setConnectionError("");
    const timeout = setTimeout(() => {
      setConnectionError("Google Drive status took too long to load.");
      controller.abort();
    }, 10_000);
    api("/v1/drive/connection", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setConnection(readConnection(value));
          setCheckingConnection(false);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setConnectionError(errorMessage(cause));
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [api, connectionRefresh, route, usesDrive]);
  useEffect(() => {
    const deadline = Date.parse(capabilities?.lifecycle?.nextChangeAt ?? "");
    if (!(deadline > Date.now())) return;
    const timer = setTimeout(() => setRefresh(value => value + 1), Math.min(deadline - Date.now() + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [capabilities]);
  const motion = useReadyMotion(route === "projects" || capabilities !== null);
  const connectionMotion = useReadyMotion(connection !== null);
  const access = capabilities && accessMessage(capabilities.subscription, capabilities.lifecycle);
  if (error && !capabilities && route !== "projects") {
    return (
      <section className="empty-panel" role="alert">
        <h1>A little interruption.</h1>
        <p>{error}</p>
        <Button onClick={() => setRefresh(value => value + 1)}>Try again</Button>
      </section>
    );
  }
  if (!capabilities && route !== "projects") {
    return (
      <PageSkeleton kind={route === "usage" || route === "connections" || route === "project" ? route : "projects"} />
    );
  }
  return (
    <div ref={motion}>
      {error && <div className={route === "connections" ? "mb-6 flex flex-wrap items-center justify-between gap-4 border-0 border-l-2 border-solid border-[var(--warning)] py-2 pl-4 text-sm text-[var(--warning)]" : "inline-notice"} role="alert"><p>{error} New work is paused until account access can be checked.</p><Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Retry access check</Button></div>}
      {usesDrive && (connectionError || (!connection && route !== "projects")) && !(route === "projects" && driveRecoveryVisible) && (
        <div
          className={route === "connections" ? "mb-6 flex flex-wrap items-center justify-between gap-4 border-0 border-l-2 border-solid border-[var(--warning)] py-2 pl-4 text-sm text-[var(--warning)]" : "drive-status-notice"}
          role={connectionError ? "alert" : "status"}
        >
          <p>
            {connectionError
              ? "We could not check Google Drive. Drive actions are paused; your other work is available."
              : "Checking Google Drive. Your other work is available."}
          </p>
          <Button variant="outline" disabled={!connectionError} onClick={() => setConnectionRefresh(value => value + 1)}>Retry connection status</Button>
        </div>
      )}
      {access && route !== "project" && route !== "usage" && (
        <div className={route === "connections" ? "mb-6 flex flex-wrap items-center justify-between gap-4 border-0 border-l-2 border-solid border-[var(--warning)] py-2 pl-4 text-sm" : "generation-access-notice"} role="status">
          <div><strong>{access.title}</strong><p>{access.detail}</p></div>
          <Button variant="outline" asChild><a href="/usage">View access details</a></Button>
        </div>
      )}
      <div ref={route === "connections" ? connectionMotion : undefined}>
      {route === "connections" && capabilities ? (
        connection ? (
          <DriveConnection
            api={api}
            connection={connection}
            active={intakeAvailable(capabilities)}
            checking={(checkingAccess && !error) || (checkingConnection && !connectionError)}
            unverified={!!error || !!connectionError}
            statusFailed={!!connectionError}
            onChange={() => setConnectionRefresh((value) => value + 1)}
          />
        ) : connectionError ? (
          <><div className="page-heading"><div><p className="eyebrow">YOUR CONNECTIONS</p><h1>Bring your work along<span className="accent-text">.</span></h1><p>A connection for the videos you choose. Your other files stay yours.</p></div></div><section className="border-0 border-t border-solid border-border py-8"><p className="eyebrow">GOOGLE DRIVE</p><h2 className="mt-2 text-2xl">Connection status unavailable.</h2><p className="mt-4 text-sm text-muted-foreground">Retry the connection check above to manage Google Drive.</p></section></>
        ) : (
          <PageSkeleton kind="connections" />
        )
      ) : route === "projects" ? (
        <ProjectLibrary
          api={api}
          onDriveRecoveryChange={setDriveRecoveryVisible}
          capabilities={capabilities}
          checkingAccess={checkingAccess || !!error}
          connection={checkingConnection || connectionError ? null : connection}
          onAccessChange={() => setRefresh((value) => value + 1)}
          onConnectionRefresh={() => setConnectionRefresh((value) => value + 1)}
        />
      ) : route === "usage" && capabilities ? (
        <UsagePage api={api} capabilities={capabilities} checkingAccess={checkingAccess && !error} onAccessRefresh={() => setRefresh(value => value + 1)} />
      ) : (
        <section className="empty-panel">
          <h1>This page wandered off.</h1>
          <Button asChild><a href="/projects">Back to projects</a></Button>
        </section>
      )}
      </div>
    </div>
  );
}
