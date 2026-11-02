import { ChevronRight } from "lucide-react";
import { useRouteMotion } from "../shared/ui/motion";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { SignIn } from "../features/signin/SignIn";
import { PreviewProjectSettings } from "../features/projects/ProjectSettings";
import { ProjectDetail, Projects } from "../features/projects/Projects";
import { AccountPage } from "../features/account/AccountPages";
import { Brand } from "../shared/ui/Brand";
import { Icon } from "../shared/ui/Icon";
import { useAppearanceTheme } from "../shared/ui/Appearance";
import { BrandSettings } from "../features/brand/BrandSettings";
import { Settings, SettingsFrame } from "../shared/ui/Settings";
import { previewStates, readLocation, routeHref } from "./routes";

import { SessionProvider, useSession } from "../shared/auth/session";
import { LiveProjects } from "../features/projects/LiveProjects";
import { createApi, type StudioApi } from "../shared/api/client";
import { firebaseAuth } from "../shared/auth/firebase";
import { navigate, useLocation } from "./navigation";

export function App() {
  useAppearanceTheme();
  const location = useLocation();
  const { preview } = readLocation(location);
  return preview ? (
    <Studio previewMode location={location} />
  ) : (
    <SessionProvider>
      <LiveStudio location={location} />
    </SessionProvider>
  );
}

function LiveStudio({ location }: { location: URL }) {
  const session = useSession();
  const { route } = readLocation(location);
  const api = useMemo(() => session.user ? createApi({
    getToken: () => session.user!.getIdToken(),
    isCurrent: () => firebaseAuth().currentUser === session.user,
  }) : undefined, [session.user]);
  useEffect(() => {
    if (!session.loading && session.user && route === "signin") {
      navigate("/projects", true);
    }
  }, [session.loading, session.user, route]);
  if (session.loading) {
    return (
      <main className="studio-loading" role="status">
        <Brand />
        <div className="studio-loading-status">
          <span className="studio-loading-indicator" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      </main>
    );
  }
  if (!session.user) {
    return <SignIn />;
  }
  if (route === "signin") {
    return null;
  }
  return (
    <Studio
      key={session.user.uid}
      api={api}
      previewMode={false}
      location={location}
      identity={
        session.user.displayName || session.user.email || "Your account"
      }
      email={session.user.email ?? undefined}
      photoURL={session.user.photoURL ?? undefined}
      logout={session.logout}
      busy={session.busy}
      error={session.error}
    />
  );
}

function Studio({
  previewMode,
  api,
  location,
  identity,
  email,
  photoURL,
  logout,
  busy,
  error,
}: {
  previewMode: boolean;
  api?: StudioApi;
  location: URL;
  identity?: string;
  email?: string;
  photoURL?: string;
  logout?: () => Promise<void>;
  busy?: boolean;
  error?: string;
}) {
  const { route, state } = readLocation(location);
  const settings = route === "settings" || route === "brand";
  const page = settings ? "settings" : location.pathname + location.search;
  const main = useRouteMotion(page);
  const previous = useRef(page);
  useEffect(() => {
    if (previous.current !== page) {
      document.getElementById("main")?.focus();
      window.scrollTo(0, 0);
    }
    previous.current = page;
  }, [page]);
  const preview = previewMode;
  useEffect(() => {
    document.title = `${route === "signin" ? "Give your ideas room" : route === "project-settings" ? "Project settings" : route === "project" ? "Project" : route[0].toUpperCase() + route.slice(1)} — Riflo`;
  }, [route]);
  if (route === "signin") {
    return (
      <Button asChild><a href="/">Return to sign-in</a></Button>
    );
  }
  const navigation = [
    { path: "/projects", label: "Projects", icon: "projects" },
    { path: "/usage", label: "Usage", icon: "usage" },
    { path: "/connections", label: "Connections", icon: "link" },
  ] as const;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="workspace">
        <aside className="sidebar">
          <a
            className="brand-link"
            href={routeHref("/projects", preview)}
            aria-label="Riflo projects"
          >
            <Brand />
          </a>
          <nav aria-label="Main navigation">
            {navigation.map((item) => (
              <a
                key={item.path}
                href={routeHref(item.path, preview, state)}
                aria-current={
                  (route === "project" || route === "project-settings" ? "/projects" : `/${route}`) ===
                  item.path
                    ? "page"
                    : undefined
                }
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="avatar" aria-hidden="true">{preview ? "P" : (identity || "R").trim().charAt(0).toUpperCase()}{photoURL && <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}</span>
            <div>
              <strong title={preview ? "Preview studio" : identity}>{preview ? "Preview studio" : identity}</strong>
              <span>{preview ? "Sample content" : "Google account"}</span>
            </div>
            <a className="settings-trigger" href={routeHref("/settings", preview, state)} aria-label="Settings" title="Settings" aria-current={["settings", "brand"].includes(route) ? "page" : undefined}><Icon name="settings" size={18} /></a>
          </div>
        </aside>
        <div className="workspace-body">
          {preview && (
            <div className="preview-bar">
              <div>
                <strong>Preview</strong>
                <span>Sample content. Nothing is uploaded or generated.</span>
              </div>
              <a className="inline-flex items-center gap-2" href="/projects">Exit preview <ChevronRight size={16} aria-hidden="true" /></a>
            </div>
          )}
          <main ref={main} id="main" className="page" tabIndex={-1}>
            {settings ? (
              <StudioSettings section={route === "brand" ? "brand" : "general"} api={api} identity={preview ? "Preview studio" : identity} email={email} photoURL={photoURL} preview={preview} logout={logout} busy={busy} error={error} />
            ) : !preview ? (
              <LiveProjects api={api!} route={route} />
            ) : route === "projects" ? (
              <Projects preview={preview} state={state} />
            ) : route === "project-settings" ? (
              <PreviewProjectSettings state={state} />
            ) : route === "project" ? (
              <ProjectDetail preview={preview} state={state} />
            ) : route === "usage" || route === "connections" ? (
              <AccountPage kind={route} preview={preview} state={state} />
            ) : (
              <div className="empty-panel">
                <h1>This page wandered off.</h1>
                <Button asChild><a href={routeHref("/projects", preview)}>Back to projects</a></Button>
              </div>
            )}
          </main>
          {preview && route !== "settings" && route !== "brand" && (
            <form className="preview-controls" method="get">
              <input type="hidden" name="preview" value="true" />
              <label htmlFor="preview-state">Explore a sample project state</label>
              <div className="min-w-0 flex-1 max-w-60">
              <NativeSelect id="preview-state" name="state" defaultValue={state}>
                {previewStates.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              </div>
              <Button variant="outline" type="submit">
                Show sample state <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function StudioSettings({ section, api, ...general }: Parameters<typeof Settings>[0] & {
  section: "general" | "brand"; api?: StudioApi;
}) {
  const [visitedBrand, setVisitedBrand] = useState(section === "brand");
  useEffect(() => { if (section === "brand") setVisitedBrand(true); }, [section]);
  return <SettingsFrame section={section} preview={general.preview}>
    {section === "general" && <Settings {...general} api={api} />}
    {(visitedBrand || section === "brand") && <div hidden={section !== "brand"}>
      <BrandSettings api={api} preview={general.preview} active={section === "brand"} />
    </div>}
  </SettingsFrame>;
}
