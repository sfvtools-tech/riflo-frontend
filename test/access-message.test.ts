import { test } from "node:test";
import assert from "node:assert/strict";
import { accessMessage } from "../src/features/account/access-message.ts";

test("access explanations follow the backend decision rather than inferring expiry", () => {
  const subscription = { active: false, reason: "subscription_expired", expiresAt: "2026-10-25T18:38:46.961Z" };
  const expired = accessMessage(subscription)!;
  assert.equal(expired.title, "Your access has expired.");
  assert.match(expired.detail, /Access ended on/);
  assert.match(expired.detail, /Saved content remains available/);
  assert.equal(accessMessage({ ...subscription, active: true }), null, "past date alone does not override the backend");
  assert.equal(accessMessage({ ...subscription, reason: "subscription_required" })!.label, "Access needed");
  assert.equal(accessMessage({ ...subscription, reason: "subscription_not_started" })!.label, "Access not started");
  for (const reason of ["invalid_subscription", "unknown_future_reason"]) {
    assert.equal(accessMessage({ ...subscription, reason })!.label, "Access paused");
    assert.doesNotMatch(accessMessage({ ...subscription, reason })!.detail, /Access ended/);
  }
  assert.doesNotMatch(accessMessage({ ...subscription, expiresAt: null })!.detail, /Access ended/);
});
