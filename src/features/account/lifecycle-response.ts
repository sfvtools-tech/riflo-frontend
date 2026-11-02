const trialStates = ["eligible", "active", "expired", "unavailable"] as const;
const paidStates = ["none", "scheduled", "active", "expired", "withdrawn"] as const;
const plans = ["lower", "higher"] as const;
type TrialState = typeof trialStates[number];
type PaidState = typeof paidStates[number];
type Plan = typeof plans[number];
export type Lifecycle = {
  trial: { state: TrialState; startsAt: string | null; expiresAt: string | null };
  paid: { state: PaidState; plan: Plan | null; startsAt: string | null; expiresAt: string | null; cancelAtPeriodEnd: boolean; nextPlan: Plan | null };
  nextChangeAt: string | null;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false;
  }
  return (
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace(/(?<=:\d{2})Z$/, ".000Z")
  );
}
const date = (value: unknown) => value === null || validDate(value);
export function readLifecycle(value: unknown): Lifecycle {
  if (!record(value) || !record(value.trial) || !record(value.paid) ||
      typeof value.trial.state !== "string" || !(trialStates as readonly string[]).includes(value.trial.state) ||
      typeof value.paid.state !== "string" || !(paidStates as readonly string[]).includes(value.paid.state) ||
      !(value.paid.plan === null || typeof value.paid.plan === "string" && (plans as readonly string[]).includes(value.paid.plan)) ||
      !(value.paid.nextPlan === null || typeof value.paid.nextPlan === "string" && (plans as readonly string[]).includes(value.paid.nextPlan)) || typeof value.paid.cancelAtPeriodEnd !== "boolean" ||
      !date(value.nextChangeAt)) throw new Error("Unexpected account lifecycle.");
  for (const period of [value.trial, value.paid]) {
    if (!date(period.startsAt) || !date(period.expiresAt) ||
        ((period.startsAt === null) !== (period.expiresAt === null)) ||
        (period.startsAt !== null && Date.parse(period.startsAt as string) >= Date.parse(period.expiresAt as string))) throw new Error("Unexpected lifecycle dates.");
  }
  return value as Lifecycle;
}
