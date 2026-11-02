import { useEffect, useState } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Preference = "system" | "light" | "dark";
export function useAppearanceTheme() {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let initialized = false;
    let revision = 0;
    let transition: ViewTransition | undefined;
    let effectiveTheme = root.dataset.theme;
    const apply = () => {
      const current = ++revision;
      const preference = (root.dataset.appearance as Preference) || "system";
      const theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
      const changed = effectiveTheme !== theme;
      effectiveTheme = theme;
      const update = () => {
        if (current !== revision) return;
        root.dataset.appearance = preference;
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        root.style.backgroundColor = "var(--paper)";
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#161616" : "#ECECEC");
      };
      if (initialized && changed) {
        transition?.skipTransition();
        if (!reducedMotion.matches && document.startViewTransition) {
          transition = document.startViewTransition(update);
          // Rendering and appearance state never depend on the snapshot succeeding.
          void transition.finished.catch(() => undefined);
        } else update();
      } else update();
      initialized = true;
    };
    apply();
    const motionChanged = () => { if (reducedMotion.matches) transition?.skipTransition(); };
    reducedMotion.addEventListener("change", motionChanged);
    media.addEventListener("change", apply);
    window.addEventListener("riflo:appearance", apply);
    return () => {
      revision++;
      transition?.skipTransition();
      reducedMotion.removeEventListener("change", motionChanged);
      media.removeEventListener("change", apply);
      window.removeEventListener("riflo:appearance", apply);
    };
  }, []);
}

export function Appearance({ segmented = false }: { segmented?: boolean }) {
  const [preference, setPreference] = useState<Preference>(() => (document.documentElement.dataset.appearance as Preference) || "system");
  const choose = (value: Preference) => {
    try { localStorage.setItem("riflo:appearance", value); } catch { /* Keep working without storage. */ }
    document.documentElement.dataset.appearance = value;
    window.dispatchEvent(new Event("riflo:appearance"));
    setPreference(value);
  };
  if (segmented) return <fieldset className="appearance-options m-0 min-w-0 border-0 p-0" aria-describedby="appearance-description">
    <legend className="p-0 text-base font-semibold">Appearance</legend>
    <p id="appearance-description" className="mt-2 mb-6 text-sm leading-relaxed text-muted-foreground">Choose how Riflo looks on this device.</p>
    <div className="appearance-segments box-border flex max-w-90 gap-1 rounded-[10px] border border-solid border-border bg-[var(--rail)] p-1">{(["system", "light", "dark"] as const).map(value =>
      <label key={value} className="relative min-w-0 flex-1 cursor-pointer"><input className="peer sr-only" type="radio" name="appearance" value={value} checked={preference === value} onChange={() => choose(value)} /><span className="grid min-h-11 place-items-center rounded-[6px] text-sm text-muted-foreground transition-colors duration-150 peer-checked:bg-background peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-[0_1px_3px_var(--shadow-color)] peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring motion-reduce:transition-none forced-colors:peer-focus-visible:outline-[Highlight]">{value[0].toUpperCase() + value.slice(1)}</span></label>
    )}</div>
  </fieldset>;
  return <label className="appearance-control grid grid-cols-[auto_7rem]"><span>Appearance</span><NativeSelect className="w-28" aria-label="Appearance" value={preference} onChange={(event) => choose(event.target.value as Preference)}><NativeSelectOption value="system">System</NativeSelectOption><NativeSelectOption value="light">Light</NativeSelectOption><NativeSelectOption value="dark">Dark</NativeSelectOption></NativeSelect></label>;
}
