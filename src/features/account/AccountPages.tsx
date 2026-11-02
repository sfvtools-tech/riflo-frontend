import type { PreviewState } from "../../app/routes";
import { UsageView } from "./UsagePage";
import { allowanceLabels, type Usage } from "./usage-response";
import { DriveConnectionView } from "../projects/DriveConnection";

export function AccountPage({
  kind,
  state,
}: {
  kind: "usage" | "connections";
  preview: boolean;
  state: PreviewState;
}) {
  if (kind === "usage") {
    const sample = Object.fromEntries(
      allowanceLabels.map(([key]) => [
        key,
        key === "sourceSeconds" ? 7200 : 20,
      ]),
    );
    const used = Object.fromEntries(
      allowanceLabels.map(([key]) => [
        key,
        state === "empty" ? 0 : key === "sourceSeconds" ? 1260 : 3,
      ]),
    );
    const reserved = Object.fromEntries(
      allowanceLabels.map(([key]) => [
        key,
        ["importing", "generating"].includes(state)
          ? key === "sourceSeconds"
            ? 180
            : 1
          : 0,
      ]),
    );
    const usage: Usage = {
      startsAt: "2026-10-01T00:00:00Z",
      expiresAt: "2026-11-01T00:00:00Z",
      limits: sample,
      consumed: used,
      reserved,
      remaining: Object.fromEntries(
        allowanceLabels.map(([key]) => [
          key,
          sample[key] - used[key] - reserved[key],
        ]),
      ),
    };
    return <UsageView usage={usage} active={state !== "expired"} preview />;
  }
  return <DriveConnectionView connection={{ connected: state !== "empty" && state !== "unconfigured", configured: state !== "unconfigured" }} active={state !== "expired"} preview />;
}
