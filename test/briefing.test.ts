/**
 * Filing a briefing from a cluster that has no room of its own.
 *
 * Two things worth pinning. The label, because without it a staging failure
 * reads as a production one. And the coercion at the bridge, because that
 * payload arrives from another cluster and is input, not a value this process
 * built — a malformed one should produce a shorter briefing, never a crash and
 * never `[object Object]` in a room.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asBriefing, listen } from "../src/beats/alerts.js";
import { renderBriefing, type Briefing } from "../src/copy/cluster/briefing.js";

const briefing = (over: Partial<Briefing> = {}): Briefing => ({
  problems: ["Pod app/api: CrashLoopBackOff"],
  overnight: [],
  skipped: [],
  windowHours: 24,
  ...over,
});

test("names the cluster when one is given", () => {
  const html = renderBriefing(briefing({ cluster: "staging" }))!;
  assert.match(html, /<div><strong>\[staging\]<\/strong><\/div>/);
  // Once, at the top — not on every heading.
  assert.equal(html.match(/staging/g)?.length, 1);
});

test("says nothing about the cluster when it owns the room", () => {
  assert.doesNotMatch(renderBriefing(briefing())!, /\[/);
});

test("a cluster name is escaped like any other text", () => {
  const html = renderBriefing(briefing({ cluster: "<script>" }))!;
  assert.match(html, /\[&lt;script&gt;\]/);
  assert.doesNotMatch(html, /<script>/);
});

test("silence survives the round trip", () => {
  const empty = { problems: [], overnight: [], skipped: [], windowHours: 24 };
  assert.equal(renderBriefing(asBriefing(empty)), null);
});

test("a briefing posted by another cluster renders the same as a local one", () => {
  const state = briefing({ cluster: "staging", overnight: ["KubeJobFailed"], windowHours: 12 });
  assert.equal(renderBriefing(asBriefing(JSON.parse(JSON.stringify(state)))), renderBriefing(state));
});

test("missing arrays become empty ones rather than throwing", () => {
  const coerced = asBriefing({ problems: ["one"] });
  assert.deepEqual(coerced.overnight, []);
  assert.deepEqual(coerced.skipped, []);
  assert.equal(coerced.windowHours, 24);
});

test("non-string items are dropped, not rendered", () => {
  const coerced = asBriefing({ problems: ["real", { toString: () => "sneaky" }, 42, null] });
  assert.deepEqual(coerced.problems, ["real"]);
});

test("a payload of the wrong shape entirely is an empty briefing", () => {
  for (const junk of [null, undefined, "a string", 7, []]) {
    const coerced = asBriefing(junk);
    assert.deepEqual(coerced.problems, [], String(junk));
    assert.equal(renderBriefing(coerced), null, String(junk));
  }
});

test("a non-numeric window falls back rather than rendering NaN", () => {
  const html = renderBriefing(asBriefing({ overnight: ["x"], windowHours: "soon" }))!;
  assert.match(html, /last 24h/);
  assert.doesNotMatch(html, /NaN/);
});

test("an empty cluster name is the same as none", () => {
  assert.equal(asBriefing({ problems: ["x"], cluster: "   " }).cluster, undefined);
});

/**
 * The briefing path is optional in a way the other two are not.
 *
 * Alertmanager and Flux retry a 404 in silence, so an unconfigured room for
 * them is invisible unless /healthz says so. A briefing is filed by a Job,
 * which fails visibly in the cluster that sent it — so requiring that room
 * here would only mean every bridge without a second cluster reports itself
 * broken forever, which is how alerting stops.
 */

const REQUIRED_ONLY = {
  LISTEN_PORT: "0",
  CAMPFIRE_URL: "https://camp.test/1",
  CAMPFIRE_FLUX_URL: "https://camp.test/2",
};

test("a bridge with no briefing room is still healthy", async () => {
  const bridge = await listen(REQUIRED_ONLY);
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/healthz`);
    assert.equal(response.status, 200);
  } finally {
    await bridge.close();
  }
});

test("but it refuses a briefing rather than dropping one", async () => {
  const bridge = await listen(REQUIRED_ONLY);
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/briefing`, {
      method: "POST",
      body: JSON.stringify({ problems: ["x"], overnight: [], skipped: [], windowHours: 24 }),
    });
    assert.equal(response.status, 404);
  } finally {
    await bridge.close();
  }
});

test("a missing alert room still reports unhealthy", async () => {
  const bridge = await listen({ LISTEN_PORT: "0", CAMPFIRE_URL: "https://camp.test/1" });
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/healthz`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /\/flux/);
  } finally {
    await bridge.close();
  }
});
