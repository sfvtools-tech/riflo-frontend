import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { navigate } from "../../app/navigation";
import { ApiError, errorMessage, type StudioApi } from "../../shared/api/client";
import type { Project } from "./project-response";

export function DeleteProject({ api, project }: { api: StudioApi; project: Project | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Project | null>(null);
  const target = selected ?? project;
  const operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!busy) {
      if (error) (setupRequired ? cancel : confirm).current?.focus();
      return;
    }
    dialog.current?.focus();
    const preventEscape = (event: KeyboardEvent) => { if (event.key === "Escape") event.preventDefault(); };
    document.addEventListener("keydown", preventEscape);
    return () => document.removeEventListener("keydown", preventEscape);
  }, [busy, error, setupRequired]);

  async function remove() {
    if (operation.current || !target || setupRequired) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ deleted: boolean; cleanup: string }>(`/v1/projects/${target.id}`, controller.signal, { method: "DELETE" });
      if (result?.deleted !== true || result.cleanup !== "pending") throw new Error("Could not confirm deletion. Try again to check and finish deleting this project.");
      navigate("/projects", true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const needsSetup = cause instanceof ApiError && cause.code === "intake_not_configured";
        setSetupRequired(needsSetup);
        setError(needsSetup ? "Project deletion is awaiting setup by the Riflo team. Your project has not been deleted. Close this dialog and try again later." : cause instanceof ApiError && cause.status === 503 ? "Project deletion is temporarily unavailable. Try again in a moment." : errorMessage(cause));
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  return <>
    {project && <Button ref={trigger} aria-haspopup="dialog" variant="destructive-subtle" onClick={() => {
      setSelected(project);
      setSetupRequired(false);
      setError("");
      dialog.current?.showModal();
      cancel.current?.focus();
    }}>Delete project</Button>}
    <dialog ref={dialog} tabIndex={-1} aria-labelledby="delete-project-title" aria-describedby="delete-project-description" className="project-delete-dialog m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl bg-background p-6 text-foreground"
      onCancel={event => { if (operation.current) event.preventDefault(); }}
      onClose={() => { setSelected(null); trigger.current?.focus(); }}>
      <h2 id="delete-project-title" className="text-2xl">Delete this project?</h2>
      <p className="mt-4 break-words text-sm font-medium">{target?.source.name}</p>
      <p id="delete-project-description" className="mt-3 text-sm leading-6 text-muted-foreground">This removes the project and its saved content from Riflo. Your original Google Drive or YouTube video stays unchanged.</p>
      {error && <p className="mt-4 text-sm leading-6 text-destructive" role="alert">{error}</p>}
      <p className="sr-only" role="status">{busy ? "Deleting project…" : ""}</p>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end" aria-busy={busy}>
        <Button ref={cancel} variant="outline" disabled={busy} onClick={() => dialog.current?.close()}>{setupRequired ? "Close" : "Cancel"}</Button>
        {!setupRequired && <Button ref={confirm} variant="destructive" disabled={busy} onClick={remove}>{busy ? "Deleting…" : error ? "Retry deletion" : "Delete project"}</Button>}
      </div>
    </dialog>
  </>;
}
