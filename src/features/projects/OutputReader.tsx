import { ChevronRight, Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useContentMotion } from "../../shared/ui/motion";
import { useEffect, useRef, useState } from "react";
import { errorMessage, type StudioApi } from "../../shared/api/client";
import { formats, outputThread, threadPostText, type Batch, type Format, type Output } from "./generation-response";

function PrivateAsset({
  api,
  asset,
  expiresAt,
}: {
  api: StudioApi;
  expiresAt: string;
  asset: NonNullable<Output["assets"]>[number];
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let ownedUrl = "";
    setUrl("");
    setError("");
    api
      .blob(asset.downloadPath, asset.contentType, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted || Date.parse(expiresAt) <= Date.now()) { return; }
        ownedUrl = URL.createObjectURL(blob);
        setUrl(ownedUrl);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [api, asset.downloadPath, asset.contentType, expiresAt, attempt]);
  return (
    <div
      className={
        asset.contentType === "video/mp4" ? "clip-preview" : "slide-preview"
      }
    >
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button variant="outline" size="sm"
            className="button button-small"
            onClick={() => setAttempt((v) => v + 1)}
          >
            Retry file
          </Button>
        </div>
      ) : !url ? (
        <p role="status">Opening private file…</p>
      ) : (
        <>
          {asset.contentType === "image/png" ? (
            <img src={url} alt={`Carousel slide ${asset.id}`} />
          ) : (
            <video src={url} controls preload="metadata" playsInline />
          )}
          <Button asChild variant="outline" size="sm"><a
            className="button button-small"
            href={url}
            download={`${asset.id}.${asset.contentType === "image/png" ? "png" : "mp4"}`}
          >
            Download {asset.contentType === "image/png" ? "PNG" : "MP4"} <Download size={16} aria-hidden="true" />
          </a></Button>
        </>
      )}
    </div>
  );
}
export function OutputReader({
  outputs,
  api,
  readyBatch,
  viewRequest,
}: {
  outputs: Output[];
  api: StudioApi;
  readyBatch?: Batch | null;
  viewRequest?: { feature: Format; sequence: number } | null;
}) {
  const [viewedReadyIds, setViewedReadyIds] = useState<string[]>([]);
  const [selected, setSelected] = useState(() => outputs[0]?.id ?? "");
  useEffect(() => {
    setSelected(current => outputs.some(output => output.id === current) ? current : outputs[0]?.id ?? "");
  }, [outputs]);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const output = outputs.find((o) => o.id === selected) ?? outputs[0];
  const motion = useContentMotion(selected);
  const focusRequested = useRef(false);
  useEffect(() => {
    if (focusRequested.current) {
      motion.current?.focus();
      focusRequested.current = false;
    }
  }, [selected, motion]);
  useEffect(() => {
    if (!viewRequest) return;
    const target = outputs.find(item => item.id === selected && item.feature === viewRequest.feature)
      ?? outputs.find(item => item.feature === viewRequest.feature);
    if (!target) return;
    setNotice(null);
    if (target.id === selected) motion.current?.focus();
    else { focusRequested.current = true; setSelected(target.id); }
    // Only an explicit View action changes the reader's selection.
  }, [viewRequest]);
  const readyOutputs = readyBatch?.slots.filter(slot => slot.status === "ready")
    .flatMap(slot => outputs.filter(output => output.id === slot.id && !viewedReadyIds.includes(output.id))) ?? [];
  const operation = useRef<AbortController | null>(null);
  const downloadUrls = useRef(new Set<string>());
  useEffect(
    () => () => {
      operation.current?.abort();
      downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
      downloadUrls.current.clear();
    },
    [api, output?.id, output?.expiresAt],
  );
  useEffect(() => { setBusy(false); setNotice(null); }, [api, output?.id]);
  if (!output) return null;
  const thread = outputThread(output);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ message: "Copied to clipboard.", tone: "success" });
    } catch {
      setNotice({ message: "Copy was unavailable. Select the text to copy it.", tone: "error" });
    }
  }
  async function download() {
    if (!output || Date.parse(output.expiresAt) <= Date.now()) { return; }
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setNotice(null);
    try {
      const blob = await api.blob(
        `/v1/projects/${window.location.pathname.split("/")[2]}/outputs/${output.id}/download`,
        "text/plain",
        controller.signal,
      );
      if (controller.signal.aborted || Date.parse(output.expiresAt) <= Date.now()) { return; }
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      downloadUrls.current.add(url);
      a.href = url;
      a.download = `${output.feature}.txt`;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 1000);
    } catch (cause) {
      if (!controller.signal.aborted) setNotice({ message: errorMessage(cause), tone: "error" });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="results-section" aria-label="Generated content">
      {readyOutputs.length > 0 && <div className="generation-status generation-ready" role="status" aria-live="polite">
        <p><span className="generation-ready-check" aria-hidden="true">✓</span> {readyBatch?.status === "partial" ? "Some new content is ready. Some outputs could not finish." : "Your new content is ready."}</p>
        <div className="generation-ready-actions">{readyOutputs.map((item, index) => <Button variant="outline" size="sm" key={item.id} className="button button-small" onClick={() => {
          setNotice(null);
          setViewedReadyIds(current => [...current, item.id]);
          if (item.id === output.id) motion.current?.focus();
          else { focusRequested.current = true; setSelected(item.id); }
        }}>View new {formats.find(([key]) => key === item.feature)?.[1]}{readyOutputs.filter(other => other.feature === item.feature).length > 1 ? ` ${index + 1}` : ""}<ChevronRight size={16} aria-hidden="true" /></Button>)}</div>
      </div>}
      <div className="section-heading">
        <div>
          <h2 id="saved-content-heading" tabIndex={-1}>Saved content <span>{outputs.length} {outputs.length === 1 ? "output" : "outputs"}</span></h2>
        </div>

      </div>
      <div className="reading-room">
        <nav className="output-index" aria-label="Choose generated output">
          <span className="output-index-label">Choose output</span>
          {outputs.map((item, i) => (
            <Button variant="ghost" size="sm"
              key={item.id}
              aria-pressed={output.id === item.id}
              onClick={() => {
                if (item.id !== output.id) setSelected(item.id);
                setNotice(null);
              }}
            >
              {outputThread(item) ? "X thread" : formats.find(([key]) => key === item.feature)?.[1]}
              <span>{String(outputs.slice(0, i + 1).filter(output => output.feature === item.feature).length).padStart(2, "0")}</span>
            </Button>
          ))}
        </nav>
        <article ref={motion} className={`output-paper ${output.assets?.length ? "output-paper-media" : "output-paper-text"}`} key={output.id} tabIndex={-1} aria-label={`${formats.find(([key]) => key === output.feature)?.[1]} output`}>
          <header className="output-toolbar">
            <p className="eyebrow output-format-label shrink-0 whitespace-nowrap">{thread ? "X thread" : formats.find(([key]) => key === output.feature)?.[1]}</p>
            {!output.assets?.length && (
              <div className="output-actions">
                <Button variant="outline" size="sm"
                  className="button button-small"
                  onClick={() => void copy(output.text)}
                >
                  {thread ? "Copy thread" : "Copy text"}
                </Button>
                <Button variant="outline" size="sm"
                  disabled={busy}
                  className="button button-small"
                  onClick={() => void download()}
                >
                  {busy ? "Opening…" : <>Download TXT <Download size={16} aria-hidden="true" /></>}
                </Button>
              </div>
            )}
          </header>
          {!output.assets?.length ? (
            <>
              {thread ? <div className="output-copy">
                <p className="mb-6 whitespace-normal text-sm text-muted-foreground">
                  {output.deliveredPosts} {output.deliveredPosts === 1 ? "post" : "posts"} delivered · {output.credits} {output.credits === 1 ? "credit" : "credits"} used · Requested up to {output.requestedMaxPosts} posts
                </p>
                <ol className="m-0 grid list-none gap-6 p-0" aria-label="Thread posts">
                  {thread.posts.map((_, index) => <li key={index} className="border-b border-border pb-6 last:border-0 last:pb-0">
                    <div className="mb-3 flex items-center justify-between gap-3 whitespace-normal">
                      <span className="text-xs text-muted-foreground">Post {index + 1} of {thread.posts.length}</span>
                      <Button variant="ghost" size="sm" aria-label={`Copy post ${index + 1}`} onClick={() => void copy(threadPostText(thread, index))}>
                        Copy post
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap">{threadPostText(thread, index)}</p>
                  </li>)}
                </ol>
              </div> : <div className="output-copy">{output.text}</div>}
            </>
          ) : (
            <div
              className={
                output.feature === "carousels" ? "slide-strip" : "clip-stage"
              }
            >
              {output.assets.map((asset) => (
                <PrivateAsset key={asset.id} api={api} asset={asset} expiresAt={output.expiresAt} />
              ))}
            </div>
          )}
          {notice && <p className={`state-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p>}
          <p className="retention-note">
            {output.retentionMode === "while_paid" ? "Available while your paid access continues." : `Available until ${new Date(output.expiresAt).toLocaleString()}.`}
            Review the content before sharing it.
          </p>
        </article>
      </div>
    </section>
  );
}
