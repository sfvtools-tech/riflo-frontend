import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { LanguageFields } from "./BrandSettings";
import { writingBrand, type BrandRequest, type WritingOverrides } from "./brand-response";
import type { WritingPreferenceOptions } from "../projects/generation-response";

const inherit = "__inherit_saved_preference__";
export function WritingPreferences({ options, disabled, onChange, prefix = "creation" }: {
  prefix?: string;
  options: WritingPreferenceOptions | null; disabled: boolean;
  onChange: (value: BrandRequest | undefined) => void;
}) {
  const [mode, setMode] = useState<"saved" | "none">("saved");
  const [edits, setEdits] = useState<WritingOverrides>({});
  useEffect(() => { onChange(writingBrand(mode, edits)); }, [mode, edits, onChange]);
  const set = (field: keyof WritingOverrides, value: string) => setEdits(current => {
    const next = { ...current };
    if (value === inherit) delete next[field];
    else next[field] = value;
    return next;
  });
  const changed = !!writingBrand(mode, edits);
  return <details className="writing-preferences creation-disclosure">
    <summary><span>Writing preferences<small>{mode === "none" ? "Using source defaults" : changed ? "Customized for this creation" : "Using saved preferences"}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="writing-preferences-body">
      <p>For written content and carousel text. Original video speech stays unchanged.</p>
      <label className="writing-preferences-toggle"><input type="checkbox" checked={mode === "saved"} disabled={disabled} onChange={event => setMode(event.target.checked ? "saved" : "none")} />Use saved preferences for this creation</label>
      {mode === "saved" && <fieldset className="writing-preferences-fields" disabled={disabled || !options}>
        <legend className="sr-only">Change preferences for this creation only</legend>
        <Field><FieldLabel htmlFor={`${prefix}-audience`}>Audience</FieldLabel><Textarea id={`${prefix}-audience`} rows={2} value={edits.audience ?? ""} placeholder="Use saved preference" maxLength={options?.limits.audience} onChange={event => set("audience", event.target.value)} /></Field>
        <Field><FieldLabel htmlFor={`${prefix}-voice`}>Writing style</FieldLabel><Textarea id={`${prefix}-voice`} rows={2} value={edits.voice ?? ""} placeholder="Use saved preference" maxLength={options?.limits.voice} onChange={event => set("voice", event.target.value)} /></Field>
        <LanguageFields prefix={prefix} language={edits.language ?? inherit} spelling={edits.spelling ?? inherit} inheritValue={inherit} options={options} onChange={set} />
        <small>Changes here apply once. Your saved brand won’t change.</small>
      </fieldset>}
      <a className="text-link" href="/settings/brand">Brand settings</a>
    </div>
  </details>;
}
