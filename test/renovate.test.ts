/**
 * Reading a Renovate body, and deciding what is not routine.
 *
 * The table shapes below are the real ones this repository produces. The
 * column count is not fixed, and a positional pattern once silently skipped
 * every GitHub Action update — so the shapes are pinned rather than assumed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collect, render, type PullRequest } from "../src/copy/renovate/digest.js";
import { concerns, minorsSkipped, numericParts, updatesIn } from "../src/copy/renovate/updates.js";

const HELM_BODY = [
  "| Package | Update | Change |",
  "|---|---|---|",
  "| [reloader](https://example.test/reloader) | patch | `2.2.15` → `2.2.16` |",
  "| [kube-prometheus-stack](https://example.test/kps) | minor | `66.2.1` → `66.7.0` |",
].join("\n");

const ACTION_BODY = [
  "| Package | Type | Update | Change |",
  "|---|---|---|---|",
  "| [home-operations/flate](https://example.test/flate) | action | minor | `v0.4.14` → `v0.5.0` |",
  "| [actions/checkout](https://example.test/checkout) | action | major | `v4` → `v5` |",
].join("\n");

describe("versions", () => {
  it("reads the shapes Renovate actually produces", () => {
    assert.deepEqual(numericParts("2.2.15"), [2, 2, 15]);
    assert.deepEqual(numericParts("v1.46.0"), [1, 46, 0]);
    assert.deepEqual(numericParts("3.13-alpine"), [3, 13]);
    assert.deepEqual(numericParts("2026.4.1"), [2026, 4, 1]);
    assert.deepEqual(numericParts("latest"), []);
  });

  it("counts the minors a jump crosses", () => {
    assert.equal(minorsSkipped("66.2.1", "66.7.0"), 5);
    assert.equal(minorsSkipped("2.2.15", "2.2.16"), 0);
    assert.equal(minorsSkipped("v0.4.14", "v0.5.0"), 1);
  });

  it("refuses to guess across a major boundary or a version it cannot read", () => {
    assert.equal(minorsSkipped("1.9.0", "2.0.0"), null);
    assert.equal(minorsSkipped("latest", "1.0.0"), null);
  });
});

describe("reading a body", () => {
  it("finds rows in a three-column Helm table", () => {
    const updates = updatesIn(HELM_BODY);
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0], {
      package: "reloader",
      kind: "patch",
      from: "2.2.15",
      to: "2.2.16",
    });
  });

  it("finds rows in a four-column action table, where the kind moves", () => {
    const updates = updatesIn(ACTION_BODY);
    assert.equal(updates.length, 2);
    assert.equal(updates[0]!.kind, "minor");
    assert.equal(updates[1]!.kind, "major");
  });

  it("ignores headers, separators and prose", () => {
    assert.deepEqual(updatesIn("nothing here\n\n| not | a | table |"), []);
    assert.deepEqual(updatesIn(null), []);
  });
});

describe("what gets flagged", () => {
  it("flags a major, because it is a breaking change by definition", () => {
    assert.equal(concerns({ package: "x", kind: "major", from: "1.0.0", to: "2.0.0" }), "major");
  });

  it("flags a minor that skips more than one, which the Update column hides", () => {
    const [, big] = updatesIn(HELM_BODY);
    assert.equal(concerns(big!), "skips 5 minors");
  });

  it("leaves a patch and a single minor alone", () => {
    const [patch] = updatesIn(HELM_BODY);
    assert.equal(concerns(patch!), null);
    const [oneMinor] = updatesIn(ACTION_BODY);
    assert.equal(concerns(oneMinor!), null);
  });
});

describe("the digest", () => {
  const now = new Date("2026-08-13T07:00:00Z");
  const pulls: PullRequest[] = [
    {
      number: 1,
      title: "Update reloader",
      url: "https://example.test/1",
      branch: "renovate/reloader",
      createdAt: "2026-08-11T07:00:00Z",
      body: HELM_BODY,
    },
    {
      number: 2,
      title: "Not renovate's",
      url: "https://example.test/2",
      branch: "feat/something",
      createdAt: "2026-08-01T07:00:00Z",
      body: HELM_BODY,
    },
    {
      number: 3,
      title: "Update actions",
      url: "https://example.test/3",
      branch: "renovate/actions",
      createdAt: "2026-08-06T07:00:00Z",
      body: "no table at all",
    },
  ];

  it("takes Renovate's pull requests by branch, not by author", () => {
    // They are authored by a person here, because Renovate runs with a
    // personal token; filtering by author finds nothing.
    const rows = collect(pulls, now);
    assert.deepEqual(rows.map((row) => row.number), [1, 3]);
  });

  it("puts the ones worth reading first", () => {
    const rows = collect(pulls, now);
    assert.equal(rows[0]!.number, 1);
    assert.equal(rows[0]!.flagged.length, 1);
  });

  it("counts age in whole days", () => {
    assert.equal(collect(pulls, now)[0]!.age, 2);
  });

  it("says so plainly when there is nothing open", () => {
    assert.match(render([]), /No open Renovate PRs/);
  });

  it("escapes what it puts in the room", () => {
    const nasty = collect(
      [{ ...pulls[0]!, title: "<script>alert(1)</script> & co" }],
      now,
    );
    const html = render(nasty);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&amp; co/);
  });
});
