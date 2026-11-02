import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "../../shared/ui/Icon";
import { errorMessage, type StudioApi } from "../../shared/api/client";
import type { Connection } from "../account/account-response";

export function DriveConnection({
  api,
  connection,
  active,
  onChange,
  checking = false,
  unverified = false,
  statusFailed = false,
}: {
  api: StudioApi;
  connection: Connection;
  active: boolean;
  onChange: () => void;
  checking?: boolean;
  unverified?: boolean;
  statusFailed?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revocationFailed, setRevocationFailed] = useState(false);
  const [messageTone, setMessageTone] = useState<"success" | "error" | "warning" | "">("");
  // A successful status read supplies a new validated connection object.
  const [disconnectedAt, setDisconnectedAt] = useState<Connection | null>(null);
  const connected = connection.connected && disconnectedAt !== connection;
  const operation = useRef<AbortController | null>(null);
  const disconnectionMessageAt = useRef<Connection | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function connect() {
    if (busy || checking || unverified || !active || !connection.configured || operation.current) return;
    disconnectionMessageAt.current = null;
    setRevocationFailed(false);
    // Reserve the window during the click; browsers block windows opened after a request.
    const popup = window.open(
      "about:blank",
      "riflo-drive",
      "popup,width=560,height=700",
    );
    if (!popup) {
      setMessageTone("error");
      setMessage("Allow popups for Riflo, then try connecting again.");
      return;
    }
    popup.opener = null;
    const controller = new AbortController();
    operation.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout>;
    let popupTimer: ReturnType<typeof setInterval>;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(deadlineTimer);
      clearInterval(popupTimer);
      popup.close();
    };
    const cancelled = () => {
      cleanup();
      const reason = controller.signal.reason;
      if (
        reason instanceof DOMException &&
        ["TimeoutError", "PopupClosed"].includes(reason.name)
      ) {
        setMessageTone("warning");
        setMessage(
          reason.name === "TimeoutError"
            ? "We could not confirm the connection in time. Refresh the connection status before trying again."
            : "The Google window was closed. Refresh the connection status before trying again.",
        );
        setBusy(false);
      }
    };
    controller.signal.addEventListener("abort", cancelled, { once: true });
    // These timers keep cancellation working even while a network request is stalled.
    deadlineTimer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Connection timed out", "TimeoutError"),
        ),
      5 * 60 * 1000,
    );
    popupTimer = setInterval(() => {
      if (popup.closed) {
        controller.abort(new DOMException("Window closed", "PopupClosed"));
      }
    }, 500);
    setBusy(true);
    setMessageTone("");
    setMessage(
      "Complete Google’s permission screen, then return here. We will check the connection.",
    );
    try {
      const result = await api<{ authorizationUrl: string }>(
        "/v1/drive/connection/authorize",
        controller.signal,
        { method: "POST" },
      );
      const url = new URL(result.authorizationUrl);
      if (
        url.origin !== "https://accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth"
      ) {
        throw new Error(
          "The server returned an unexpected Google connection address.",
        );
      }
      popup.location.href = url.href;
      while (!controller.signal.aborted) {
        const status = await api<Connection>(
          "/v1/drive/connection",
          controller.signal,
        );
        if (status.connected === true) {
          setDisconnectedAt(null);
          setMessageTone("success");
          setMessage("Google Drive is connected.");
          onChange();
          return;
        }
        if (popup.closed) {
          throw new Error(
            "Connection did not finish. Try again when you are ready.",
          );
        }
        await new Promise<void>((resolve, reject) => {
          const aborted = () => {
            clearTimeout(timer);
            reject(new DOMException("Cancelled", "AbortError"));
          };
          controller.signal.addEventListener("abort", aborted, { once: true });
          timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", aborted);
            resolve();
          }, 2000);
        });
      }
      throw new Error("The connection timed out. Please try again.");
    } catch (cause) {
      if (!controller.signal.aborted) {
        setMessageTone("error");
        setMessage(errorMessage(cause));
      }
    } finally {
      cleanup();
      operation.current = null;
      controller.signal.removeEventListener("abort", cancelled);
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }
  async function disconnect() {
    if (busy || checking || unverified || operation.current) return;
    disconnectionMessageAt.current = null;
    setRevocationFailed(false);
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setMessage("");
    setMessageTone("");
    try {
      const result = await api<{ connected: boolean; revocation: string }>(
        "/v1/drive/connection",
        controller.signal,
        { method: "DELETE" },
      );
      if (result.connected !== false) {
        throw new Error("Could not confirm disconnection. Refresh to check.");
      }
      setDisconnectedAt(connection);
      disconnectionMessageAt.current = connection;
      setRevocationFailed(result.revocation === "failed");
      setMessageTone(result.revocation === "failed" ? "warning" : "success");
      setMessage(
        result.revocation === "failed"
          ? "Riflo removed its saved access. Google could not confirm revocation; remove Riflo in your Google account’s third-party connections too."
          : "Google Drive disconnected.",
      );
      // Keep the revocation result until a validated status replaces it.
    } catch (cause) {
      if (!controller.signal.aborted) {
        setMessageTone("error");
        setMessage(errorMessage(cause));
      }
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }
  return <DriveConnectionView connection={{ ...connection, connected }} active={active} checking={checking} unverified={unverified} statusFailed={statusFailed} revocationFailed={revocationFailed && disconnectionMessageAt.current === connection} busy={busy} message={disconnectionMessageAt.current && disconnectionMessageAt.current !== connection ? "" : message} messageTone={messageTone} onConnect={connect} onDisconnect={disconnect} onRefresh={onChange} />;
}

export function DriveConnectionView({
  connection, active = true, checking = false, unverified = false, statusFailed = false, revocationFailed = false, busy = false, message = "",
  messageTone = "", preview = false, onConnect, onDisconnect, onRefresh,
}: {
  connection: Connection;
  active?: boolean;
  checking?: boolean;
  unverified?: boolean;
  busy?: boolean;
  message?: string;
  messageTone?: "success" | "error" | "warning" | "";
  statusFailed?: boolean;
  revocationFailed?: boolean;
  preview?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRefresh?: () => void;
}) {
  const { connected, configured } = connection;
  const tone = busy || checking || unverified ? "warning" : connected ? "success" : configured ? "error" : "warning";
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR CONNECTIONS</p>
          <h1>Bring your work along<span className="accent-text">.</span></h1>
          <p>A connection for the videos you choose. Your other files stay yours.</p>
        </div>
      </div>
      <section className="border-0 border-t border-solid border-border py-7 sm:py-9" aria-labelledby="drive-title" aria-busy={busy || checking}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-solid border-border bg-background text-primary" aria-hidden="true">
            <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m9 3 6 0 8 14-3 5H4l-3-5L9 3Z"/><path d="m9 3 8 14H1M15 3 4 22M7 17h16"/></svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="eyebrow">GOOGLE DRIVE</p><h2 id="drive-title" className="mt-1 text-2xl sm:text-3xl">{connected ? "Your source, connected." : "A good place to start."}</h2></div>
              <span className={`connection-status state-${tone} m-0 inline-flex h-fit shrink-0 rounded-md border border-solid border-border px-3 py-1.5 text-xs font-medium`} role="status">
                {preview ? "Sample: " : ""}{busy ? connected ? "Disconnecting…" : "Waiting for Google…" : checking ? "Checking status…" : unverified ? "Status unavailable" : connected ? "Connected" : configured ? "Not connected" : "Setup pending"}
              </span>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">Choose individual videos from Drive. Signing in to Riflo does not give us permission to browse all your files.</p>
            {preview && <p className="mt-5 text-sm leading-6 text-muted-foreground">Preview only. No Google account is connected and permissions cannot be changed here.</p>}
            {!connected && !active && <p className="mt-5 text-sm leading-6 text-[var(--warning)]">New connections need active account access. You can still disconnect an existing connection.</p>}
            {!configured && <p className="mt-5 text-sm leading-6 text-[var(--warning)]">Google Drive is awaiting setup by the Riflo team. Your sign-in still works.</p>}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {connected ? <Button variant="destructive-subtle" disabled={preview || busy || checking || unverified} onClick={onDisconnect}>{busy ? "Disconnecting…" : "Disconnect Drive"}</Button> : <Button disabled={preview || busy || checking || unverified || !active || !configured} onClick={onConnect}>{busy ? "Waiting for Google…" : "Connect Google Drive"}<ChevronRight size={16} aria-hidden="true" /></Button>}
              {!preview && !statusFailed && <Button variant="ghost" disabled={busy || checking} onClick={onRefresh}>{checking ? "Checking connection…" : "Refresh connection"}</Button>}
            </div>
            <p role="status" className={`form-feedback mt-4 max-w-xl text-sm leading-6${messageTone ? ` state-${messageTone}` : ""}`}>{message}{revocationFailed && <> <a className="text-link inline-flex min-h-11 items-center gap-2" href="https://myaccount.google.com/linkedapps?filters=3" target="_blank" rel="noopener noreferrer" aria-label="Manage Google access (opens in a new tab)">Manage Google access <Icon name="external" size={14} /></a></>}</p>
          </div>
        </div>
      </section>
    </>
  );
}
