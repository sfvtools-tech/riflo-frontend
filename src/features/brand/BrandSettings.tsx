import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage, type StudioApi } from "../../shared/api/client";
import { readCapabilities } from "../account/account-response";
import { loadBrand, readBrand, readBrandOptions, rebaseBrandEdits, sameBrandProfile, saveBrand, type BrandOptions, type BrandProfile } from "./brand-response";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Icon } from "../../shared/ui/Icon";

export function LanguageFields({ language, spelling, options, onChange, prefix, disabled = false, compact = false, inheritValue }: {
  language: string; spelling: string; options: Pick<BrandOptions, "languages"> | null;
  onChange: (field: "language" | "spelling", value: string) => void; prefix: string; disabled?: boolean; compact?: boolean; inheritValue?: string;
}) {
  const languages = options?.languages ?? [];
  return <div className="brand-field-pair">
    <Field><FieldLabel htmlFor={`${prefix}-language`}>Content language</FieldLabel>
      <NativeSelect id={`${prefix}-language`} value={language} disabled={disabled || !options} onChange={event => onChange("language", event.target.value)}>
        {inheritValue && <NativeSelectOption value={inheritValue}>Use saved preference</NativeSelectOption>}
        <NativeSelectOption value="">Same as source</NativeSelectOption>
        {language && language !== inheritValue && !languages.includes(language) && <NativeSelectOption value={language}>{language} (saved preference)</NativeSelectOption>}
        {languages.map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}
      </NativeSelect>
    </Field>
    {(!language || language === inheritValue || language === "English") && <Field><FieldLabel htmlFor={`${prefix}-spelling`}>English spelling</FieldLabel>
      <NativeSelect id={`${prefix}-spelling`} aria-describedby={!compact ? `${prefix}-spelling-hint` : undefined} value={spelling} disabled={disabled} onChange={event => onChange("spelling", event.target.value)}>
        {inheritValue && <NativeSelectOption value={inheritValue}>Use saved preference</NativeSelectOption>}
        <NativeSelectOption value="">No preference</NativeSelectOption><NativeSelectOption value="US English">US English — color</NativeSelectOption><NativeSelectOption value="UK English">UK English — colour</NativeSelectOption>
        {spelling && spelling !== inheritValue && !["US English", "UK English"].includes(spelling) && <NativeSelectOption value={spelling}>{spelling} (saved preference)</NativeSelectOption>}
      </NativeSelect>{!compact && <FieldDescription id={`${prefix}-spelling-hint`}>Applies when the written output is in English.</FieldDescription>}
    </Field>}
  </div>;
}

// Native controls reserve the same row heights as the form, including mobile typography.
function BrandSettingsSkeleton() {
  const shimmer = (children: ReactNode, className = "") => <span className={`skeleton brand-skeleton ${className}`}><span>{children}</span></span>;
  const field = (label: string, control: ReactNode, hint?: string) => <Field>
    <FieldLabel>{shimmer(label)}</FieldLabel>
    {shimmer(control)}
    {hint && <FieldDescription>{shimmer(hint)}</FieldDescription>}
  </Field>;
  return <div role="status" aria-label="Loading brand settings">
    <div className="brand-form-body brand-loading" aria-hidden="true" inert>
      <section className="brand-section">
        <h3>{shimmer("Writing preferences")}</h3>
        {field("Who is your content for?", <Textarea rows={1} disabled />)}
        <div className="brand-style-field">
          {field("Writing style", <Textarea rows={1} disabled />)}
          <div className="brand-voice-suggestions"><span>{shimmer("Try:")}</span>{["Clear & direct", "Warm", "Professional"].map(label => <span key={label}>{shimmer(<Button variant="link" className="px-0 text-[13px]" disabled>{label}</Button>)}</span>)}</div>
        </div>
        <div className="brand-field-pair">
          {field("Content language", <NativeSelect disabled><NativeSelectOption>Same as source</NativeSelectOption></NativeSelect>)}
          {field("English spelling", <NativeSelect disabled><NativeSelectOption>No preference</NativeSelectOption></NativeSelect>)}
        </div>
      </section>
      <section className="brand-section">
        <h3>{shimmer("Writing references")}</h3>
        {field("Writing sample", <Textarea rows={5} disabled />, "Paste a short example of your writing. Only its style will be used.")}
        {field("Words or phrases to avoid", <Textarea rows={2} disabled />, "One phrase per line.")}
      </section>
      <section className="brand-section">
        <h3>{shimmer("Brand context")}</h3>
        {field("Brand or creator name", <Input disabled />)}
        {field("What do you do?", <Textarea rows={2} disabled />)}
      </section>
      <footer className="brand-save-row">
        {shimmer(<Button disabled>Save changes</Button>, "brand-save-button")}
        {shimmer(<Button variant="link" className="px-0 text-[13px]" disabled>Clear preferences</Button>, "brand-reset")}
      </footer>
    </div>
  </div>;
}

export function BrandSettings({ api, preview = false, active = true }: { api?: StudioApi; preview?: boolean; active?: boolean }) {
  const [initial] = useState(() => {
    const brand = api?.snapshot("/v1/brand", value => ({ profile: readBrand(value) }));
    const capabilities = api?.snapshot("/v1/capabilities", readCapabilities);
    const options = capabilities ? readBrandOptions(capabilities.brand) : null;
    return brand && options ? { profile: brand.profile ?? {}, options } : null;
  });
  const [saved, setSaved] = useState<BrandProfile>(initial?.profile ?? {});
  const [draft, setDraft] = useState<BrandProfile>(initial?.profile ?? {});
  const [phrases, setPhrases] = useState((initial?.profile.avoidPhrases ?? []).join("\n"));
  const [options, setOptions] = useState<BrandOptions | null>(initial?.options ?? null);
  const [loading, setLoading] = useState(!preview && !initial);
  const [loaded, setLoaded] = useState(preview || !!initial);
  const [refreshState, setRefreshState] = useState<"checking" | "ready" | "failed">(preview ? "ready" : "checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [phraseError, setPhraseError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const refresh = useRef<AbortController | null>(null);
  const profile = { ...draft, ...(phrases.trim() ? { avoidPhrases: phrases.split(/\r?\n/).map(value => value.trim()).filter(Boolean) } : { avoidPhrases: [] }) };
  const dirty = loaded && (!sameBrandProfile(draft, saved) || phrases !== (saved.avoidPhrases ?? []).join("\n"));
  useEffect(() => {
    if (!active) {
      setDraft(saved); setPhrases((saved.avoidPhrases ?? []).join("\n")); setBusy(false); setNotice(""); setSaveError(""); setPhraseError(""); setRefreshState("checking");
      return;
    }
    if (!api) return;
    const controller = new AbortController();
    refresh.current = controller;
    const previous = saved;
    setLoading(!loaded); setError(""); setSaveError(""); setPhraseError(""); setRefreshState("checking");
    Promise.all([loadBrand(api, true), api("/v1/capabilities", controller.signal).then(readCapabilities)])
      .then(([brand, capabilities]) => {
        if (controller.signal.aborted) return;
        const latest = brand ?? {};
        // A background refresh must not replace edits made while it was pending.
        setDraft(current => rebaseBrandEdits(previous, latest, current));
        setPhrases(current => current === (previous.avoidPhrases ?? []).join("\n") ? (latest.avoidPhrases ?? []).join("\n") : current);
        setSaved(latest);
        setOptions(readBrandOptions(capabilities.brand)); setLoaded(true); setLoading(false); setRefreshState("ready");
      }).catch(cause => { if (!controller.signal.aborted) { setError(errorMessage(cause)); setLoading(false); setRefreshState("failed"); } });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [api, retry, active]);
  useEffect(() => {
    if (!active || !dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const leave = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || link.hasAttribute("download") || link.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href);
      if (url.href === window.location.href || url.hash) return;
      if (!window.confirm("Leave without saving your brand changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", leave, true); };
  }, [dirty, active]);
  const set = (field: keyof BrandProfile, value: string) => { setDraft(current => ({ ...current, [field]: value })); setNotice(""); setSaveError(""); };
  const maximum = (field: string) => typeof options?.limits[field] === "number" ? options.limits[field] as number : undefined;
  function field(key: "name" | "description" | "audience" | "voice" | "writingExample", label: string, hint?: string, rows = 1) {
    const id = `brand-${key}`;
    const props = { id, value: draft[key] ?? "", maxLength: maximum(key), disabled: busy || !options?.available || preview, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, event.target.value), "aria-describedby": hint ? `${id}-hint` : undefined };
    return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>{key === "name" ? <Input {...props} /> : <Textarea {...props} rows={rows} />}{hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}</Field>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!api || !active || !options?.available || busy || refreshState !== "ready") return;
    setSaveError(""); setPhraseError(""); setNotice("");
    const phraseLimits = options.limits.avoidPhrases as { count: number; length: number };
    if ((profile.avoidPhrases?.length ?? 0) > phraseLimits.count || profile.avoidPhrases?.some(value => value.length > phraseLimits.length)) {
      setPhraseError(`Use up to ${phraseLimits.count} phrases, each no longer than ${phraseLimits.length} characters.`);
      document.getElementById("brand-avoid")?.focus(); return;
    }
    refresh.current?.abort();
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    setBusy(true);
    try {
      const result = await saveBrand(api, profile, controller.signal);
      if (controller.signal.aborted) return;
      setSaved(result ?? {}); setDraft(result ?? {}); setPhrases((result?.avoidPhrases ?? []).join("\n")); setNotice("Saved");
    } catch (cause) { if (!controller.signal.aborted) setSaveError(errorMessage(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="brand-settings">
    <header className="settings-content-heading"><h2>Brand</h2></header>
    {loading ? <BrandSettingsSkeleton /> : <>
      {preview && <p className="inline-notice">Preview only. Brand settings are not saved here.</p>}
      {error && <div className="inline-notice" role="alert"><p>{error}</p>{(!loaded || refreshState === "failed") && <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Try again</Button>}</div>}
      {loaded && <form onSubmit={event => void submit(event)}>
        <div className="brand-form-body">
        {!preview && !options?.available && <p className="inline-notice">{options ? "Active account access is needed to save changes. Your saved preferences are still available." : "Saving is unavailable until brand settings can be checked."} <a className="text-link" href="/usage">View access details</a></p>}
        <section className="brand-section" aria-labelledby="brand-writing-heading">
          <h3 id="brand-writing-heading">Writing preferences</h3>
          {field("audience", "Who is your content for?")}
          <div className="brand-style-field">
          {field("voice", "Writing style")}
          <div className="brand-voice-suggestions" aria-label="Writing style suggestions"><span>Try:</span>{[{ label: "Clear & direct", value: "Clear and direct" }, { label: "Warm", value: "Warm and conversational" }, { label: "Professional", value: "Professional and measured" }].map(({ label, value }) => {
            const added = (draft.voice ?? "").includes(value);
            return <Button variant="link" className="px-0 text-[13px]" type="button" key={value} data-added={added || undefined} disabled={busy || !options?.available || preview || added || ((draft.voice?.trim() ? `${draft.voice.trim()}. ${value}` : value).length > (maximum("voice") ?? 0))} onClick={() => set("voice", draft.voice?.trim() ? `${draft.voice.trim()}. ${value}` : value)}>{added && <Icon name="check" size={14} />}{label}{added && <span className="sr-only"> added</span>}</Button>;
          })}</div>
          </div>
          <LanguageFields language={draft.language ?? ""} spelling={draft.spelling ?? ""} options={options} prefix="brand" compact disabled={busy || !options?.available || preview} onChange={set} />
        </section>
        <section className="brand-section" aria-labelledby="brand-references-heading">
          <h3 id="brand-references-heading">Writing references</h3>
          {field("writingExample", "Writing sample", "Paste a short example of your writing. Only its style will be used.", 5)}
          <Field data-invalid={phraseError ? true : undefined}><FieldLabel htmlFor="brand-avoid">Words or phrases to avoid</FieldLabel><Textarea id="brand-avoid" rows={2} value={phrases} aria-invalid={phraseError ? true : undefined} aria-describedby={`brand-avoid-hint${phraseError ? " brand-avoid-error" : ""}`} disabled={busy || !options?.available || preview} onChange={event => { setPhrases(event.target.value); setNotice(""); setSaveError(""); setPhraseError(""); }} /><FieldDescription id="brand-avoid-hint">One phrase per line.</FieldDescription>{phraseError && <FieldError id="brand-avoid-error">{phraseError}</FieldError>}</Field>
        </section>
        <section className="brand-section" aria-labelledby="brand-context-heading">
          <h3 id="brand-context-heading">Brand context</h3>
          {field("name", "Brand or creator name")}{field("description", "What do you do?", undefined, 2)}
        </section>
        <footer className="brand-save-row">
          {saveError ? <span id="brand-save-error" role="alert" className="brand-save-error">{saveError}</span> : <span role="status" className="brand-save-notice">{busy ? "" : refreshState === "checking" ? "Checking saved preferences…" : notice || (dirty ? "Unsaved changes" : "")}</span>}
          <Button className="brand-save-button" type="submit" disabled={busy || !dirty || !options?.available || preview || refreshState !== "ready"}>{busy ? "Saving…" : "Save changes"}</Button>
          <Button variant="link" className="brand-reset px-0 text-[13px] text-destructive hover:text-destructive focus-visible:border-destructive focus-visible:ring-destructive/50" type="button" disabled={busy || !options?.available || preview} onClick={() => { if (window.confirm("Clear your writing and brand details? This won’t change existing content.")) { setDraft({ ...(draft.colours ? { colours: draft.colours } : {}), ...(draft.fonts ? { fonts: draft.fonts } : {}) }); setPhrases(""); setSaveError(""); setPhraseError(""); setNotice("Preferences cleared. Save changes to apply."); } }}>Clear preferences</Button>
        </footer>
        </div>
      </form>}
    </>}
    </div>;
}
