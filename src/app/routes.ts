export const previewStates = [
  "empty",
  "importing",
  "source_ready",
  "generating",
  "partial",
  "expired",
  "unconfigured",
] as const;
export type PreviewState = (typeof previewStates)[number];
export type Route =
  | "signin"
  | "projects"
  | "project-settings"
  | "project"
  | "usage"
  | "settings"
  | "brand"
  | "connections"
  | "missing";

export function readLocation(url: URL): {
  route: Route;
  preview: boolean;
  state: PreviewState;
} {
  const path = url.pathname.replace(/\/$/, "") || "/";
  const route: Route =
    path === "/" || path === "/signin"
      ? "signin"
      : path === "/projects"
        ? "projects"
        : /^\/projects\/[^/]+\/settings$/.test(path)
          ? "project-settings"
        : /^\/projects\/[^/]+$/.test(path)
          ? "project"
          : path === "/usage"
            ? "usage"
            : path === "/settings/brand"
              ? "brand"
              : path === "/settings"
              ? "settings"
              : path === "/connections"
              ? "connections"
              : "missing";
  const selected = url.searchParams.get("state");
  const state =
    previewStates.find((value) => value === selected) ?? "source_ready";
  return { route, preview: url.searchParams.get("preview") === "true", state };
}

export function routeHref(
  path: string,
  preview: boolean,
  state?: PreviewState,
) {
  const query = new URLSearchParams();
  if (preview) {
    query.set("preview", "true");
  }
  if (preview && state) {
    query.set("state", state);
  }
  return path + (query.size ? `?${query}` : "");
}
