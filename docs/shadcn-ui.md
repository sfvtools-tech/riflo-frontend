# Source-owned UI controls

Sign-in, General settings, Brand settings, Usage, Connections, Projects, project detail and their shared recovery and preview controls use shadcn/ui's copy-and-own distribution, installed manually into this existing Vite project. `components.json` and the `@/` TypeScript/Vite alias support future targeted additions; no CLI initialization or generated default theme was applied.

Sources retrieved 2026-10-29 from the official `new-york-v4` registry:

- [Input](https://ui.shadcn.com/r/styles/new-york-v4/input.json)
- [Textarea](https://ui.shadcn.com/r/styles/new-york-v4/textarea.json)
- [Button](https://ui.shadcn.com/r/styles/new-york-v4/button.json)
- [Native Select](https://ui.shadcn.com/r/styles/new-york-v4/native-select.json)
- [Field](https://ui.shadcn.com/r/styles/new-york-v4/field.json), including its [Label](https://ui.shadcn.com/r/styles/new-york-v4/label.json) and [Separator](https://ui.shadcn.com/r/styles/new-york-v4/separator.json) dependencies

The upstream MIT license is retained in `src/components/ui/LICENSE.md`. Components retain upstream composition, props, variants, and `data-slot` contracts. Imports use the individual Radix Slot, Label and Separator packages rather than the aggregate catalog. `cn` is the standard clsx/tailwind-merge helper. Lucide supplies Native Select's decorative chevron.

Local styling adaptations own 44px targets, explicit border style, inherited typography, neutral control surfaces, mobile 16px text, vertical textarea resizing, motion reduction and visible forced-color focus. Button action states use Kingfisher blue; Field descriptions use the existing muted text role. Existing handlers, validation, capability gates and caching are unchanged.

`src/styles/ui.css` imports Tailwind v4 theme and utilities with **no Preflight**, following [Tailwind's selective import guidance](https://tailwindcss.com/docs/preflight#disabling-preflight). The entire existing `app.css` is imported into one `legacy` layer, preserving its internal order while component utility styles take precedence. This avoids per-page exclusions, IDs and `!important` rules. Fonts and `tokens.css` remain unchanged. The dark variant follows the application's existing `data-theme="dark"` contract.

Semantic utilities bridge existing tokens via isolated `--ui-*` aliases. Legacy `--muted` (text), `--accent` (copper) and `--radius` (16px) keep their existing meanings; shadcn's muted/accent surface colors and 8px control radius are separate aliases. No default shadcn theme globals are installed.

Setup references: [Vite](https://ui.shadcn.com/docs/installation/vite), [manual installation](https://ui.shadcn.com/docs/installation/manual), [Field](https://ui.shadcn.com/docs/components/field), [Native Select](https://ui.shadcn.com/docs/components/native-select).

General settings reuses Button for the external account link and subtle destructive sign-out action. Appearance keeps native radios for browser arrow-key selection, using token-based peer selection and focus states. Sign-in reuses Button for Google authentication and its preview link, and the nonsegmented Appearance control uses Native Select. Only migrated modules are registered as extra Tailwind sources; the theme lifecycle remains unchanged.

Usage reuses Button for refresh, retry and saved-project navigation, with native disabled/busy refresh feedback. Its grant ledger keeps the server’s per-format limits and balances, uses native description lists, and preserves cached data with an explicit warning. The access badge and error/access-paused states use existing outcome tokens. No progress widget or dependency is needed. Only `UsagePage.tsx` is added as a Tailwind source.

Connections shares its Google Drive view between live and preview, with shadcn Button actions and token-based connection badges. Connect, disconnect and refresh retain their existing server and OAuth behavior; pending checks disable all provider actions. Shared account-load, access-check and connection-status recovery actions use Button across routes; connection retries remain disabled during a pending check. Only `DriveConnection.tsx` and `LiveProjects.tsx` are added as Tailwind sources.

Project detail uses Button for retry, creation and saved-result controls, preserving the native disclosure summary through `asChild`. The page keeps its single-column reader, format chooser and source details. Transcription retry has separate feedback and persisted request identity, uses the existing finite generation operation stream, and creates no output rows or success counts. The backend's transcription recovery metadata and per-format decisions determine retry and creation eligibility. Detail component sources are registered explicitly; no new primitive or dependency is needed.

Projects list and import reuse Button, Input and FieldLabel/FieldDescription while keeping the existing ledger and source-confirmation layout. Source choices remain native radios with token-based selected and keyboard-focus states. Opening by keyboard focuses the source choice; Escape closes import and returns focus to its toggle. Synchronous request guards prevent duplicate validation, Picker and import submissions. Persisted request identities, source permissions, backend capability gates and finite operation observation remain authoritative. Only the list/import/preview modules are registered as additional Tailwind sources.

The shared preview toolbar uses Native Select with native GET submission and Button; missing-page return actions preserve anchor navigation through Button `asChild`. Project writing preferences are local, one-generation overrides and never fetch the saved profile; their choices and bounds come from project availability. Brand settings retain their separate saved-profile loading and recovery. Ordinary navigation anchors, radios, checkboxes, disclosure elements, description lists and native video controls retain their browser semantics. `App.tsx` is registered explicitly as a Tailwind source.
