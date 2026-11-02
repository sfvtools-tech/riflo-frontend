import { ChevronRight } from "lucide-react";
import { FolderOpen } from "lucide-react";
import { createId } from "../../shared/lib/id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { ApiError, errorMessage, type StudioApi, type RetryAllowance } from "../../shared/api/client";
import { pendingImport, type PendingImport } from "./pending-import";
import { canReleaseSubmission } from "./submission-response";
import { useSession } from "../../shared/auth/session";
import {
  sourceAvailability, intakeAvailable,
  type Capabilities,
  type Connection,
} from "../account/account-response";
import { allowanceAmount } from "../account/usage-response";
import { chooseDriveVideo, pickerConfigured } from "./picker";
import {
  parseDriveLink,
  readProject,
  type DriveFile,
} from "./project-response";

type Selection = PendingImport;

export function ImportVideo({
  api,
  capabilities,
  connection,
  onComplete,
  onAccessChange,
  onConnectionRefresh,
  checkingAccess = false,
  onDriveRecoveryChange,
}: {
  api: StudioApi;
  capabilities: Capabilities;
  checkingAccess?: boolean;
  onDriveRecoveryChange: (visible: boolean) => void;
  connection: Connection | null;
  onComplete: (projectId: string) => void;
  onAccessChange: () => void;
  onConnectionRefresh: () => void;
}) {
  const { user } = useSession();
  const available = sourceAvailability(capabilities);
  const pending = useMemo(
    () => pendingImport(sessionStorage, user!.uid),
    [user],
  );
  const [restored] = useState(() => pending.read());
  const restoredIntent = restored && !("invalid" in restored) ? restored : null;
  const invalidPending = restored !== null && "invalid" in restored;
  const [source, setSource] = useState<"drive" | "youtube">(() =>
    restoredIntent
      ? "source" in restoredIntent.input
        ? "youtube"
        : "drive"
      : available.drive.configured
        ? "drive"
        : "youtube",
  );
  const [link, setLink] = useState(() => restoredIntent
    ? restoredIntent.submittedURL ?? ("source" in restoredIntent.input
      ? "url" in restoredIntent.input ? restoredIntent.input.url : `https://www.youtube.com/watch?v=${restoredIntent.input.videoId}`
      : `https://drive.google.com/file/d/${restoredIntent.input.fileId}/view`)
    : "");
  const [selection, setSelection] = useState<Selection | null>(restoredIntent);
  const [pickedFile, setPickedFile] = useState<DriveFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalidLink, setInvalidLink] = useState(false);
  const [quota, setQuota] = useState<RetryAllowance | true | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uncertain, setUncertain] = useState(Boolean(restored));
  const operation = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  useEffect(() => () => operation.current?.abort(), []);
  const canImport =
    !checkingAccess &&
    intakeAvailable(capabilities) &&
    capabilities.services?.intake.configured === true &&
    available[source].configured &&
    (source === "youtube" || connection?.connected);

  useEffect(() => {
    onDriveRecoveryChange(source === "drive" && available.drive.configured && !connection);
    return () => onDriveRecoveryChange(false);
  }, [source, available.drive.configured, connection, onDriveRecoveryChange]);

  async function pick() {
    if (inFlight.current || uncertain || !canImport) return;
    inFlight.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setInvalidLink(false);
    setQuota(null);
    setSelection(null);
    try {
      const access = await api<{ accessToken: string; expiresAt: string }>(
        "/v1/drive/picker-session",
        controller.signal,
      );
      const file = await chooseDriveVideo(access, controller.signal);
      if (file) {
        setPickedFile(file);
        setLink(`https://drive.google.com/file/d/${file.fileId}/view${file.resourceKey ? `?resourcekey=${file.resourceKey}` : ""}`);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorMessage(cause));
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }
  async function submit() {
    if (inFlight.current || (uncertain && !selection) || (!uncertain && !canImport)) {
      return;
    }
    let draft = selection;
    if (!uncertain) {
      try {
        draft = { input: source === "youtube" ? { source: "youtube", url: link } : pickedFile ?? parseDriveLink(link), details: null, key: createId(), submittedURL: link };
      } catch (cause) {
        setError(errorMessage(cause));
        setInvalidLink(true);
        return;
      }
    }
    if (!draft) return;
    inFlight.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setInvalidLink(false);
    setConfirming(uncertain);
    setError("");
    setQuota(null);
    setUncertain(true);
    let hadPending = uncertain;
    let persisted = false;
    let intent = draft;
    try {
      const saved = pending.read();
      hadPending ||= saved !== null;
      if (saved && "invalid" in saved) {
        throw new Error(
          "The saved import could not be read. Refresh before trying again.",
        );
      }
      intent = saved ?? draft;
      // Restore the complete request; a new Picker selection could omit its resource key.
      pending.save(intent);
      persisted = true;
      setSelection(intent);
      try {
        await api.submit("/v1/projects", controller.signal, { body: intent.input, key: intent.key }, accepted => {
          pending.clear(intent);
          onComplete(accepted.projectId);
        });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== "legacy_observation_unavailable") throw cause;
        const saved = readProject(await api("/v1/projects", controller.signal, { method: "POST", body: intent.input, key: intent.key }));
        pending.clear(intent);
        onComplete(saved.id);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const exceeded = cause instanceof ApiError && cause.status === 403 && cause.code === "allowance_exceeded";
        setQuota(exceeded ? cause.allowance ?? true : null);
        setError(cause instanceof ApiError ? errorMessage(cause) : "We couldn’t confirm whether your import started.");
        if (!persisted && !hadPending) {
          setUncertain(false);
          setError("We couldn’t save your import request in this browser. Free up browser storage, then try again.");
        } else if (canReleaseSubmission(cause, "import", hadPending)) {
          try {
            pending.clear(intent);
          } catch {
            setError("We couldn’t clear the saved request in this browser. Check its status before choosing another video.");
            return;
          }
          setUncertain(false);
          setError(errorMessage(cause));
          setInvalidLink(cause instanceof ApiError && cause.code === "invalid_youtube_link");
          setSelection(null);
          onAccessChange();
        }
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }
  function choose(next: "drive" | "youtube") {
    if (inFlight.current || uncertain) return;
    setPickedFile(null);
    setSource(next);
    setLink("");
    setSelection(null);
    setError("");
    setInvalidLink(false);
    setQuota(null);
  }
  return (
    <section id="project-import" className="import-sheet" aria-labelledby="import-title">
      <div className="import-intro">
        <h2 id="import-title">Choose your source</h2>
        <p>Import one video to get started. Generation comes next.</p>
        {capabilities.operationalLimits && (
          <p className="source-limits">
            Up to{" "}
            {Math.floor(capabilities.operationalLimits.maxSourceSeconds / 60)}{" "}
            minutes ·{" "}
            {(
              capabilities.operationalLimits.maxSourceBytes /
              1e9
            ).toLocaleString()}{" "}
            GB
          </p>
        )}
      </div>
      <div className="import-fields">
        {invalidPending && (
          <p className="form-feedback" role="alert">
            A saved import could not be read. New imports are paused because we cannot safely confirm whether it already started.
          </p>
        )}
        {uncertain && !busy && !invalidPending && (
          <p className="inline-notice" role="status">
            Your selection is saved while we confirm whether the import started.
            Check its status before choosing a different video.
          </p>
        )}
        <fieldset className="source-choice" disabled={busy || uncertain}>
          <legend>Video source</legend>
          {(
            [
              ["drive", "Google Drive", "A video from your files."],
              ["youtube", "YouTube", "A link to your original."],
            ] as const
          ).map(([key, label, description]) => (
            <label
              key={key}
              data-selected={source === key}
              data-unavailable={!available[key].configured}
              className="has-checked:border-primary has-checked:bg-secondary has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-offset-3 has-focus-visible:outline-ring forced-colors:has-focus-visible:outline-[Highlight] motion-reduce:transition-none"
            >
              <input
                className="accent-primary"
                type="radio"
                name="video-source"
                value={key}
                checked={source === key}
                disabled={!available[key].configured}
                onChange={() => choose(key)}
              />
              <span>
                <strong>{label}</strong>
                <small>
                  {available[key].configured ? description : "Awaiting setup"}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        {!available[source].configured ? (
          <p className="inline-notice">
            This video source is awaiting setup. Choose another available
            source.
          </p>
        ) : source === "drive" && !connection ? (
          <div className="inline-notice">
            <p>Google Drive status is unavailable. Check it again or choose YouTube.</p>
            <Button variant="outline" disabled={checkingAccess} onClick={onConnectionRefresh}>
              {checkingAccess ? "Checking connection…" : "Retry connection status"}
            </Button>
          </div>
        ) : source === "drive" && !connection?.connected ? (
          <div className="inline-notice">
            <strong>Connect your Google Drive first.</strong>
            <p>A shared link alone does not grant access to a private file.</p>
            <a className="text-link" href="/connections">
              Go to connections <ChevronRight size={16} aria-hidden="true" />
            </a>
          </div>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field data-invalid={invalidLink || undefined}>
                <FieldLabel className="mb-0"
                  htmlFor={source === "drive" ? "drive-link" : "youtube-link"}
                >
                  {source === "drive"
                    ? "Paste a Google Drive video link"
                    : "Paste a YouTube video link"}
                </FieldLabel>
                <div className="link-field max-[601px]:grid! max-[601px]:grid-cols-2">
                  <div className="contents min-[601px]:relative min-[601px]:block min-[601px]:min-w-0 min-[601px]:flex-1">
                    <Input
                      className={source === "drive" && pickerConfigured() ? "col-span-2 h-13 rounded-xl px-4 shadow-none min-[601px]:pr-48" : "col-span-2 h-13 rounded-xl px-4 shadow-none"}
                      id={source === "drive" ? "drive-link" : "youtube-link"}
                      type="url"
                      value={link}
                      disabled={uncertain || !canImport}
                      readOnly={busy}
                      aria-invalid={invalidLink || undefined}
                      onChange={(event) => {
                        setLink(event.target.value);
                        setPickedFile(null);
                        setSelection(null);
                        setError("");
                        setInvalidLink(false);
                      }}
                      placeholder={
                        source === "drive"
                          ? "https://drive.google.com/file/d/…"
                          : "https://www.youtube.com/watch?v=…"
                      }
                      required
                      aria-describedby={invalidLink ? "source-link-help source-link-error" : "source-link-help"}
                    />
                    {source === "drive" && pickerConfigured() && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-w-0 rounded-lg whitespace-normal px-2 leading-4 min-[601px]:absolute min-[601px]:inset-y-1 min-[601px]:right-1 min-[601px]:w-44 min-[601px]:px-3 min-[601px]:leading-5 min-[601px]:whitespace-nowrap"
                        aria-label="Choose from Google Drive"
                        disabled={busy || uncertain || !canImport}
                        onClick={pick}
                      >
                        <FolderOpen aria-hidden="true" className="hidden size-4 min-[601px]:block" />
                        <span>Choose from Drive</span>
                      </Button>
                    )}
                  </div>
                  <Button
                    className={source === "drive" && pickerConfigured() ? "min-w-0 rounded-lg min-[601px]:h-13 min-[601px]:rounded-xl min-[601px]:px-5 max-[601px]:whitespace-normal! max-[601px]:px-2 max-[601px]:leading-4" : "col-span-2 rounded-lg min-[601px]:h-13 min-[601px]:rounded-xl min-[601px]:px-5"}
                    disabled={busy || uncertain || !canImport}
                    aria-busy={busy || undefined}
                  >
                    {busy && !confirming ? "Checking video…" : "Import video"}
                  </Button>
                </div>
                <FieldDescription className="m-0 leading-relaxed" id="source-link-help">
                  {source === "drive"
                    ? pickerConfigured()
                      ? "If Riflo cannot access it, select the same file in the Drive Picker first."
                      : "Use a video already shared with Riflo. If access fails, check the file’s permissions or choose another source."
                    : "Use a video you own or have permission to reuse. Public or unlisted videos only; no sign-in, live or age-restricted videos."}
                </FieldDescription>
              </Field>
            </form>
          </>
        )}
        {selection && uncertain && (!busy || confirming) && (
          <div className="source-confirm">
            <span className="round-icon"><Icon name="play" /></span>
            <div>
              <p className="eyebrow">{source === "youtube" ? "YouTube" : "Google Drive"}</p>
              <strong>{selection.details?.name ?? "Your saved video"}</strong>
              <p className="saved-source-url">{link}</p>
              <p>Check this saved import before starting another.</p>
            </div>
            <Button disabled={busy} onClick={submit}>
              {busy ? "Checking import status…" : "Check import status"} <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </div>
        )}
        {busy && (
          <p role="status">
            {uncertain
              ? confirming ? "Checking import status…" : "Checking video…"
              : source === "youtube"
                ? "Checking your YouTube video…"
                : "Checking with Google Drive…"}
          </p>
        )}
        {error && (
          <p className="form-feedback" id={invalidLink ? "source-link-error" : undefined} role="alert">
            {error}
            {quota && typeof quota === "object" && ` This import needs ${allowanceAmount("sourceSeconds", quota.requiredSeconds)}; ${allowanceAmount("sourceSeconds", quota.remainingSeconds)} remain.`}
            {quota && <> <a className="text-link" href="/usage">Check usage</a></>}
          </p>
        )}
      </div>
    </section>
  );
}
