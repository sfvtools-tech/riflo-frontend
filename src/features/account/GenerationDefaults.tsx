import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage, type StudioApi } from '../../shared/api/client';
import { formats } from '../projects/generation-response';
import { FormatFields } from '../projects/GenerationControls';
import { readDefaults, readControlsOptions, type GenerationDefaults, type ControlsOptions } from '../projects/generation-controls';
function readSettings(value: unknown) {
  if (!value || typeof value !== 'object' || !('defaults' in value) || !('controls' in value)) {
    throw new Error('Generation defaults could not be read.');
  }
  return {
    defaults: value.defaults === null ? {} : readDefaults(value.defaults),
    controls: readControlsOptions(value.controls),
  };
}

export function GenerationDefaultsSection({ api, preview }: { api?: StudioApi; preview: boolean }) {
  const [draft, setDraft] = useState<GenerationDefaults>({});
  const [saved, setSaved] = useState<GenerationDefaults>({});
  const [options, setOptions] = useState<ControlsOptions | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    if (!api || preview) return;
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true);
    setError('');
    api('/v1/generation-defaults', controller.signal)
      .then(readSettings)
      .then(result => {
        if (controller.signal.aborted) return;
        setDraft(result.defaults);
        setSaved(result.defaults);
        setOptions(result.controls);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [api, preview, retry]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const leave = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || link.hasAttribute('download') || link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href);
      if (url.href === window.location.href || url.hash) return;
      if (!window.confirm('Leave without saving your generation defaults?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', leave, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', leave, true); };
  }, [dirty]);
  async function save() {
    if (!api || !options?.available || saving.current || loading) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = readSettings(await api('/v1/generation-defaults', controller.signal, {
        method: 'PUT',
        body: draft,
      }));
      if (!controller.signal.aborted) {
        setSaved(result.defaults);
        setDraft(result.defaults);
        setOptions(result.controls);
        setNotice('Saved');
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) {
        saving.current = false;
        setBusy(false);
      }
    }
  }
  return <section className="settings-section" aria-labelledby="generation-defaults-heading">
    <div className="settings-section-heading">
      <h2 id="generation-defaults-heading">Generation defaults</h2>
    </div>
    <p className="mb-5 text-sm text-muted-foreground">
      Save choices for each format. You can change them for an individual creation.
    </p>
    {preview ? (
      <p className="text-sm text-muted-foreground">Defaults are available in your signed-in studio.</p>
    ) : loading ? (
      <div role="status" aria-label="Loading generation defaults">
        {formats.map(([format, name]) => <details key={format} className="border-t border-border py-3" inert aria-hidden="true">
          <summary className="min-h-11 text-sm font-medium">{name}</summary>
        </details>)}
        <div className="mt-5 flex flex-wrap items-center gap-4" aria-hidden="true">
          <Button disabled>Save defaults</Button>
          <Button variant="ghost" disabled>Discard changes</Button>
        </div>
      </div>
    ) : <>
      {options && <>
        {!options.available && <p role="status" className="mb-4 text-sm text-muted-foreground">
          Customization is not available yet. Saved defaults will apply when it becomes available.
        </p>}
        {formats.map(([format, name]) => <details key={format} className="border-t border-border py-3">
          <summary className="min-h-11 cursor-pointer text-sm font-medium">{name}</summary>
          <div className="pb-3 pt-2">
            <FormatFields
              format={format}
              options={options}
              value={draft}
              onChange={value => { setDraft(value); setNotice(''); }}
              prefix="defaults"
              saved
              disabled={busy || !options.available}
            />
          </div>
        </details>)}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button disabled={!dirty || busy || !options.available} aria-busy={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save defaults'}
          </Button>
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setDraft(saved); setNotice(''); }}>
            Discard changes
          </Button>
          {notice && <span role="status" className="text-sm text-muted-foreground">{notice}</span>}
        </div>
      </>}
    </>}
    {error && <div role="alert" className="mt-4 text-sm text-destructive">
      <p>{error}</p>
      {!options && !loading && <Button variant="outline" onClick={() => setRetry(v => v + 1)}>
        Retry defaults
      </Button>}
    </div>}
  </section>;
}
