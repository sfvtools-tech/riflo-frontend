import { ChevronDown } from "lucide-react";
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { formats, type Format, type Selection } from './generation-response';
import { resolvedFields, type ControlsAvailability, type ControlsOptions, type GenerationDefaults, type GenerationControls, type ControlsSnapshot } from './generation-controls';
const labels: Record<string,string> = { length:'Length', mode:'X format', maxPosts:'Maximum posts', numbering:'Numbering', density:'Slide density', theme:'Slide theme', duration:'Target duration', editing:'Editing', captions:'Speech captions' };
export function controlLabel(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return ({auto:'Auto',single:'Single post',thread:'Thread',continuous:'One continuous clip',clean:'Clean',off:'Off',include:'Include',exclude:'Exclude'} as Record<string,string>)[value] ?? value.charAt(0).toUpperCase()+value.slice(1);
}
export function FormatFields({
  format, options, value, onChange, prefix, disabled, saved = false, compact = false, creation = false,
}: {
  format: Format;
  options: ControlsOptions & { defaults?: GenerationDefaults; threadAvailable?: boolean };
  value: GenerationDefaults;
  onChange: (value: GenerationDefaults) => void;
  prefix: string;
  disabled?: boolean;
  saved?: boolean;
  compact?: boolean;
  creation?: boolean;
}) {
  const fields = value[format] as Record<string, string | number> | undefined;
  const resolved = resolvedFields(format, {
    builtins: options.builtins,
    defaults: options.defaults ?? {},
  }, value);
  return <div className={compact ? "grid items-start gap-4" : "grid items-start gap-4 sm:grid-cols-2"}>
    {Object.entries(options.choices[format]).map(([key, choices]) => {
      if (
        !choices.length ||
        (!saved && format === 'x_posts' && ['maxPosts', 'numbering'].includes(key) && resolved.mode !== 'thread')
      ) {
        return null;
      }
      const inherited = (options.defaults?.[format] as Record<string, string | number> | undefined)?.[key]
        ?? (options.builtins[format] as Record<string, string | number> | undefined)?.[key];
      const id = `${prefix}-${format}-${key}`;
      const missingThreadPreference = format === 'x_posts'
        && ['maxPosts', 'numbering'].includes(key)
        && resolved[key] === undefined;
      const threadUnavailable = key === 'mode' && options.threadAvailable === false;
      return <Field key={key}>
        <FieldLabel htmlFor={id}>{labels[key]}</FieldLabel>
        <NativeSelect
          id={id}
          disabled={disabled}
          aria-describedby={missingThreadPreference || threadUnavailable ? `${id}-hint` : undefined}
          value={fields?.[key] ?? ''}
          onChange={event => {
            const next = { ...fields };
            if (!event.target.value) {
              delete next[key];
            } else {
              next[key] = choices.find(choice => String(choice) === event.target.value)!;
            }
            const result = { ...value };
            if (Object.keys(next).length) {
              Object.assign(result, { [format]: next });
            } else {
              delete result[format];
            }
            onChange(result);
          }}
        >
          <NativeSelectOption value="">
            {saved
              ? ((options.builtins[format] as Record<string, string | number> | undefined)?.[key] === undefined
                ? 'Not set'
                : 'Use built-in default')
              : inherited === undefined
                ? 'Choose…'
                : creation
                  ? key === 'duration' && typeof inherited === 'number'
                    ? `About ${inherited} seconds`
                    : key === 'maxPosts' ? `Up to ${inherited} posts` : controlLabel(inherited)
                  : `Use ${options.defaults?.[format] && Object.hasOwn(options.defaults[format]!, key) ? 'saved' : 'default'}: ${controlLabel(inherited)}`}
          </NativeSelectOption>
          {choices.map(choice => <NativeSelectOption
            key={choice}
            value={choice}
            disabled={key === 'mode' && choice === 'thread' && options.threadAvailable === false}
          >
            {key === 'duration' && typeof choice === 'number'
              ? `About ${choice} seconds`
              : key === 'maxPosts' ? `Up to ${choice} posts` : controlLabel(choice)}
          </NativeSelectOption>)}
        </NativeSelect>
        {threadUnavailable && <FieldDescription id={`${id}-hint`}>
          Threads are unavailable for this account. Choose Single post.
        </FieldDescription>}
        {missingThreadPreference && <FieldDescription id={`${id}-hint`}>
          Choose before creating a thread.
        </FieldDescription>}
        {key === 'length' && <FieldDescription>
          Approximate target; source-supported content can be shorter.
        </FieldDescription>}
      </Field>;
    })}
  </div>;
}
export type SourceDraft = {focus:string;start:string;end:string};
export function CreationOptions({format, options, value, onChange, source, onSourceChange, disabled}: {
  format:Format; options:ControlsAvailability; value:GenerationDefaults; onChange:(v:GenerationDefaults)=>void;
  source:SourceDraft; onSourceChange:(v:SourceDraft)=>void; disabled:boolean;
}) {
  const resolved = resolvedFields(format, options, value);
  return <div className="generation-options grid gap-5">
    <section className="generation-format-settings" aria-labelledby={`format-settings-${format}`}>
    <div className="generation-settings-heading">
      <h3 id={`format-settings-${format}`}>Format settings</h3>
      <Button className="generation-reset" type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => {
        const next = { ...value };
        delete next[format];
        onChange(next);
        onSourceChange({ focus: '', start: '', end: '' });
      }}>Reset to defaults</Button>
    </div>
    <FormatFields
      format={format}
      options={options}
      value={value}
      onChange={onChange}
      prefix="creation"
      creation
      disabled={disabled}
    />
    <details className="creation-disclosure generation-defaults-note text-xs text-muted-foreground">
      <summary><span>About these defaults</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <p className="mb-3 leading-relaxed">
        {Object.entries(resolved)
          .filter(([key]) => !['maxPosts', 'numbering'].includes(key) || resolved.mode === 'thread')
          .map(([key, v]) => `${labels[key]}: ${key === 'duration' && typeof v === 'number' ? `About ${v} seconds` : controlLabel(v)} (${Object.hasOwn(value[format] ?? {}, key) ? 'this creation' : Object.hasOwn(options.defaults[format] ?? {}, key) ? 'saved' : 'default'})`)
          .join(' · ')}
      </p>
      <a className="text-primary underline underline-offset-4" href="/settings">Manage Generation defaults</a>
    </details>
    </section>
    <Field>
      <FieldLabel htmlFor={`focus-${format}`}>Focus <span className="font-normal text-muted-foreground">Optional</span></FieldLabel>
      <Textarea
        id={`focus-${format}`}
        value={source.focus}
        maxLength={options.focusMaxCharacters}
        disabled={disabled}
        rows={2}
        placeholder="e.g. The advice on finding your first customers"
        onChange={e => onSourceChange({ ...source, focus: e.target.value })}
      />
    </Field>
    <details key={format} className="creation-disclosure border-b border-border" open={source.start || source.end ? true : undefined}>
      <summary>
        <span>Use part of the source<small>{source.start || source.end ? `${source.start || '…'}–${source.end || '…'} seconds` : 'Full source'}</small></span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <fieldset disabled={disabled} className="grid min-w-0 gap-3 border-0 p-0 pt-3">
        <legend className="sr-only">Source window (optional)</legend>
        <div className="grid grid-cols-2 gap-3">
          {(['start', 'end'] as const).map(key => <Field key={key}>
            <FieldLabel htmlFor={`${format}-${key}`}>{key === 'start' ? 'Start' : 'End'} seconds</FieldLabel>
            <Input
              id={`${format}-${key}`}
              type="number"
              min={0}
              step="any"
              value={source[key]}
              onChange={e => onSourceChange({ ...source, [key]: e.target.value })}
              aria-describedby={`${format}-window-hint`}
            />
          </Field>)}
        </div>
        <FieldDescription id={`${format}-window-hint`}>
          Enter both times or leave both empty to use the full source.
          {format === 'short_videos' ? ' Video windows must span at least 10 seconds.' : ' Only material inside this interval will be used.'}
        </FieldDescription>
      </fieldset>
    </details>

  </div>;
}



export function CreationControlsSummary({ controls, selection, pending = false }: {
  controls: GenerationControls | ControlsSnapshot; selection?: Selection; pending?: boolean;
}) {
  const snapshot = 'version' in controls ? controls : null;
  return <section className="my-5 border-y border-border py-4 text-sm" aria-label={pending ? 'Pending creation settings' : 'Accepted creation settings'}>
    <h3 className="mb-2 font-sans text-sm font-semibold tracking-normal">
      {pending ? 'Pending request settings' : 'Latest creation settings'}
    </h3>
    {snapshot?.status === 'unavailable' && <p role="status" className="mb-2 text-destructive">
      Saved generation defaults could not be loaded for this creation. Built-in defaults and explicit choices were used.
    </p>}
    <ul className="m-0 grid list-none gap-2 p-0 text-muted-foreground">
      {formats.filter(([format]) => controls.formats?.[format] || selection?.[format]).map(([format, name]) => {
        const fields = controls.formats?.[format] as Record<string, string | number> | undefined;
        const summary = Object.entries(fields ?? {})
          .filter(([key]) => !['maxPosts', 'numbering'].includes(key) || fields?.mode === 'thread' || pending)
          .map(([key, value]) => {
            const origin = snapshot?.origins[format]?.[key];
            const source = origin === 'saved' ? 'saved' : origin === 'builtin' ? 'default' : 'this creation';
            const label = key === 'duration' && typeof value === 'number' ? `About ${value} seconds` : controlLabel(value);
            return `${labels[key]}: ${label} (${source})`;
          }).join(' · ');
        return <li key={format}><strong className="font-medium text-foreground">{name}: </strong>{summary || 'Saved or built-in defaults'}</li>;
      })}
    </ul>
    {controls.focus && <p className="mt-2 break-words text-muted-foreground">Focus: {controls.focus}</p>}
    <p className="mt-2 text-muted-foreground">
      {controls.sourceWindow ? `Source: ${controls.sourceWindow.startSeconds}–${controls.sourceWindow.endSeconds} seconds.` : 'Source: full eligible source.'}
      {pending && ' Unchanged controls inherit the defaults resolved when this request is accepted.'}
    </p>
  </section>;
}
