import type { Lifecycle } from "./lifecycle-response.ts";
import type { Capabilities } from "./account-response";

export function accessMessage(subscription: Capabilities["subscription"], lifecycle?: Lifecycle) {
  if (subscription.active) return null;
  if (lifecycle?.trial.state === "eligible") return { title: "Your trial hasn’t started yet.", detail: "Your seven-day trial begins with your first import request, including an import that fails.", label: "Trial not started" };
  const saved = "Saved content remains available until its expiry date.";
  switch (subscription.reason) {
    case "subscription_expired": {
      const ended = subscription.expiresAt
        ? `Access ended on ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(subscription.expiresAt))}. `
        : "";
      return { title: "Your access has expired.", detail: `${ended}${saved}`, label: "Access expired" };
    }
    case "trial_eligible":
      return { title: "Your trial hasn’t started yet.", detail: "Your seven-day trial begins with your first import request, including an import that fails.", label: "Trial not started" };
    case "trial_expired":
      return { title: "Your trial has expired.", detail: `New creation needs active access. ${saved}`, label: "Trial expired" };
    case "subscription_not_started":
      return { title: "Your access hasn’t started yet.", detail: `New creation is unavailable until your access starts. ${saved}`, label: "Access not started" };
    case "subscription_required":
      return { title: "Active access is needed to create content.", detail: saved, label: "Access needed" };
    default:
      return { title: "Your account access needs attention.", detail: `New creation is paused. ${saved}`, label: "Access paused" };
  }
}
