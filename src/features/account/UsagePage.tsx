import { Button } from "@/components/ui/button";
import { useReadyMotion } from "../../shared/ui/motion";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { useEffect, useState } from "react";
import { ApiError, errorMessage, type StudioApi } from "../../shared/api/client";
import type { Capabilities } from "./account-response";
import { accessMessage } from "./access-message";
import {
  allowanceAmount,
  allowanceLabels,
  usageLabels,
  readUsage,
  type Usage,
} from "./usage-response";

const date = (value: string | null) => value === null ? "Not started" :
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));

export function UsagePage({
  api,
  capabilities,
  onAccessRefresh,
  checkingAccess = false,
}: {
  api: StudioApi;
  capabilities: Capabilities;
  onAccessRefresh: () => void;
  checkingAccess?: boolean;
}) {
  const [usage, setUsage] = useState<Usage | null>(() => api.snapshot("/v1/usage", readUsage));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPending(true);
    api("/v1/usage", controller.signal)
      .then((value) => setUsage(readUsage(value)))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
            setUsage(null);
          }
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [api, capabilities.subscription.active, capabilities.lifecycle?.nextChangeAt, attempt]);
  return (
    <UsageView
      usage={usage}
      error={error}
      active={capabilities.subscription.active}
      subscription={capabilities.subscription}
      features={capabilities.features}
      pending={pending || checkingAccess}
      onRefresh={() => {
        if (checkingAccess || pending) return;
        setPending(true);
        onAccessRefresh();
        setAttempt((value) => value + 1);
      }}
    />
  );
}

export function UsageView({
  usage,
  error = "",
  active = true,
  subscription,
  features,
  onRefresh,
  preview = false,
  pending = false,
}: {
  usage: Usage | null;
  error?: string;
  active?: boolean;
  subscription?: Capabilities["subscription"];
  features?: Capabilities["features"];
  onRefresh?: () => void;
  preview?: boolean;
  pending?: boolean;
}) {
  const motion = useReadyMotion(usage !== null || !active);
  const access = subscription && accessMessage(subscription, usage?.lifecycle);
  return (
    <div ref={motion} className="usage-page" aria-busy={pending}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR ALLOWANCE</p>
          <h1>
            Room for good ideas<span className="accent-text">.</span>
          </h1>
          <p>
            A clear view of what you’ve used, what’s in progress, and what’s
            still yours.
          </p>
        </div>
        {onRefresh && (
          <Button variant="outline" className="mt-5 w-full sm:mt-0 sm:w-auto" onClick={onRefresh} disabled={pending} aria-busy={pending}>
            {pending ? active ? "Refreshing usage…" : "Refreshing access…" : active ? "Refresh usage" : "Refresh access"}
          </Button>
        )}
      </div>
      {error && usage && <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-0 border-l-2 border-solid border-[var(--warning)] py-2 pl-4" role="alert"><p className="text-[var(--warning)]">{error} Showing the last loaded allowance.</p>{onRefresh && <Button variant="outline" onClick={onRefresh} disabled={pending}>Try again</Button>}</div>}
      {error && !usage && active ? (
        <section className="empty-panel" role="alert">
          <h2>A little interruption.</h2>
          <p className="text-[var(--error)]">{error}</p>
          {onRefresh && <Button onClick={onRefresh} disabled={pending}>Try again</Button>}
        </section>
      ) : !active && !usage ? (
        <section className="content-panel">
          <p className="eyebrow text-[var(--warning)]">ACCESS PAUSED</p>
          <h2>{access?.title ?? "Your work still has a home."}</h2>
          <p>
            {access?.detail ?? "There’s no active allowance for new processing. Saved projects remain available until their expiry date."}
          </p>
          {error && <p className="text-[var(--error)]" role="alert">{error}</p>}
          <p>Contact the Riflo team to arrange access.</p>
          <Button asChild className="mt-4"><a href={preview ? "/projects?preview=true" : "/projects"}>View saved projects</a></Button>
        </section>
      ) : !usage ? (
        <PageSkeleton kind="usage" contentOnly />
      ) : (
        <>
          {!active && <section className="content-panel"><p className="eyebrow text-[var(--warning)]">{usage.lifecycle?.trial.state === "eligible" ? "TRIAL NOT STARTED" : "ACCESS PAUSED"}</p><h2>{access?.title ?? "No active allowance for new processing."}</h2><p>{access?.detail}</p><Button asChild className="mt-4"><a href={preview ? "/projects?preview=true" : "/projects"}>View saved projects</a></Button></section>}
          {usage.lifecycle && <section className="allowance-notes"><p>Trial balances are used first, separately for source time and creation credits, until the original trial deadline.</p>{usage.lifecycle.paid.cancelAtPeriodEnd && <p>Cancellation is scheduled. Paid access continues until {date(usage.lifecycle.paid.expiresAt)} (UTC).</p>}{usage.lifecycle.paid.nextPlan && <p>Your {usage.lifecycle.paid.nextPlan} plan takes effect at renewal.</p>}</section>}
          {(usage.periods ?? [usage]).map((period, periodIndex) => <div key={period.accounting?.periodId ?? periodIndex}>
          <section className="allowance-period flex-wrap">
            <div>
              <p className="eyebrow">
                {usage.periods ? `${"kind" in period ? String(period.kind).toUpperCase() : ""} ALLOWANCE PERIOD` : preview ? "SAMPLE ACCESS PERIOD" : "CURRENT ACCESS PERIOD"}
              </p>
              <h2>
                {date(period.startsAt)} <span>—</span> {date(period.expiresAt)}
              </h2>
              <p>
                Dates shown in UTC. Allowances belong to this access period. {"active" in period && !period.active && "These balances are unavailable for new work."}
              </p>
            </div>
            <span className="inline-flex h-fit shrink-0 items-center gap-2 rounded-md border border-solid border-border px-3 py-1.5 text-xs font-medium text-[var(--success)]">
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {preview ? "Sample access" : ("active" in period ? period.active : active) ? "Active allowance" : "kind" in period && usage.lifecycle?.paid.state === "scheduled" && period.kind === "paid" ? "Scheduled allowance" : "kind" in period && usage.lifecycle?.paid.state === "withdrawn" && period.kind === "paid" ? "Access withdrawn" : "Expired allowance"}
            </span>
          </section>
          <section
            className="allowance-ledger"
            aria-label="Allowance breakdown"
          >
            <div className="allowance-head" aria-hidden="true">
              <span>What you can make</span>
              <span>Used</span>
              <span>In progress</span>
              <span>Remaining</span>
            </div>
            {usageLabels(period).map(([key, label], index) => (
              <article className="allowance-row" key={key} aria-labelledby={`allowance-${periodIndex ? `${periodIndex}-` : ""}${key}`}>
                <div className="allowance-name">
                  <span className="ledger-number" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 id={`allowance-${periodIndex ? `${periodIndex}-` : ""}${key}`}>{label}</h3>
                    <p>
                      {allowanceAmount(key, period.limits[key])}{" "}
                      {key === "sourceSeconds" || key === "creationCredits"
                        ? "included"
                        : "outputs included"}
                    </p>
                  </div>
                </div>
                {(["consumed", "reserved", "remaining"] as const).map(
                  (field) => (
                    <dl className={`allowance-count ${field} m-0 min-w-0`} key={field}>
                      <dt className="count-label block min-[701px]:sr-only">
                        {field === "consumed"
                          ? "Used"
                          : field === "reserved"
                            ? "In progress"
                            : "Remaining"}
                      </dt>
                      <dd className="m-0">
                        <strong className="break-words"
                      >
                        {allowanceAmount(key, period[field][key])}
                        </strong>
                      </dd>
                    </dl>
                  ),
                )}
              </article>
            ))}
          </section>
          </div>)}
          {usage.periods?.length === 0 && <p className="quiet-note">No allowance period has started. Viewing this page does not start a trial.</p>}
          {features && <section className="mt-4 border-0 border-t border-solid border-border py-6">
            <h2 className="mb-2 text-xl">Formats included in your access</h2>
            <p className="text-sm text-muted-foreground">{allowanceLabels.filter(([key]) => key !== "sourceSeconds" && ["available", "not_implemented"].includes(features[key]?.reason)).map(([, label]) => label).join(" · ") || "No generation formats are included."}</p>
          </section>}
          <div className="allowance-notes">
            <section>
              <h3>Count the finished work.</h3>
              <p>
                {usage.accounting ? "Creation credits count when an output is delivered." : "Outputs count when delivered."} In-progress amounts are set aside
                while work runs. Source time counts once when a video is
                successfully imported.
              </p>
            </section>
            <section>
              <h3>No hidden numbers.</h3>
              <p>
                This page shows your allowance. It does not show an invoice or
                estimated AI spending.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
