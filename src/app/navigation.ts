import { useEffect, useState } from "react";
import { readLocation } from "./routes";

export function navigate(path: string, replace = false) {
  const url = new URL(path, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error("Navigation must stay within Riflo.");
  }
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocation() {
  const [href, setHref] = useState(window.location.href);
  useEffect(() => {
    const changed = () => setHref(window.location.href);
    const clicked = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) {
        return;
      }
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || url.hash || readLocation(url).route === "missing") {
        return;
      }
      // Entering or leaving preview starts a separate session boundary.
      if (readLocation(url).preview !== readLocation(new URL(window.location.href)).preview) {
        return;
      }
      event.preventDefault();
      if (url.href !== window.location.href) {
        navigate(url.href);
      }
    };
    window.addEventListener("popstate", changed);
    document.addEventListener("click", clicked);
    return () => {
      window.removeEventListener("popstate", changed);
      document.removeEventListener("click", clicked);
    };
  }, []);
  return new URL(href);
}
