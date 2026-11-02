import { test } from "node:test";
import assert from "node:assert/strict";
import { readLocation, routeHref } from "../src/app/routes.ts";

test("sample content requires explicit preview selection", () => {
  for (const query of ["", "?preview=false", "?preview=1", "?state=partial"]) {
    assert.equal(
      readLocation(new URL(`https://riflo.test/projects${query}`)).preview,
      false,
    );
  }
  assert.equal(
    readLocation(new URL("https://riflo.test/projects?preview=true")).preview,
    true,
  );
});
test("deep links, fallback states and unknown paths stay predictable", () => {
  assert.equal(
    readLocation(
      new URL("https://riflo.test/projects/sample?preview=true&state=partial"),
    ).route,
    "project",
  );
  assert.equal(
    readLocation(new URL("https://riflo.test/projects?state=garbage")).state,
    "source_ready",
  );
  assert.equal(
    readLocation(new URL("https://riflo.test/unknown")).route,
    "missing",
  );
  assert.equal(readLocation(new URL("https://riflo.test/settings")).route, "settings");
  assert.equal(routeHref("/projects", false, "partial"), "/projects");
  assert.equal(
    routeHref("/usage", true, "partial"),
    "/usage?preview=true&state=partial",
  );
});

test("project settings deep links remain scoped to one project", () => {
  for (const suffix of ["", "/"]) assert.equal(readLocation(new URL(`https://riflo.test/projects/sample/settings${suffix}`)).route, "project-settings");
  assert.equal(readLocation(new URL("https://riflo.test/projects/sample/settings/other")).route, "missing");
});
