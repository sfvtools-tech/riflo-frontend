import type { StudioApi } from "../../shared/api/client.ts";

export type BrandProfile = Partial<Record<"name" | "description" | "audience" | "voice" | "language" | "spelling" | "writingExample", string>> & {
  avoidPhrases?: string[]; colours?: string[]; fonts?: string[];
};
export type WritingOverrides = Pick<BrandProfile, "audience" | "voice" | "language" | "spelling">;
export type BrandRequest = { mode: "saved"; overrides?: WritingOverrides } | { mode: "none" };
export type BrandOptions = { available: boolean; languages: string[]; limits: Record<string, number | { count: number; length: number }> };
const fields = ["name", "description", "audience", "voice", "language", "spelling", "writingExample"] as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function readBrand(value: unknown): BrandProfile | null {
  if (value === null) return null;
  if (!record(value) || Object.entries(value).some(([key, item]) => fields.includes(key as typeof fields[number]) ? typeof item !== "string" : !["avoidPhrases", "colours", "fonts"].includes(key) || !Array.isArray(item) || !item.every(part => typeof part === "string"))) {
    throw new Error("Your brand settings could not be read.");
  }
  return value as BrandProfile;
}
export function readBrandOptions(value: unknown): BrandOptions | null {
  if (!record(value) || typeof value.available !== "boolean" || !Array.isArray(value.languages) || !value.languages.every(item => typeof item === "string") || !record(value.limits)) return null;
  const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
  if (!fields.every(field => positive((value.limits as Record<string, unknown>)[field]))) return null;
  const phrases = value.limits.avoidPhrases;
  if (!record(phrases) || !positive(phrases.count) || !positive(phrases.length)) return null;
  return value as BrandOptions;
}
export function readBrandRequest(value: unknown): BrandRequest {
  if (!record(value) || !["saved", "none"].includes(String(value.mode)) || Object.keys(value).some(key => !["mode", "overrides"].includes(key))) throw new Error("Unexpected writing preferences.");
  if (value.mode === "none") {
    if (value.overrides !== undefined) throw new Error("Unexpected writing preferences.");
    return { mode: "none" };
  }
  if (value.overrides !== undefined && (!record(value.overrides) || Object.entries(value.overrides).some(([key, item]) => !["audience", "voice", "language", "spelling"].includes(key) || typeof item !== "string"))) throw new Error("Unexpected writing preferences.");
  return value as BrandRequest;
}
// Absent fields inherit saved defaults; empty language/spelling explicitly clear them.
export function writingBrand(mode: "saved" | "none", edits: WritingOverrides): BrandRequest | undefined {
  if (mode === "none") return { mode };
  const overrides = Object.fromEntries(Object.entries(edits)
    .map(([key, value]) => [key, value.trim()])
    .filter(([key, value]) => key === "language" || key === "spelling" || value !== ""));
  return Object.keys(overrides).length ? { mode, overrides } : undefined;
}
export function rebaseBrandEdits(previous: BrandProfile, latest: BrandProfile, edits: BrandProfile): BrandProfile {
  const same = (first: unknown, second: unknown) => JSON.stringify(first ?? "") === JSON.stringify(second ?? "");
  return Object.fromEntries(Object.keys({ ...previous, ...latest, ...edits }).flatMap(key => {
    const field = key as keyof BrandProfile;
    const value = same(edits[field], previous[field]) ? latest[field] : edits[field];
    return value === undefined ? [] : [[key, value]];
  }));
}
export function sameBrandProfile(first: BrandProfile, second: BrandProfile) {
  return Object.keys({ ...first, ...second }).every(key => {
    const field = key as keyof BrandProfile;
    return JSON.stringify(first[field]) === JSON.stringify(second[field]);
  });
}
// Each API instance belongs to one signed-in account; samples stay in memory only.
type CachedBrand = { value?: BrandProfile | null; pending?: Promise<BrandProfile | null> };
const profiles = new WeakMap<StudioApi, CachedBrand>();
export function loadBrand(api: StudioApi, reload = false): Promise<BrandProfile | null> {
  const cached = profiles.get(api) ?? {};
  profiles.set(api, cached);
  if (cached.pending) return cached.pending;
  if (!reload && cached.value !== undefined) return Promise.resolve(cached.value);
  const pending = api("/v1/brand").then(readBrand).then(value => {
    if (profiles.get(api) === cached) cached.value = value;
    return value;
  }).finally(() => { if (cached.pending === pending) delete cached.pending; });
  cached.pending = pending;
  return pending;
}
export async function saveBrand(api: StudioApi, profile: BrandProfile, signal: AbortSignal) {
  const saved = readBrand(await api("/v1/brand", signal, { method: "PUT", body: profile }));
  profiles.set(api, { value: saved });
  return saved;
}
