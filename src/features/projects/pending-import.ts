import {
  importIntentKey,
  parseDriveLink,
  readVideo,
  type SourceInput,
  type VideoDetails,
} from "./project-response.ts";

export type PendingImport = {
  input: SourceInput;
  details: VideoDetails | null;
  key: string;
  submittedURL?: string;
};
type SavedImport = PendingImport | { invalid: true };
const validKey = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function readInput(value: unknown): SourceInput {
  if (!record(value)) {
    throw Error();
  }
  if (value.source === "youtube" && Object.keys(value).length === 2 && typeof value.url === "string" && value.url.length > 0) {
    return { source: "youtube", url: value.url };
  }
  if (
    value.source === "youtube" &&
    Object.keys(value).length === 2 &&
    typeof value.videoId === "string" &&
    /^[A-Za-z0-9_-]{11}$/.test(value.videoId)
  ) {
    return { source: "youtube", videoId: value.videoId };
  }
  if (
    Object.keys(value).some(
      (key) => !["fileId", "resourceKey"].includes(key),
    ) ||
    typeof value.fileId !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(value.fileId) ||
    (value.resourceKey !== undefined &&
      (typeof value.resourceKey !== "string" ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(value.resourceKey)))
  ) {
    throw Error();
  }
  return {
    fileId: value.fileId,
    ...(value.resourceKey ? { resourceKey: value.resourceKey as string } : {}),
  };
}
function readIntent(value: unknown): PendingImport {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["input", "details", "key", "submittedURL"].includes(key),
    ) ||
    (value.submittedURL !== undefined && typeof value.submittedURL !== "string") ||
    !validKey(value.key)
  ) {
    throw Error();
  }
  const input = readInput(value.input);
  const details = value.details === null ? null : readVideo(value.details);
  if (
    details &&
    ("source" in input
      ? details.source !== "youtube" || !("videoId" in input) || details.videoId !== input.videoId
      : details.source === "youtube" || details.fileId !== input.fileId)
  ) {
    throw Error();
  }
  if ("source" in input && "url" in input && value.submittedURL !== input.url) throw Error();
  if (!("source" in input) && typeof value.submittedURL === "string") {
    const submitted = parseDriveLink(value.submittedURL);
    if (submitted.fileId !== input.fileId || submitted.resourceKey !== input.resourceKey) throw Error();
  }
  return { input, details, key: value.key, ...(value.submittedURL !== undefined ? { submittedURL: value.submittedURL as string } : {}) };
}

export function pendingImport(storage: Storage, uid: string) {
  const envelopeKey = `riflo:import:${uid}`;
  return {
    read(): SavedImport | null {
      try {
        const saved = storage.getItem(envelopeKey);
        if (saved !== null) {
          return readIntent(JSON.parse(saved));
        }
        // Old markers encode the original input; restore it rather than ask for a new selection.
        for (let index = 0; index < storage.length; index++) {
          const name = storage.key(index)!;
          const key = storage.getItem(name);
          if (!validKey(key)) {
            continue;
          }
          if (name.startsWith(`riflo-import:${uid}:`)) {
            const parts = name.slice(`riflo-import:${uid}:`.length).split(":");
            if (parts.length !== 2) {
              return { invalid: true };
            }
            const [fileId, resourceKey] = parts;
            return {
              input: readInput({
                fileId,
                ...(resourceKey ? { resourceKey } : {}),
              }),
              details: null,
              key,
            };
          }
          if (name.startsWith(`riflo-youtube-import:${uid}:`)) {
            return {
              input: readInput({
                source: "youtube",
                videoId: name.slice(`riflo-youtube-import:${uid}:`.length),
              }),
              details: null,
              key,
            };
          }
        }
        return null;
      } catch {
        return { invalid: true };
      }
    },
    save(intent: PendingImport) {
      storage.setItem(envelopeKey, JSON.stringify(readIntent(intent)));
    },
    clear(intent: PendingImport) {
      const saved = storage.getItem(envelopeKey);
      if (saved && JSON.parse(saved).key === intent.key) {
        storage.removeItem(envelopeKey);
      }
      const legacyKey = importIntentKey(uid, intent.input);
      if (storage.getItem(legacyKey) === intent.key) {
        storage.removeItem(legacyKey);
      }
    },
  };
}
