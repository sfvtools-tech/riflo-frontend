import { ChevronRight } from "lucide-react";
import { CreationOptions, CreationControlsSummary, type SourceDraft } from './GenerationControls';
import { buildControls, resolvedFields, threadMaximum, type GenerationDefaults, type GenerationControls } from './generation-controls';
import { retentionRefreshDelay } from "./retention";
import { createId } from "../../shared/lib/id";
import { Button } from "../../components/ui/button";
import { pendingRetry } from "./pending-retry";
import { createPortal } from "react-dom";
import { ContentFormatIcon, CreateContentChooser } from "./CreateContentChooser";
import { useReadyMotion } from "../../shared/ui/motion";
import { SavedContentSkeleton } from "../../shared/ui/PageSkeleton";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  errorMessage,
  type StudioApi,
} from "../../shared/api/client";
import { useSession } from "../../shared/auth/session";
import type { Project } from "./project-response";
import {
  formats,
  generationHeadline,
  generationWasReset,
  generationFailureMessage,
  pendingBatch,
  readGenerationResults,
  readBatch,
  readAvailability,
  availabilityMessages,
  type Availability,
  readOutputs,
  type Batch,
  type Output,
  type Format,
} from "./generation-response";
import { observeOperation } from "./observe-operation";
import { canReleaseSubmission } from "./submission-response";
import { OutputReader } from "./OutputReader";
import { WritingPreferences } from "../brand/WritingPreferences";
import { type BrandRequest } from "../brand/brand-response";
import { accessMessage } from "../account/access-message";

const formatNames: Record<Format, string> = {
  x_posts: "X post", linkedin_posts: "LinkedIn post", blogs: "Blog",
  newsletters: "Newsletter", carousels: "Carousel", short_videos: "Short video",
};
export function GenerationPanel({
  api,
  project,
}: {
  api: StudioApi;
  project: Project;
}) {
  const { user } = useSession();
  const [controlEdits, setControlEdits] = useState<GenerationDefaults>({});
  const [sourceDrafts, setSourceDrafts] = useState<Partial<Record<Format, SourceDraft>>>({});
  const [controlError, setControlError] = useState("");
  useEffect(() => { if (controlError) document.getElementById("generation-control-error")?.focus(); }, [controlError]);
  const [creationOpen, setCreationOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<Format | null>(null);
  // Keep visited editors mounted for drafts; unvisited formats need no hidden fields.
  const [brandRequests, setBrandRequests] = useState<Partial<Record<Format, BrandRequest>>>({});
  const brandSetters = useMemo(() => Object.fromEntries(formats.map(([format]) => [format,
    (value: BrandRequest | undefined) => setBrandRequests(current => ({ ...current, [format]: value })),
  ])) as Record<Format, (value: BrandRequest | undefined) => void>, []);
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  const [accessRefresh, setAccessRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const pending = useMemo(
    () => pendingBatch(sessionStorage, user!.uid, project.id),
    [user, project.id],
  );
  const transcriptPending = useMemo(() => pendingRetry(sessionStorage, user!.uid, project.id, "transcription"), [user, project.id]);
  const [transcriptRequest, setTranscriptRequest] = useState(() => transcriptPending.read());
  const submitting = useRef(false);
  const focusCreationFeedback = useRef(false);
  const handoffCreationFocus = useRef(false);
  const acceptedCreationId = useRef<string | null>(null);
  const [request, setRequest] = useState(() => pending.read());
  const [batch, setBatch] = useState<Batch | null>(() => api.snapshot(`/v1/projects/${project.id}/generation`, readBatch));
  const [savedOutputs, setOutputs] = useState<Output[]>(() => api.snapshot(`/v1/projects/${project.id}/outputs`, value => readOutputs(value, project.id)) ?? []);
  const outputs = savedOutputs.filter(output => Date.parse(output.expiresAt) > Math.max(clock, Date.now()));
  const [availability, setAvailability] = useState<Availability | null>(() => api.snapshot(`/v1/projects/${project.id}/generation/availability`, readAvailability));
  const availabilityOperation = useRef<AbortController | null>(null);
  const availabilityCheckedAt = useRef(0);
  const [availabilityError, setAvailabilityError] = useState("");
  const [checkingAvailability, setCheckingAvailability] = useState(true);
  const [loaded, setLoaded] = useState(() => api.snapshot(`/v1/projects/${project.id}/outputs`, value => readOutputs(value, project.id)) !== null);
  const [outputsKnown, setOutputsKnown] = useState(loaded);
  const [error, setError] = useState("");
  const [observationRetrying, setObservationRetrying] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptedBatchId, setAcceptedBatchId] = useState<string | null>(() => {
    const saved = api.snapshot(`/v1/projects/${project.id}/generation`, readBatch);
    return saved && ["queued", "transcribing", "generating"].includes(saved.status) ? saved.id : null;
  });
  const [refresh, setRefresh] = useState(0);
  const [emptyCreateMount, setEmptyCreateMount] = useState<HTMLDivElement | null>(null);
  const [createMount, setCreateMount] = useState<HTMLElement | null>(null);
  const [viewRequest, setViewRequest] = useState<{ feature: Format; sequence: number } | null>(null);
  useEffect(() => { setCreateMount(document.getElementById("project-create-content")); }, []);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    let snapshot = { batch, outputs, known: outputsKnown };
    return observeOperation(api, async (signal, notice) => {
      const [progress, saved] = await readGenerationResults(api, project.id, signal, snapshot, notice);
      const failures = [progress, saved].filter(result => result.status === "rejected");
      const denial = failures.find(result => result.reason instanceof ApiError && [401, 403, 404].includes(result.reason.status));
      if (denial) { setBatch(null); setOutputs([]); setOutputsKnown(false); throw denial.reason; }
      if (saved.status === "fulfilled") { setOutputs(saved.value); setOutputsKnown(true); }
      if (progress.status === "fulfilled") {
        setBatch(progress.value);
        if (progress.value && ["queued", "transcribing", "generating"].includes(progress.value.status)) setAcceptedBatchId(progress.value.id);
      }
      snapshot = {
        batch: progress.status === "fulfilled" ? progress.value : snapshot.batch,
        outputs: saved.status === "fulfilled" ? saved.value : snapshot.outputs,
        known: saved.status === "fulfilled" || snapshot.known,
      };
      setLoaded(true);
      if (failures.length) throw failures[0]!.reason;
      const next = progress.status === "fulfilled" ? progress.value : null;
      return next && ["queued", "transcribing", "generating"].includes(next.status)
        ? { projectId: project.id, kind: "generation", id: next.id } : null;
    }, (cause, retrying) => {
      setError(cause === null ? "" : `${errorMessage(cause)}${retrying ? " Checking progress again automatically." : ""}`);
      setObservationRetrying(retrying);
      if (cause) setLoaded(true);
    });
  }, [api, project.id, pending, refresh, accessRefresh, project.status]);
  const refreshAvailability = useCallback((blocking: boolean) => {
    // Focus and visibility can arrive together; keep the current read in flight.
    if (!blocking && availabilityOperation.current) return;
    availabilityOperation.current?.abort();
    const controller = new AbortController();
    availabilityOperation.current = controller;
    const checkedAt = Date.now();
    if (blocking) setCheckingAvailability(true);
    api(`/v1/projects/${project.id}/generation/availability`, controller.signal)
      .then(readAvailability)
      .then(value => { if (!controller.signal.aborted) { availabilityCheckedAt.current = checkedAt; setAvailability(value); setAvailabilityError(""); setCheckingAvailability(false); } })
      .catch(cause => { if (!controller.signal.aborted) { setAvailabilityError(errorMessage(cause)); setCheckingAvailability(false); } })
      .finally(() => { if (availabilityOperation.current === controller) availabilityOperation.current = null; });
  }, [api, project.id]);
  useEffect(() => {
    refreshAvailability(true);
    return () => availabilityOperation.current?.abort();
  }, [refreshAvailability, project.status, accessRefresh, refresh]);
  useEffect(() => {
    const visible = () => {
      if (!document.hidden) {
        setClock(Date.now());
        refreshAvailability(false);
      }
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshAvailability]);
  useEffect(() => {
    if (checkingAvailability) return;
    // A response may cross its own deadline in flight; revalidate once after that boundary.
    const delay = availabilityExpired() && !availabilityError ? 0 : retentionRefreshDelay([availability?.lifecycle?.nextChangeAt, availability?.lifecycle?.trial.expiresAt, availability?.sourceExpiresAt, availability?.transcriptExpiresAt, availability?.access.active ? availability.access.expiresAt : null, ...savedOutputs.map(output => output.expiresAt)], Date.now());
    if (delay === null) { return; }
    const timer = setTimeout(() => {
      setClock(Date.now());
      setCheckingAvailability(true);
      setAccessRefresh(value => value + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [availability, savedOutputs, accessRefresh, checkingAvailability, availabilityError]);
  const observedActive = useRef<string | null>(null);
  const settled = useRef<string | null>(null);
  useEffect(() => {
    if (!batch) return;
    if (["queued", "transcribing", "generating"].includes(batch.status)) {
      observedActive.current = batch.id;
    } else if (settled.current !== batch.id && (observedActive.current === batch.id || acceptedBatchId === batch.id || availability?.activeBatch)) {
      settled.current = batch.id;
      setAccessRefresh(value => value + 1);
    }
  }, [batch, acceptedBatchId, availability?.activeBatch]);
  async function start(feature?: Format) {
    if (busy || submitting.current) { return; }
    if (!request && !pending.read() && (!feature || availabilityExpired() || !canGenerate || active || !availableFor(feature))) { return; }
    let controls: GenerationControls | undefined;
    if (!request && !pending.read() && availability?.controls?.available && feature) {
      try {
        controls = buildControls(feature, controlEdits, sourceDrafts[feature] ?? {focus: "", start: "", end: ""}, project.source.durationSeconds);
      } catch (cause) {
        setControlError(errorMessage(cause));
        return;
      }
    }
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    submitting.current = true;
    focusCreationFeedback.current = outputs.length === 0;
    handoffCreationFocus.current = true;
    setCreationOpen(false);
    setBusy(true);
    setSubmissionError(""); setControlError("");
    const hadPending = request !== null || pending.read() !== null;
    let submittedKey: string | undefined;
    try {
      const next = request ?? pending.read() ?? { key: createId(), selection: { [feature!]: 1 }, ...(controls ? {controls} : {}), ...(feature && feature !== "short_videos" && brandRequests[feature] ? { brand: brandRequests[feature] } : {}) };
      // Keep the same request when a response is lost, including after a reload.
      submittedKey = next.key;
      pending.save(next);
      setRequest(next);
      await api.submit(`/v1/projects/${project.id}/generate`, controller.signal, {
        key: next.key, body: { outputs: next.selection, ...(next.controls ? {controls:next.controls} : {}), ...(next.brand ? { brand: next.brand } : {}) },
      }, accepted => {
        acceptedCreationId.current = accepted.id;
        setAcceptedBatchId(accepted.id);
        setCheckingAvailability(true);
        pending.clear(next.key);
        setRequest(null);
        setPreferenceVersion(value => value + 1);
        setControlEdits({}); setSourceDrafts({}); setControlError("");
        setAccessRefresh(value => value + 1);
        setRefresh(value => value + 1);
      }, true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSubmissionError(errorMessage(cause));
        if (!submittedKey) setControlError(errorMessage(cause));
        if (canReleaseSubmission(cause, "generation", hadPending)) {
          if (submittedKey) pending.clear(submittedKey);
          setRequest(null);
          setAccessRefresh((value) => value + 1);
          setRefresh(value => value + 1);
        } else if (
          cause instanceof ApiError &&
          cause.status === 409 &&
          ["generation_exists", "generation_in_progress"].includes(cause.code)
        ) {
          setRefresh((value) => value + 1);
        }
      }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); submitting.current = false; }
    }
  }
  async function retryTranscript() {
    if (submitting.current || busy || (!transcriptRequest && !availability?.transcription?.retryAvailable)) return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    submitting.current = true;
    setBusy(true);
    setSubmissionError("");
    const hadPending = transcriptPending.read() !== null;
    const key = transcriptRequest ?? transcriptPending.read() ?? createId();
    try {
      transcriptPending.save(key);
      setTranscriptRequest(key);
      await api.submit(`/v1/projects/${project.id}/retry-transcription`, controller.signal, { key, body: {} }, accepted => {
        setAcceptedBatchId(accepted.id);
        setCheckingAvailability(true);
        transcriptPending.clear(key);
        setTranscriptRequest(null);
        setAccessRefresh(value => value + 1);
        setRefresh(value => value + 1);
      }, true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSubmissionError(errorMessage(cause));
        if (canReleaseSubmission(cause, "transcription", hadPending)) {
          transcriptPending.clear(key);
          setTranscriptRequest(null);
        }
        setAccessRefresh(value => value + 1);
        setRefresh(value => value + 1);
      }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); submitting.current = false; }
    }
  }
  const availabilityExpired = () => [availability?.lifecycle?.nextChangeAt, availability?.lifecycle?.trial.expiresAt, availability?.sourceExpiresAt, availability?.transcriptExpiresAt, availability?.access.active ? availability.access.expiresAt : null]
    .some(value => value && Date.parse(value) > availabilityCheckedAt.current && Date.parse(value) <= Math.max(clock, Date.now()));
  const canGenerate = !availabilityExpired() && !availabilityError && !checkingAvailability && availability !== null && !availability.activeBatch;
  const active = !!batch && ["queued", "transcribing", "generating"].includes(batch.status);
  const maximumFor = (key: Format) => threadMaximum(key, availability?.controls, controlEdits);
  const costFor = (key: Format) => (availability?.credits?.costs[key] ?? 0) * (maximumFor(key) ?? 1);
  const threadUnavailable = (key: Format) => key === "x_posts" && availability?.controls?.available && availability.controls.threadAvailable === false && resolvedFields(key, availability.controls, controlEdits).mode === "thread";
  const availableFor = (key: Format) => !threadUnavailable(key) && maximumFor(key) !== null && availability?.outputs[key].available === true &&
    (!availability.credits || costFor(key) <= availability.credits.remaining);
  const selectedSummary = formats.filter(([key]) => (request?.selection[key] ?? 0) > 0)
    .map(([key]) => `${request!.selection[key]} × ${formatNames[key]}`).join(" · ");
  const latestFormats = batch ? [...new Set(batch.slots.map(slot => formatNames[slot.feature]))].join(" · ") : "";
  const readyBatch = !busy && !request && !active && !availability?.activeBatch && batch && batch.id === acceptedBatchId && ["completed", "partial"].includes(batch.status) && batch.slots.some(slot => slot.status === "ready" && outputs.some(output => output.id === slot.id)) ? batch : null;
  const transcriptJob = (batch?.intent === "transcription_retry" || batch?.intent === "import_transcription");
  const transcriptRecovery = !!transcriptRequest || transcriptJob && active || !request && !busy && !active && ["processing", "failed"].includes(availability?.transcription?.status ?? "");
  const confirmingGeneration = acceptedCreationId.current !== null && acceptedCreationId.current === acceptedBatchId && batch?.id !== acceptedBatchId;
  const temporary = busy || !!transcriptRequest || !!request || active || !!availability?.activeBatch || confirmingGeneration;
  const reset = !temporary && generationWasReset(batch);
  const resetMessage = canGenerate && formats.some(([key]) => availableFor(key))
    ? "Previous generation was reset. You can create again."
    : "Previous generation was reset.";
  const checking = !availability;
  const access = availability && accessMessage(availability.access, availability.lifecycle);
  const exhausted = formats.filter(([key]) => availability?.outputs[key].reason === "allowance_exceeded");
  const activeFormats = request ? formats.filter(([key]) => (request.selection[key] ?? 0) > 0).map(([key]) => formatNames[key]).join(" · ")
    : batch?.id === acceptedBatchId ? latestFormats : "";
  const sharedMessage = request && !busy ? "Confirm the pending request before creating more content."
    : transcriptRecovery && temporary ? "Preparing transcript. You can create content when it is ready."
    : temporary ? `${activeFormats || "Content"} ${!request && active && batch?.status === "queued" ? "is waiting to start" : "is being created"}. You can create more when it finishes.`
    : exhausted.length === formats.length ? "An allowance limit prevents new creation. Your saved content is still available."
    : exhausted.length ? "An allowance limit affects some formats. You can still create available formats and open saved content." : "";
  const checked = !checkingAvailability && !checking && !availabilityError;
  const sourceBlocked = checked && Object.values(availability!.outputs).some(item => item.reason === "requires_reimport");
  const excluded = checked && Object.values(availability!.outputs).some(item => item.reason === "feature_not_in_plan");
  const restriction = !temporary && checked ? access ? {
    ...access, href: "/usage", action: "View access details",
  } : exhausted.length ? {
    title: "Allowance limit reached.", detail: sharedMessage, href: "/usage", action: "View usage",
  } : sourceBlocked ? {
    title: "The stored video copy has expired.", detail: "Import the original into a new project to create the affected formats. Your saved content is still available.", href: "/projects", action: "Import a video",
  } : excluded ? {
    title: "Some formats aren’t included in your access.", detail: "You can create the available formats and open any saved content.", href: "/usage", action: "View access details",
  } : null : null;
  function viewSaved(feature: Format) {
    setViewRequest(current => ({ feature, sequence: (current?.sequence ?? 0) + 1 }));
  }
  const sourceNeedsAttention = ["queued", "importing", "failed"].includes(project.status);
  const motion = useReadyMotion(loaded && (!sourceNeedsAttention || outputs.length > 0 || temporary));
  useLayoutEffect(() => {
    if (!focusCreationFeedback.current) return;
    focusCreationFeedback.current = false;
    // The first creation replaces its chooser; retain focus only for this user action.
    motion.current?.querySelector<HTMLElement>(".generation-feedback")?.focus();
  });
  const generationFeedback = !["queued", "importing"].includes(project.status) && !transcriptRecovery && (busy || request || confirmingGeneration || !transcriptJob && (active || availability?.activeBatch || batch?.status === "failed" || (batch?.status === "partial" && !readyBatch)));
  const empty = (!project.preparation || availability?.transcriptAvailable === true) && loaded && outputsKnown && outputs.length === 0 && !temporary && !transcriptRecovery && !generationFeedback && availability?.transcription?.reason !== "transcription_not_retryable";
  // Continue observing saved outputs and pending operations while import owns the page.
  if (sourceNeedsAttention && outputs.length === 0 && !temporary) {
    return loaded && !outputsKnown && error ? <div className="inline-notice" role="alert">
      <p>Saved content could not be checked. Your import status is shown above.</p>
      <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>Refresh results</Button>
    </div> : null;
  }
  const descriptions: Record<Format, string> = {
    x_posts: "A sharp idea. Or a connected thread.", linkedin_posts: "Turn an insight into a conversation.",
    blogs: "Give your ideas room to unfold.", newsletters: "Bring the highlights to an inbox.",
    carousels: "Tell your story, slide by slide.", short_videos: "A shareable moment from your source.",
  };
  function formatReason(key: Format) {
    const reason = availability?.outputs[key].reason;
    return availabilityError ? "Availability could not be checked."
      : threadUnavailable(key) ? "Threads are unavailable for this account. Choose Single post."
      : maximumFor(key) === null ? "Choose maximum posts and numbering before generating."
      : access ? access.label
      : !temporary && availability?.credits && costFor(key) > availability.credits.remaining ? "Not enough creation credits."
      : reason && !["available", "generation_in_progress"].includes(reason) ? availabilityMessages[reason]
      : "";
  }
  function costLabel(key: Format) {
    if (availabilityError) return "Cost unavailable";
    if (!availability) return "Loading formats and costs…";
    if (!availability.credits) return "Cost unavailable";
    if (maximumFor(key) === null) return "Choose thread options to see cost";
    const cost = costFor(key);
    return `${(maximumFor(key) ?? 1) > 1 ? "Up to " : ""}${cost} ${cost === 1 ? "credit" : "credits"}`;
  }
  const choices = <div className="generation-options">
    {restriction ? <div className="generation-restriction" role="status">
      <strong>{restriction.title}</strong><p>{restriction.detail}</p>
      <a className="text-link" href={restriction.href}>{restriction.action}</a>
    </div> : sharedMessage && <p className="generation-shared" role="status">{sharedMessage}</p>}
    {availabilityError && <div className="generation-restriction" role="status">
      <strong>Availability couldn’t be checked.</strong><p>Retry to see the available formats and costs.</p>
      <Button variant="outline" size="sm" onClick={() => setAccessRefresh(value => value + 1)}>Retry availability check</Button>
    </div>}
    {!selectedFormat ? <div className="generation-format-grid">
      {formats.map(([key]) => <button type="button" className="generation-format-tile" aria-label={`Choose ${formatNames[key]}`} data-format={key} key={key}
        onClick={() => { setSelectedFormat(key); setControlError(""); if (key !== "short_videos") setBrandRequests(current => Object.hasOwn(current, key) ? current : { ...current, [key]: undefined }); }}>
        <ContentFormatIcon format={key} />
        <span className="generation-format-tile-copy"><strong>{formatNames[key]}</strong>
          <span>{descriptions[key]}</span><small>{costLabel(key)}</small>
          {formatReason(key) && <small>{formatReason(key)}</small>}
        </span><ChevronRight size={16} className="generation-format-chevron" aria-hidden="true" />
      </button>)}
    </div> : <>
      {availability?.controls?.available && availability.controls.defaultsStatus === "unavailable" && <p role="status" className="state-warning">Saved defaults could not be loaded. Built-in defaults and your explicit choices will be used.</p>}
      {controlError && <p id="generation-control-error" role="alert" tabIndex={-1} className="state-error">{controlError}</p>}
      {submissionError && !request && <p role="alert" className="state-error">{submissionError}</p>}
      {formatReason(selectedFormat) && <div className="generation-restriction" role="status"><p>{formatReason(selectedFormat)}</p>
        {availability?.credits && costFor(selectedFormat) > availability.credits.remaining && <a className="text-link" href="/usage">View usage</a>}
      </div>}
      {availability?.controls?.available && <CreationOptions format={selectedFormat} options={availability.controls} value={controlEdits} onChange={setControlEdits} source={sourceDrafts[selectedFormat] ?? {focus: "", start: "", end: ""}} onSourceChange={value => setSourceDrafts(current => ({...current, [selectedFormat]: value}))} disabled={temporary} />}
      {outputs.some(output => output.feature === selectedFormat) && <Button variant="link" onClick={() => { handoffCreationFocus.current = true; viewSaved(selectedFormat); setCreationOpen(false); }}>View saved {formatNames[selectedFormat]}</Button>}
    </>}
    {formats.filter(([format]) => format !== "short_videos" && Object.hasOwn(brandRequests, format)).map(([format]) => <div key={format} hidden={selectedFormat !== format}>
      <WritingPreferences key={preferenceVersion} prefix={`creation-${format}`} options={availability?.preferences ?? null} disabled={temporary} onChange={brandSetters[format]} />
    </div>)}
  </div>;
  const chooser = <CreateContentChooser triggerMount={empty ? emptyCreateMount : createMount} open={creationOpen} onOpenChange={setCreationOpen}
    onCloseAutoFocus={event => { if (handoffCreationFocus.current) { event.preventDefault(); handoffCreationFocus.current = false; } }}
    onOpen={() => { setSelectedFormat(null); setControlError(""); }}
    title={selectedFormat ? formatNames[selectedFormat] : "Create content"}
    description={selectedFormat ? undefined : "Choose a format to get started."}
    onBack={selectedFormat ? () => { setSelectedFormat(null); setControlError(""); } : undefined}
    footer={selectedFormat ? <>
      <div className="generation-creation-cost" role="status"><strong>{costLabel(selectedFormat)}</strong>
        {selectedFormat === "x_posts" && availability?.controls?.available && resolvedFields(selectedFormat, availability.controls, controlEdits).mode === "thread" && <small>Reserved up to the maximum. Charged for posts delivered.</small>}
      </div>
      <Button disabled={!canGenerate || temporary || !availableFor(selectedFormat)} onClick={() => void start(selectedFormat)}>
        Generate {selectedFormat === "x_posts" && availability?.controls?.available && resolvedFields(selectedFormat, availability.controls, controlEdits).mode === "thread" ? "thread" : formatNames[selectedFormat]}
      </Button>
    </> : undefined}>{choices}</CreateContentChooser>;
  return (
    <div ref={motion} className={`project-workspace${empty ? " project-generation-empty" : ""}`}>
      {loaded && chooser}
      {createMount && !loaded && createPortal(<span className="skeleton skeleton-button" aria-hidden="true" />, createMount)}
      {!temporary && checked && access && <div className="generation-access-notice" role="status">
        <div><strong>{access.title}</strong><p>{access.detail}</p></div>
        <Button asChild variant="outline" size="sm" className="button button-small"><a href="/usage">View access details</a></Button>
      </div>}
      {error && (!temporary || !observationRetrying) && (
        <div className="inline-notice" role="alert">
          <p>{error}</p>
          <Button variant="outline" size="sm"
            className="button button-small"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Refresh results
          </Button>
        </div>
      )}

      {batch?.id === acceptedBatchId && batch.brand?.status === "unavailable" && <p className="quiet-note" role="status">Saved brand preferences couldn’t be loaded for this creation. Any changes you supplied for this creation were kept.</p>}
      {submissionError && !request && !transcriptRecovery && availability?.transcription?.reason !== "transcription_not_retryable" && <div className="inline-notice" role="alert"><p>{submissionError}</p></div>}
      {availabilityError && <div className="inline-notice" role="alert">
        <p>We could not check which formats are available. Saved results remain available.</p>
        <Button variant="outline" size="sm" className="button button-small" onClick={() => setAccessRefresh(value => value + 1)}>Retry availability check</Button>
      </div>}
      {!["queued", "importing"].includes(project.status) && (transcriptRecovery || transcriptJob && availability?.transcriptAvailable === true && batch?.status === "completed" && batch.id === acceptedBatchId && !temporary && !submissionError || availability?.transcription?.reason === "transcription_not_retryable") && <div className={`generation-status generation-feedback generation-transcription-feedback${outputs.length === 0 ? " project-first-generation" : ""}${availability?.transcription?.status === "failed" && !temporary ? " generation-feedback-warning" : ""}`} role="status" tabIndex={-1} aria-busy={!transcriptRequest && (active || availability?.transcription?.status === "processing")}>
        {transcriptRequest && !busy ? <span className="generation-feedback-symbol" aria-hidden="true">!</span> : !transcriptRequest && (active || availability?.transcription?.status === "processing") && <span className="generation-spinner" aria-hidden="true" />}
        <div className="generation-feedback-copy"><p>{transcriptRequest ? busy ? "Starting transcript retry…" : "We couldn’t confirm whether the transcript retry started." : active && transcriptJob || availability?.transcription?.status === "processing" ? "Preparing transcript…" : availability?.transcription?.reason === "transcription_not_retryable" ? "This video could not be transcribed." : availability?.transcription?.status === "failed" ? "The transcript could not be prepared." : "Transcript ready."}</p>
          <small>{transcriptRequest && !busy ? "Check this request again safely; it won’t start a duplicate." : temporary && transcriptJob && batch?.status === "queued" ? "Your transcript is in the queue." : temporary && transcriptJob && batch?.transcriptionStage ? { preparing_audio: "Preparing audio for transcription.", transcribing: "Transcribing your video." }[batch.transcriptionStage] : temporary ? outputs.length ? "You can keep reading saved content. This page updates automatically." : "This page updates automatically when your transcript is ready." : availability?.transcription?.reason === "transcription_not_retryable" ? "Open the original to check the video, or import another source." : availability?.transcription?.reason === "generation_not_configured" ? "Transcription is currently unavailable. Your saved content is still available." : availability?.transcription?.status === "failed" ? "Retry uses the imported video, with no extra source allowance or content outputs." : "Choose a format in Create content when you’re ready."}</small>
          {submissionError && <small className="state-error">{submissionError}</small>}
          {availability?.transcription?.reason === "transcription_not_retryable" && (project.sourceUrl ? <a className="text-link source-recovery-link" href={project.sourceUrl} target="_blank" rel="noopener noreferrer">Open original video <span className="sr-only">(opens in a new tab)</span></a> : <a className="text-link source-recovery-link" href={`/projects/${project.id}/settings`}>View source in project settings</a>)}
          {error && observationRetrying && <small className="state-warning">Progress could not be updated. Reconnecting to check progress.</small>}
        </div>
        {(transcriptRequest || availability?.transcription?.retryAvailable) && <Button size="sm" variant="outline" disabled={busy || active || checkingAvailability} onClick={() => void retryTranscript()}>{busy ? "Starting retry…" : transcriptRequest ? "Check retry status" : "Retry transcription"}</Button>}
        {availability?.transcription?.reason === "transcription_not_retryable" && <Button asChild size="sm" variant="outline"><a href="/projects">Choose another source</a></Button>}
      </div>}
      {generationFeedback && <div className={`generation-status generation-feedback${outputs.length === 0 ? " project-first-generation" : ""}${request && !busy ? " generation-feedback-warning" : reset ? " generation-feedback-reset" : batch?.status === "failed" && !temporary ? " generation-feedback-error" : ""}`} role="status" tabIndex={-1} aria-live="polite">
        <span className={temporary && !(request && !busy) ? "generation-spinner" : "generation-feedback-symbol"} aria-hidden="true">{reset ? "↺" : request && !busy || batch?.status === "failed" && !temporary ? "!" : ""}</span>
        <div className="generation-feedback-copy"><p>{request ? busy ? `Starting ${activeFormats || "your content"}…` : "We couldn’t confirm whether it started."
          : active ? generationHeadline(batch!, latestFormats)
          : busy || availability?.activeBatch || confirmingGeneration ? "Generating content…" : reset ? resetMessage : batch?.status === "partial" ? "Some content could not finish." : generationFailureMessage(batch)}</p>
          <small>{request && !busy ? "Retrying this request won’t create a duplicate."
            : active ? batch?.status === "queued" ? "Waiting to start" : batch?.status === "transcribing" ? "Preparing transcript" : outputs.length ? "You can keep reading your saved content." : "Your first output will appear here when it is ready. This page updates automatically."
            : busy || availability?.activeBatch || confirmingGeneration ? "Checking its progress." : reset ? "Your video and saved content are unchanged." : outputs.length ? "Your saved content is still available. You can choose a format to try a new request." : "Choose a format in Create content to try again."}</small>
          {error && temporary && observationRetrying && <small className="state-warning">Progress or results could not be updated. Reconnecting to check progress.</small>}
          {request && !busy && <small>{selectedSummary}{submissionError ? ` · ${submissionError}` : ""}</small>}
        </div>
        {request && !busy && <Button variant="outline" size="sm" className="button button-small" onClick={() => void start()}>Retry request</Button>}
      </div>}
      {request?.controls && <CreationControlsSummary controls={request.controls} selection={request.selection} pending />}
      {availability && Object.values(availability.outputs).some(item => item.reason === "requires_reimport") && <p className="quiet-note">New video clips require the original video. <a className="text-link" href="/projects">Import video again</a></p>}
      {!loaded && outputs.length === 0 && <SavedContentSkeleton />}
      <OutputReader api={api} outputs={outputs} readyBatch={readyBatch} viewRequest={viewRequest} />
      {loaded && !outputsKnown && <section className="results-section" aria-labelledby="saved-content-heading">
        <div className="section-heading"><h2 id="saved-content-heading" tabIndex={-1}>Saved content</h2></div>
        <p className="quiet-note">Saved content could not be loaded. Refresh results to try again.</p>
      </section>}
      {empty && <section className="workspace-empty" aria-labelledby="saved-content-heading">
        <div className="workspace-empty-paper">
          <div className="workspace-empty-intro"><h2 id="saved-content-heading" tabIndex={-1}>Give this video a new form.</h2>
            <p>Turn your video into posts, articles, and more.<br />Choose a format to create your first output.</p></div>
          <div ref={setEmptyCreateMount} />
        </div>
      </section>}
    </div>
  );
}
