import type { Format, Selection } from './generation-response.ts';

export type FormatControls = {
  x_posts: {
    length?: 'auto' | 'short' | 'standard';
    mode?: 'single' | 'thread';
    maxPosts?: number;
    numbering?: 'include' | 'exclude';
  };
  linkedin_posts: { length?: 'auto' | 'short' | 'medium' | 'long' };
  blogs: FormatControls['linkedin_posts'];
  newsletters: FormatControls['linkedin_posts'];
  carousels: {
    density?: 'auto' | 'standard' | 'light';
    theme?: 'auto' | 'dark' | 'light';
  };
  short_videos: {
    duration?: 'auto' | 15 | 30 | 45 | 60;
    editing?: 'auto' | 'continuous';
    captions?: 'clean' | 'off';
  };
};
export type GenerationDefaults = Partial<FormatControls>;
export type GenerationControls = {
  focus?: string;
  sourceWindow?: { startSeconds: number; endSeconds: number };
  formats?: GenerationDefaults;
};
export const controlValues = {
  x_posts: {
    length: ['auto', 'short', 'standard'],
    mode: ['single', 'thread'],
    maxPosts: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    numbering: ['include', 'exclude'],
  },
  linkedin_posts: { length: ['auto', 'short', 'medium', 'long'] },
  blogs: { length: ['auto', 'short', 'medium', 'long'] },
  newsletters: { length: ['auto', 'short', 'medium', 'long'] },
  carousels: {
    density: ['auto', 'standard', 'light'],
    theme: ['auto', 'dark', 'light'],
  },
  short_videos: {
    duration: ['auto', 15, 30, 45, 60],
    editing: ['auto', 'continuous'],
    captions: ['clean', 'off'],
  },
} as const;
export type ControlChoices = Record<Format, Record<string, readonly (string | number)[]>>;
export type ControlsOptions = {
  version: 1;
  available: boolean;
  choices: ControlChoices;
  builtins: GenerationDefaults;
};
export type ControlsAvailability = ControlsOptions & {
  threadAvailable?: boolean;
  focusMaxCharacters: number;
  defaults: GenerationDefaults;
  defaultsStatus: 'resolved' | 'unavailable';
};
export type ControlsSnapshot = GenerationControls & {
  version: 1;
  status: 'resolved' | 'unavailable';
  formats: GenerationDefaults;
  origins: Partial<Record<Format, Record<string, 'explicit' | 'saved' | 'builtin'>>>;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function invalid(): never {
  throw new Error('Generation settings could not be read.');
}

export function readDefaults(v: unknown): GenerationDefaults {
  if (!object(v)) invalid();
  for (const [format, fields] of Object.entries(v)) {
    if (!Object.hasOwn(controlValues, format) || !object(fields)) invalid();
    const options = controlValues[format as Format] as Record<string, readonly unknown[]>;
    for (const [key, value] of Object.entries(fields)) {
      if (!Object.hasOwn(options, key) || !options[key].includes(value)) invalid();
    }
  }
  return v as GenerationDefaults;
}

export function readControls(v: unknown, selection?: Selection): GenerationControls {
  if (!object(v) || Object.keys(v).some(key => !['focus', 'sourceWindow', 'formats'].includes(key))) {
    invalid();
  }
  if (v.focus !== undefined && (
    typeof v.focus !== 'string' ||
    v.focus.length > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(v.focus)
  )) {
    invalid();
  }
  if (v.formats !== undefined) {
    readDefaults(v.formats);
    if (selection && Object.keys(v.formats as object).some(key => !selection[key as Format])) {
      invalid();
    }
  }
  if (v.sourceWindow !== undefined) {
    const w = v.sourceWindow;
    if (
      !object(w) ||
      Object.keys(w).length !== 2 ||
      typeof w.startSeconds !== 'number' ||
      typeof w.endSeconds !== 'number' ||
      !Number.isFinite(w.startSeconds) ||
      !Number.isFinite(w.endSeconds) ||
      w.startSeconds < 0 ||
      w.endSeconds <= w.startSeconds ||
      (selection?.short_videos && w.endSeconds - w.startSeconds < 10)
    ) {
      invalid();
    }
  }
  return v as GenerationControls;
}

export function readControlsOptions(v: unknown): ControlsOptions {
  if (!object(v) || v.version !== 1 || typeof v.available !== 'boolean' || !object(v.choices)) {
    invalid();
  }
  for (const [format, fields] of Object.entries(controlValues)) {
    const choices = v.choices[format];
    if (!object(choices) || Object.keys(choices).some(key => !Object.hasOwn(fields, key))) {
      invalid();
    }
    for (const [key, allowed] of Object.entries(fields)) {
      if (
        !Array.isArray(choices[key]) ||
        !(choices[key] as unknown[]).every(item => (allowed as readonly unknown[]).includes(item))
      ) {
        invalid();
      }
    }
  }
  readDefaults(v.builtins);
  return v as ControlsOptions;
}

export function readControlsAvailability(v: unknown): ControlsAvailability {
  readControlsOptions(v);
  const item = v as ControlsAvailability;
  if (
    !['resolved', 'unavailable'].includes(item.defaultsStatus) ||
    !Number.isSafeInteger(item.focusMaxCharacters) ||
    item.focusMaxCharacters < 1 ||
    item.focusMaxCharacters > 500
  ) {
    invalid();
  }
  if (item.threadAvailable !== undefined && typeof item.threadAvailable !== 'boolean') {
    invalid();
  }
  readDefaults(item.defaults);
  return item;
}

export function readControlsSnapshot(v: unknown): ControlsSnapshot {
  if (
    !object(v) ||
    v.version !== 1 ||
    !['resolved', 'unavailable'].includes(String(v.status)) ||
    !object(v.origins)
  ) {
    invalid();
  }
  readControls({
    ...(v.focus !== undefined ? { focus: v.focus } : {}),
    ...(v.sourceWindow !== undefined ? { sourceWindow: v.sourceWindow } : {}),
    formats: v.formats,
  });
  for (const [format, fields] of Object.entries(v.origins)) {
    if (!Object.hasOwn(controlValues, format) || !object(fields)) invalid();
    for (const [field, origin] of Object.entries(fields)) {
      if (
        !Object.hasOwn(controlValues[format as Format], field) ||
        !['explicit', 'saved', 'builtin'].includes(String(origin))
      ) {
        invalid();
      }
    }
  }
  const formats = v.formats as GenerationDefaults;
  for (const [format, fields] of Object.entries(formats)) {
    const origins = v.origins[format];
    if (
      !object(origins) ||
      Object.keys(fields).some(field => !Object.hasOwn(origins, field)) ||
      Object.keys(origins).some(field => !Object.hasOwn(fields, field))
    ) {
      invalid();
    }
  }
  if (Object.keys(v.origins).some(format => !Object.hasOwn(formats, format))) invalid();
  return v as ControlsSnapshot;
}

export function resolvedFields(
  format: Format,
  options: Pick<ControlsAvailability, 'defaults' | 'builtins'>,
  edits: GenerationDefaults = {},
) {
  return {
    ...options.builtins[format],
    ...options.defaults[format],
    ...edits[format],
  } as Record<string, string | number>;
}

export function threadMaximum(
  format: Format,
  options: ControlsAvailability | undefined,
  edits: GenerationDefaults,
): number | null {
  if (format !== 'x_posts' || !options?.available) return 1;
  const fields = resolvedFields(format, options, edits);
  return fields.mode !== 'thread'
    ? 1
    : typeof fields.maxPosts === 'number' && fields.numbering ? fields.maxPosts : null;
}

export function buildControls(
  format: Format,
  edits: GenerationDefaults,
  source: { focus: string; start: string; end: string },
  duration: number | null,
): GenerationControls {
  const controls: GenerationControls = {
    ...(source.focus.trim() ? { focus: source.focus.trim() } : {}),
    ...(edits[format] ? { formats: { [format]: edits[format] } } : {}),
  };
  if (source.start !== '' || source.end !== '') {
    if (!source.start.trim() || !source.end.trim()) {
      throw new Error('Enter both source window times.');
    }
    controls.sourceWindow = {
      startSeconds: Number(source.start),
      endSeconds: Number(source.end),
    };
    if (duration === null || controls.sourceWindow.endSeconds > duration) {
      throw new Error('The source window must fit within the original video.');
    }
  }
  try {
    readControls(controls, { [format]: 1 });
  } catch {
    throw new Error('Check the focus and source window. Video windows must span at least ten seconds.');
  }
  return controls;
}
