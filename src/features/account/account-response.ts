import { readLifecycle, type Lifecycle } from "./lifecycle-response.ts";
import type { BrandOptions } from "../brand/brand-response";
import { formats, type Format } from "../projects/generation-response.ts";

export type Capabilities = {
  lifecycle?: Lifecycle;
  intake?: { available: boolean; reason: string };
  accounting?: { mode: "shared_credits"; periodId?: string; creditCosts: Record<Format, number> };
  brand?: BrandOptions;
  subscription: { active: boolean; reason: string; expiresAt: string | null };
  features: Record<string, { available: boolean; reason: string }>;
  limits: Record<string, number> | null;
  operationalLimits?: Record<string, number>;
  generationBatchLimits?: Record<string, number>;
  services?: {
    drive: { configured: boolean };
    intake: { configured: boolean };
    generation: { configured: boolean };
    sources?: {
      drive: { configured: boolean };
      youtube: { configured: boolean };
    };
  };
};
export type Connection = { configured: boolean; connected: boolean };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const counts = (value: unknown) =>
  record(value) &&
  Object.values(value).every(
    (count) =>
      typeof count === "number" && Number.isFinite(count) && count >= 0,
  );

export function readCapabilities(capabilities: unknown) {
  const account = capabilities as Capabilities | null;
  if (
    !account ||
    typeof account.subscription?.active !== "boolean" ||
    typeof account.subscription.reason !== "string" ||
    !record(account.features) ||
    Object.values(account.features).some(
      (feature) =>
        !record(feature) ||
        typeof feature.available !== "boolean" ||
        typeof feature.reason !== "string",
    ) ||
    !(
      account.subscription.expiresAt === null ||
      (typeof account.subscription.expiresAt === "string" &&
        Number.isFinite(Date.parse(account.subscription.expiresAt)))
    ) ||
    !(account.limits === null || counts(account.limits)) ||
    (account.generationBatchLimits !== undefined &&
      !counts(account.generationBatchLimits)) ||
    (account.services !== undefined &&
      (!account.services ||
        ["drive", "intake", "generation"].some(
          (key) =>
            typeof account.services?.[key as "drive" | "intake" | "generation"]
              ?.configured !== "boolean",
        ))) ||
    (account.services?.sources !== undefined &&
      (!record(account.services.sources) ||
        ["drive", "youtube"].some(
          (key) =>
            typeof account.services?.sources?.[key as "drive" | "youtube"]
              ?.configured !== "boolean",
        ))) ||
    (account.operationalLimits !== undefined &&
      (!counts(account.operationalLimits) ||
        !["maxSourceSeconds", "maxSourceBytes"].every(key => Number.isSafeInteger(account.operationalLimits![key]) && account.operationalLimits![key] > 0)))
  ) {
    throw new Error("The server returned unexpected account details.");
  }
  if (account.lifecycle !== undefined) readLifecycle(account.lifecycle);
  if (account.intake !== undefined && (!record(account.intake) || typeof account.intake.available !== "boolean" || typeof account.intake.reason !== "string")) throw new Error("Unexpected import access.");
  if (account.accounting !== undefined) {
    const accounting = account.accounting;
    if (
      !record(accounting) || accounting.mode !== "shared_credits" ||
      (!(account.lifecycle && accounting.periodId === undefined) && (typeof accounting.periodId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(accounting.periodId))) ||
      !record(accounting.creditCosts) || !formats.every(([key]) => Number.isSafeInteger(accounting.creditCosts[key]) && accounting.creditCosts[key] > 0) ||
      (account.limits !== null && !["sourceSeconds", "creationCredits"].every(key => Number.isSafeInteger(account.limits![key]) && account.limits![key] >= 0))
    ) {
      throw new Error("The server returned unexpected account accounting.");
    }
  }
  return account;
}

export const sourceAvailability = (capabilities: Capabilities) =>
  capabilities.services?.sources ?? {
    drive: { configured: capabilities.services?.drive.configured === true },
    youtube: { configured: false },
  };

export function readConnection(value: unknown): Connection {
  const connection = value as Connection | null;
  if (
    !connection ||
    typeof connection.configured !== "boolean" ||
    typeof connection.connected !== "boolean"
  ) {
    throw new Error("The server returned unexpected Drive connection details.");
  }
  return connection;
}

export function readAccountResponse(
  capabilities: unknown,
  connection: unknown,
) {
  return {
    capabilities: readCapabilities(capabilities),
    connection: readConnection(connection),
  };
}

export const intakeAvailable = (capabilities: Capabilities) => capabilities.intake?.available ?? capabilities.subscription.active;
