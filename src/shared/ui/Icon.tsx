type IconName =
  | "message"
  | "briefcase"
  | "article"
  | "mail"
  | "slides"
  | "video"
  | "external"
  | "settings"
  | "projects"
  | "usage"
  | "link"
  | "play"
  | "plus"
  | "close"
  | "check"
  | "spark";
const paths: Record<IconName, string> = {
  message: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
  briefcase: "M8 6V3h8v3M3 6h18v14H3zM3 11l9 3 9-3M10 13v3h4v-3",
  article: "M5 3h14v18H5zM9 7h6M9 11h6M9 15h6",
  mail: "M3 5h18v14H3zM3 5l9 7 9-7",
  slides: "M6 6h12v15H6zM9 3h12v15M3 9v12M9 11h6M9 15h6",
  video: "M3 5h13v14H3zM16 10l5-3v10l-5-3M7 9l5 3-5 3z",
  external: "M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6",
  settings: "M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6",
  projects: "M3 6h7l2 3h9v11H3z",
  usage: "M5 20V12m7 8V4m7 16V8",
  link: "M10 14l4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  play: "m9 5 11 7-11 7z",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "m5 12 4 4L19 6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
