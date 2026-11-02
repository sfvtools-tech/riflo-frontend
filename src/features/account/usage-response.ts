import { readLifecycle, validDate, type Lifecycle } from "./lifecycle-response.ts";
import { formats } from "../projects/generation-response.ts";

export const allowanceLabels = [
  ["sourceSeconds", "Source video"],
  ...formats.map(([key, label]) => [key, label]),
] as readonly (readonly string[])[];
const periodKinds = ["trial", "paid"] as const;
type PeriodKind = typeof periodKinds[number];
type UsageMeters = {
  limits: Record<string, number>;
  consumed: Record<string, number>;
  reserved: Record<string, number>;
  remaining: Record<string, number>;
};
export type UsagePeriod = UsageMeters & {
  kind: PeriodKind;
  active: boolean;
  accounting: { mode: "shared_credits"; periodId: string };
  startsAt: string;
  expiresAt: string;
};
export type Usage = UsageMeters & {
  accounting?: { mode: "shared_credits"; periodId?: string };
  lifecycle?: Lifecycle;
  periods?: UsagePeriod[];
  startsAt: string | null;
  expiresAt: string | null;
};
export const usageLabels = (usage: Usage) => usage.accounting?.mode === "shared_credits"
  ? [["sourceSeconds", "Source video"], ["creationCredits", "Creation credits"]] as const
  : allowanceLabels;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function readUsage(value: unknown): Usage {
  const lifecycle = record(value) && value.lifecycle !== undefined ? readLifecycle(value.lifecycle) : undefined;
  const empty = lifecycle && record(value) && value.startsAt === null && value.expiresAt === null;
  if (
    !record(value) ||
    (!empty && (!validDate(value.startsAt) ||
    !validDate(value.expiresAt) ||
    Date.parse(value.startsAt) >= Date.parse(value.expiresAt)))
  ) {
    throw new Error("The server returned unexpected usage details.");
  }
  if (value.accounting !== undefined && (
    !record(value.accounting) || value.accounting.mode !== "shared_credits" ||
    (!(lifecycle && value.accounting.periodId === undefined) && (typeof value.accounting.periodId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.accounting.periodId)))
  )) {
    throw new Error("The server returned unexpected usage accounting.");
  }
  const labels = value.accounting === undefined ? allowanceLabels : [["sourceSeconds"], ["creationCredits"]];
  for (const field of ["limits", "consumed", "reserved", "remaining"]) {
    const counts = value[field];
    if (
      !record(counts) ||
      labels.some(
        ([key]) =>
          typeof counts[key] !== "number" ||
          !Number.isFinite(counts[key]) ||
          (counts[key] as number) < 0,
      )
    ) {
      throw new Error("The server returned unexpected usage details.");
    }
    if (value.accounting !== undefined && !Number.isSafeInteger(counts.creationCredits)) {
      throw new Error("The server returned unexpected creation credits.");
    }
  }
  if (lifecycle) {
    if (!record(value.accounting) || value.accounting.mode !== "shared_credits" || !Array.isArray(value.periods) || value.periods.length > 2) throw new Error("Unexpected lifecycle allowance periods.");
    const kinds = new Set();
    for (const period of value.periods) {
      if (!record(period) || typeof period.kind !== "string" || !periodKinds.some(kind => kind === period.kind) || typeof period.active !== "boolean" || !record(period.accounting) || period.accounting.mode !== "shared_credits" || typeof period.accounting.periodId !== "string" || period.lifecycle !== undefined || period.periods !== undefined || kinds.has(period.kind)) throw new Error("Unexpected lifecycle allowance period.");
      kinds.add(period.kind);
      readUsage(period);
      for (const field of ["limits", "consumed", "reserved", "remaining"]) {
        if (!Object.values(period[field] as Record<string, number>).every(Number.isSafeInteger)) throw new Error("Unexpected lifecycle allowance counts.");
      }
    }
    for (const field of ["limits", "consumed", "reserved", "remaining"]) {
      if (!Object.values(value[field] as Record<string, number>).every(Number.isSafeInteger)) throw new Error("Unexpected lifecycle allowance counts.");
    }
  } else if (value.periods !== undefined) throw new Error("Unexpected allowance periods.");
  return value as Usage;
}
export function allowanceAmount(key: string, value: number): string {
  if (key !== "sourceSeconds") {
    return value.toLocaleString();
  }
  const rounded = Number(value.toFixed(2));
  const minutes = Math.floor(rounded / 60);
  const seconds = Number((rounded % 60).toFixed(2));
  return `${minutes.toLocaleString()}m${seconds ? ` ${seconds}s` : ""}`;
}
