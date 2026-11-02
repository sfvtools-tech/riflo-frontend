import { ChevronRight, Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useContentMotion } from "../../shared/ui/motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContentFormatIcon, CreateContentChooser } from "./CreateContentChooser";
import type { PreviewState } from "../../app/routes";
const names: Record<Format, string> = { x_posts: "X post", linkedin_posts: "LinkedIn post", blogs: "Blog", newsletters: "Newsletter", carousels: "Carousel", short_videos: "Short video" };

import { formats, type Format } from "./generation-response";
const samples: Partial<Record<Format, string>> = {
  x_posts:
    "A creative rhythm starts with a smaller promise: show up for twenty minutes. Leave enough room to want to come back tomorrow.",
  linkedin_posts:
    "The hardest part of creative work is often protecting time for it.\n\nIn this sample conversation, the speaker describes a simple practice: a short, repeatable session with one clear intention.\n\nA useful question for your own week: what could you make space for before adding another commitment?",
  blogs:
    "Finding your creative rhythm\n\nBegin with a small promise\n\nA repeatable practice can give an idea somewhere to grow. In this illustrative conversation, the starting point is twenty quiet minutes rather than a perfect day.\n\nLeave a thread for tomorrow\n\nBefore ending a session, write down the next step. The next beginning feels less distant when you know where to start.",
  newsletters:
    "Subject: A little room for the good stuff\nPreview: One small practice for a crowded week.\n\nHello,\n\nWhat would happen if you protected twenty minutes for the work that matters to you?\n\nThis sample conversation explores making a small promise, keeping it manageable, and leaving one clear next step for tomorrow.\n\nHere’s a question to carry into the week: where could you make a little room?",
};
export function PreviewResults({ state }: { state: PreviewState }) {
  const [creationOpen, setCreationOpen] = useState(false);
  const [format, setFormat] = useState<Format | null>(null);
  const [focusDrafts, setFocusDrafts] = useState<Partial<Record<Format, string>>>({});
  const closeTarget = useRef<"output" | "progress" | null>(null);
  const progress = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Format>("blogs");
  const [saved, setSaved] = useState<Format[]>(state === "empty" || state === "importing" ? [] : ["blogs", "linkedin_posts", "x_posts", "newsletters"]);
  const [creating, setCreating] = useState<Format | null>(state === "generating" ? "linkedin_posts" : null);
  const [failed, setFailed] = useState(state === "partial");
  const [notice, setNotice] = useState("");
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => { setMount(document.getElementById("project-create-content")); }, []);
  const motion = useContentMotion(selected);
  const focusRequested = useRef(false);
  useEffect(() => { if (focusRequested.current) { motion.current?.focus(); focusRequested.current = false; } }, [selected, motion]);
  function viewSaved(feature: Format) {
    if (selected === feature) motion.current?.focus();
    else { focusRequested.current = true; setSelected(feature); }
  }
  const lockedReason = (key: Format) => state === "importing" ? "Available after import finishes."
    : state === "unconfigured" ? "Generation is currently unavailable."
    : state === "expired" && key === "short_videos" ? "Import the original video again."
    : creating ? `${names[creating]} is being created. Finish the sample below before creating more.` : "";
  const descriptions: Record<Format, string> = {
    x_posts: "A sharp idea for your feed.", linkedin_posts: "Turn an insight into a conversation.",
    blogs: "Give your ideas room to unfold.", newsletters: "Bring the highlights to an inbox.",
    carousels: "Tell your story, slide by slide.", short_videos: "A shareable moment from your source.",
  };
  const choices = format ? <div className="generation-options">
    <p className="mb-5 text-sm text-muted-foreground">Illustrative settings only. This preview shows a fixed sample result.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label className="mb-2 block text-sm font-medium" htmlFor="sample-setting">{format === "x_posts" ? "X format" : format === "carousels" ? "Slide theme" : format === "short_videos" ? "Speech captions" : "Length"}</label>
        <select id="sample-setting" className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm" disabled>
          <option>{format === "x_posts" ? "Single post" : format === "carousels" ? "Light" : format === "short_videos" ? "Off" : "Standard"} · sample</option>
        </select>
      </div>
    </div>
    <div className="mt-6"><label className="mb-2 block text-sm font-medium" htmlFor="sample-focus">Focus (optional)</label>
      <textarea id="sample-focus" className="min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm" rows={2} value={focusDrafts[format] ?? ""} onChange={event => setFocusDrafts(current => ({ ...current, [format]: event.target.value }))} aria-describedby="sample-focus-hint" />
      <p id="sample-focus-hint" className="mt-2 text-xs text-muted-foreground">Try the field; the sample content stays unchanged. No preferences are saved.</p>
    </div>
    {lockedReason(format) && <div className="generation-restriction mt-5" role="status"><p>{lockedReason(format)}</p>{state === "expired" && format === "short_videos" && <a className="text-link" href="/projects">Import a video</a>}</div>}
    {saved.includes(format) && <Button variant="link" className="mt-4 px-0" onClick={() => { closeTarget.current = "output"; viewSaved(format); setCreationOpen(false); }}>View saved sample {names[format]}</Button>}
  </div> : <div className="generation-format-grid">{formats.map(([key]) => <button type="button" className="generation-format-tile" data-format={key} key={key} onClick={() => setFormat(key)}>
    <ContentFormatIcon format={key} /><span className="generation-format-tile-copy"><strong>{names[key]}</strong><span>{descriptions[key]}</span><small>{lockedReason(key) || "Preview · no credits used"}</small></span><ChevronRight size={16} className="generation-format-chevron" aria-hidden="true" />
  </button>)}</div>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(samples[selected] ?? ""); setNotice("Sample copied to clipboard."); }
    catch { setNotice("Copy was unavailable. Select the sample text to copy it."); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([samples[selected] ?? ""], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = `riflo-sample-${selected}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="project-workspace">
    {mount && createPortal(
        <CreateContentChooser title={format ? names[format] : "Create sample content"} description={format ? undefined : "Choose a format to explore. No video is processed."} open={creationOpen} onOpenChange={setCreationOpen} onOpen={() => setFormat(null)} onBack={format ? () => setFormat(null) : undefined}
          onCloseAutoFocus={event => {
            if (!closeTarget.current) return;
            event.preventDefault();
            if (closeTarget.current === "output") motion.current?.focus();
            else progress.current?.focus();
            closeTarget.current = null;
          }}
          footer={format ? <><div className="generation-creation-cost"><strong>No credits used</strong><small>Illustrative preview</small></div><Button className="button button-primary" disabled={!!lockedReason(format)} onClick={() => { closeTarget.current = "progress"; setCreating(format); setFailed(false); setCreationOpen(false); }}>Generate sample</Button></> : undefined}>{choices}</CreateContentChooser>,
        mount,
      )}
    {state === "importing" && <div className="generation-status" role="status">Importing sample video. Generation becomes available when import finishes.</div>}
    {creating && <div ref={progress} tabIndex={-1} className="generation-status" role="status"><p>Creating your {names[creating]}. Giving your ideas a new form. You can leave this page; processing continues in the background.</p><Button variant="outline" size="sm" className="button button-small" onClick={() => { setSaved(current => current.includes(creating) ? current : [...current, creating]); setSelected(creating); setCreating(null); }}>Show sample result</Button></div>}
    {failed && <div className="generation-status" role="alert"><p>Your LinkedIn post couldn’t be created. Your saved content is still here.</p><Button variant="outline" size="sm" className="button button-small" onClick={() => { setCreating("linkedin_posts"); setFailed(false); }}>Try again</Button></div>}
    {saved.length === 0 ? <section className="workspace-empty" aria-labelledby="saved-content-heading">
      <div className="section-heading"><h2 id="saved-content-heading" tabIndex={-1}>Saved content <span>0 outputs</span></h2></div>
      <div className="workspace-empty-paper"><div className="workspace-empty-intro"><h3>Give this video a new form.</h3><p>Open Create content to choose a format.<br />Your content will be saved here, ready to read.</p></div></div>
    </section> : <section className="results-section" aria-label="Sample saved content">
      <div className="section-heading"><h2 id="saved-content-heading">Saved content <span>{saved.length} outputs</span></h2></div>
      <div className="reading-room">
        <nav className="output-index" aria-label="Choose sample output">{saved.map(key => <Button variant="outline" size="sm" key={key} aria-pressed={selected === key} onClick={() => { setSelected(key); setNotice(""); }}>{names[key]} <span>01</span></Button>)}</nav>
        <article ref={motion} className={`output-paper ${samples[selected] ? "output-paper-text" : "output-paper-media"}`} key={selected} tabIndex={-1}>
          <header className="output-toolbar"><span className="eyebrow output-format-label">{names[selected]}</span>{samples[selected] && <div className="output-actions"><Button variant="outline" size="sm" className="button button-small" onClick={() => void copy()}>Copy text</Button><Button variant="outline" size="sm" className="button button-small" onClick={download}>Download TXT <Download size={16} aria-hidden="true" /></Button></div>}</header>
          {samples[selected] ? <div className="output-copy">{samples[selected]}</div> : selected === "carousels" ? <div className="slide-strip">{["Make room for the good stuff.", "Start with a smaller promise.", "Leave a thread for tomorrow."].map((title, i) => <div className="slide-preview" key={title}><div className="sample-art"><span>THE CREATIVE PRACTICE / 0{i + 1}</span><h3>{title}</h3><span>Illustrative layout · not a generated PNG</span></div></div>)}</div> : <div className="sample-clip"><span>SAMPLE COMPOSITION</span><strong>Good ideas deserve a little room.</strong><span>Illustrative frame · no playable video</span></div>}
          {notice && <p role="status">{notice}</p>}
          <p className="retention-note">Sample available until 6 Nov, 6:30 PM. Review before sharing.</p>
        </article>
      </div>
    </section>}
    <p className="generation-instruction">Illustrative content · No video processed.</p>
  </div>;
}
