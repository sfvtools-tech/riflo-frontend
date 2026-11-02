import { useLayoutEffect, useRef } from "react";

const entrances = new WeakMap<Element, Animation>();

/** Native entrances only; content and focus never wait for animation completion. */
function enter(element: HTMLElement, kind: "route" | "content") {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  if (media.matches || typeof element.animate !== "function") return;
  // A loading boundary may resolve while its route/ancestor is still entering.
  if (kind === "content" && [element, ...ancestors(element)].some(node => node.getAnimations().some(animation => animation.playState === "running"))) return;
  element.querySelectorAll("*").forEach(child => entrances.get(child)?.cancel());
  const tokens = getComputedStyle(document.documentElement);
  const animation = element.animate([
    { opacity: kind === "route" ? .65 : .72, transform: "translateY(4px)" },
    { opacity: 1, transform: "translateY(0)" },
  ], {
    duration: parseFloat(tokens.getPropertyValue(`--motion-${kind}`)),
    easing: tokens.getPropertyValue("--ease").trim(),
  });
  entrances.set(element, animation);
  const stop = () => animation.cancel();
  const changed = () => { if (media.matches) stop(); };
  media.addEventListener("change", changed);
  void animation.finished.catch(() => undefined).finally(() => media.removeEventListener("change", changed));
  return stop;
}
function ancestors(element: HTMLElement) {
  const nodes: HTMLElement[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) nodes.push(parent);
  return nodes;
}

function useChangeMotion(route: string, kind: "route" | "content") {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(route);
  useLayoutEffect(() => {
    const changed = previous.current !== route;
    previous.current = route;
    if (changed && ref.current) return enter(ref.current, kind);
  }, [route, kind]);
  return ref;
}

export const useRouteMotion = (route: string) => useChangeMotion(route, "route");
export const useContentMotion = (selection: string) => useChangeMotion(selection, "content");

/** Animate a real cold handoff once; cached mounts and later refreshes stay still. */
export function useReadyMotion(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const wasReady = useRef(ready);
  useLayoutEffect(() => {
    if (!ready || wasReady.current) return;
    wasReady.current = true;
    if (ref.current) return enter(ref.current, "content");
  }, [ready]);
  return ref;
}

/** Keep the import disclosure in normal flow while its content changes size. */
export function useHeightMotion(ready = true) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const content = element?.firstElementChild;
    if (!element || !(content instanceof HTMLElement) || typeof ResizeObserver === "undefined") return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let height = content.getBoundingClientRect().height;
    let width = content.getBoundingClientRect().width;
    let animation: Animation | undefined;
    const stop = () => { animation?.cancel(); animation = undefined; };
    const changed = () => { if (media.matches) stop(); };
    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect();
      const from = animation?.playState === "running" ? element.getBoundingClientRect().height : height;
      const resized = next.width !== width;
      width = next.width;
      if (next.height === height && !resized) return;
      height = next.height;
      stop();
      if (media.matches || resized || Math.abs(from - height) < 1 || typeof element.animate !== "function") return;
      const tokens = getComputedStyle(document.documentElement);
      animation = element.animate([
        { height: `${from}px`, overflow: "clip" },
        { height: `${height}px`, overflow: "clip" },
      ], { duration: parseFloat(tokens.getPropertyValue("--motion-content")), easing: tokens.getPropertyValue("--ease").trim() });
    });
    observer.observe(content);
    media.addEventListener("change", changed);
    return () => { observer.disconnect(); media.removeEventListener("change", changed); stop(); };
  }, [ready]);
  return ref;
}
