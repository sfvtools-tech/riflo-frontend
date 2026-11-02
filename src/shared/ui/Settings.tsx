import { GenerationDefaultsSection } from '../../features/account/GenerationDefaults';
import type { StudioApi } from '../api/client';
import { Icon } from "./Icon";
import { Button } from "@/components/ui/button";
import { Appearance } from "./Appearance";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useContentMotion } from "./motion";

export function SettingsFrame({ section, preview, children }: { section: "general" | "brand"; preview: boolean; children: ReactNode }) {
  const query = preview ? "?preview=true" : "";
  const content = useContentMotion(section);
  const previous = useRef(section);
  useEffect(() => {
    if (previous.current !== section) content.current?.focus({ preventScroll: true });
    previous.current = section;
  }, [section, content]);
  return <div className={`settings-page settings-${section}`}>
    <header className="settings-header"><h1>Settings</h1></header>
    <div className="settings-layout">
    <nav className="settings-nav" aria-label="Settings sections">
      <a href={`/settings${query}`} aria-current={section === "general" ? "page" : undefined}>General</a>
      <a href={`/settings/brand${query}`} aria-current={section === "brand" ? "page" : undefined}>Brand</a>
    </nav>
    <section ref={content} className="settings-content" tabIndex={-1} aria-label={section === "general" ? "General settings" : "Brand settings"}>{children}</section>
    </div>
  </div>;
}

export function Settings({ api, identity, email, photoURL, preview, logout, busy, error }: {
  api?: StudioApi;
  identity?: string;
  email?: string;
  photoURL?: string;
  preview: boolean;
  logout?: () => Promise<void>;
  busy?: boolean;
  error?: string;
}) {
  return <div className="settings-section-group">
    <section className="settings-section" aria-labelledby="account-heading">
      <div className="settings-section-heading"><h2 id="account-heading">Account</h2></div>
      <div className="settings-profile">
        <span className="avatar" aria-hidden="true">{(identity || "R").trim().charAt(0).toUpperCase()}{photoURL && <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}</span>
        <div className="settings-identity"><strong>{identity || "Your account"}</strong>{email && email !== identity && <span>{email}</span>}<p>{preview ? "A sample studio account." : "Signed in with Google"}</p></div>
        {!preview && <Button asChild variant="link" className="ml-0 basis-full justify-start px-0 has-[>svg]:px-0 text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary min-[761px]:ml-auto min-[761px]:basis-auto"><a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer">Manage Google Account <Icon name="external" size={16} /></a></Button>}
      </div>
    </section>
    <section className="settings-section settings-appearance" aria-label="Display preferences"><Appearance segmented /></section>
    <GenerationDefaultsSection api={api} preview={preview} />
    {!preview && <section className="settings-section settings-session" aria-label="Sign out">
      <Button variant="destructive-subtle" className="min-w-26" onClick={logout} disabled={busy} aria-busy={busy}>{busy ? "Signing out…" : "Sign out"}</Button>
      {error && <p className="settings-error" role="alert">{error}</p>}
    </section>}
    </div>;
}
