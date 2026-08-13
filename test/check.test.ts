/**
 * A scheduled check filing what it found.
 *
 * Two things worth pinning. The repeat rule, because netpol runs hourly and a
 * standing failure repeated 24 times a day is how a room learns to ignore a
 * bot. And the order of post-then-record, because a post that fails is retried
 * and a report recorded too early makes that retry silent — which loses the
 * finding through the machinery built to carry it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asCheck, deliverCheck, listen } from "../src/beats/alerts.js";
import { Reported, renderCheck, renderClear, type Check } from "../src/copy/cluster/check.js";
import { type Posted, type Round } from "../src/rounds.js";

const report = (over: Partial<Check> = {}): Check => ({
  check: "netpol",
  findings: ["database -> monitoring:9090 reachable, and should not be"],
  ...over,
});

/** A room that records what it was told, and can be made to fail once. */
class Recording implements Round {
  readonly log: string[] = [];
  failNext = false;
  async say(html: string): Promise<Posted> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("campfire said no");
    }
    this.log.push(html);
    return { id: String(this.log.length) };
  }
  async show(): Promise<Posted> {
    return { id: null };
  }
  async amend(_id: string, html: string): Promise<Posted> {
    return this.say(html);
  }
}

test("findings are counted in the heading and listed under it", () => {
  const html = renderCheck(report({ findings: ["one", "two"] }))!;
  assert.match(html, /<strong>⚠️ netpol — 2 findings<\/strong>/);
  assert.match(html, /<li>one<\/li><li>two<\/li>/);
});

test("one finding is a finding, not 1 findings", () => {
  assert.match(renderCheck(report())!, /<strong>⚠️ netpol — 1 finding<\/strong>/);
});

test("a check with nothing to say renders nothing", () => {
  assert.equal(renderCheck(report({ findings: [] })), null);
});

test("the cluster is named only when one is given", () => {
  assert.match(renderCheck(report({ cluster: "staging" }))!, /netpol \[staging\]/);
  assert.doesNotMatch(renderCheck(report())!, /\[/);
});

test("a check name and a cluster name are escaped like any other text", () => {
  const html = renderCheck(report({ check: "<script>", cluster: "<img>" }))!;
  assert.match(html, /&lt;script&gt; \[&lt;img&gt;\]/);
  assert.doesNotMatch(html, /<script>|<img>/);
});

test("clearing says so in one line, with no list", () => {
  const html = renderClear(report({ findings: [], cluster: "staging" }));
  assert.match(html, /<strong>✅ netpol \[staging\] — clear<\/strong>/);
  assert.doesNotMatch(html, /<ul>/);
});

test("the same findings again say nothing", () => {
  const reported = new Reported();
  assert.equal(reported.decide(report()), "post");
  reported.remember(report());
  assert.equal(reported.decide(report()), "silent");
});

test("findings in a different order are the same findings", () => {
  const reported = new Reported();
  reported.remember(report({ findings: ["a", "b"] }));
  assert.equal(reported.decide(report({ findings: ["b", "a"] })), "silent");
});

test("a changed finding is news again", () => {
  const reported = new Reported();
  reported.remember(report());
  assert.equal(reported.decide(report({ findings: ["something else"] })), "post");
});

test("clearing is said once, and only after something was said", () => {
  const reported = new Reported();
  const clean = report({ findings: [] });
  assert.equal(reported.decide(clean), "silent");
  reported.remember(report());
  assert.equal(reported.decide(clean), "clear");
  reported.forget(clean);
  assert.equal(reported.decide(clean), "silent");
});

test("a failure after a clear is news again", () => {
  const reported = new Reported();
  reported.remember(report());
  reported.forget(report());
  assert.equal(reported.decide(report()), "post");
});

test("two clusters running one check do not silence each other", () => {
  const reported = new Reported();
  reported.remember(report({ cluster: "staging" }));
  assert.equal(reported.decide(report({ cluster: "production" })), "post");
});

test("two checks in one cluster do not silence each other", () => {
  const reported = new Reported();
  reported.remember(report());
  assert.equal(reported.decide(report({ check: "recovery-source" })), "post");
});

test("a post that fails is not remembered, so the retry still says it", async () => {
  const round = new Recording();
  const reported = new Reported();
  round.failNext = true;
  await assert.rejects(() => deliverCheck(round, reported, report()));
  assert.deepEqual(round.log, []);
  assert.equal(await deliverCheck(round, reported, report()), "1 finding(s) posted");
  assert.equal(round.log.length, 1);
});

test("the hourly repeat of a standing failure reaches the room once", async () => {
  const round = new Recording();
  const reported = new Reported();
  for (let hour = 0; hour < 24; hour++) await deliverCheck(round, reported, report());
  assert.equal(round.log.length, 1);
  await deliverCheck(round, reported, report({ findings: [] }));
  assert.equal(round.log.length, 2);
  assert.match(round.log[1]!, /clear/);
});

test("a clean check that was always clean is never heard from", async () => {
  const round = new Recording();
  const reported = new Reported();
  for (let hour = 0; hour < 24; hour++) {
    await deliverCheck(round, reported, report({ findings: [] }));
  }
  assert.deepEqual(round.log, []);
});

test("non-string findings are dropped, not rendered", () => {
  const coerced = asCheck({ check: "netpol", findings: ["real", { toString: () => "sneaky" }, 7] });
  assert.deepEqual(coerced.findings, ["real"]);
});

test("a payload of the wrong shape entirely is a check with nothing to say", () => {
  for (const junk of [null, undefined, "a string", 7, []]) {
    const coerced = asCheck(junk);
    assert.deepEqual(coerced.findings, [], String(junk));
    assert.equal(renderCheck(coerced), null, String(junk));
  }
});

test("a nameless report is still a report", () => {
  assert.match(renderCheck(asCheck({ findings: ["x"] }))!, /<strong>⚠️ check — 1 finding/);
});

test("an empty cluster name is the same as none", () => {
  assert.equal(asCheck({ check: "netpol", findings: ["x"], cluster: "  " }).cluster, undefined);
});

/**
 * The check path is optional in the same way the briefing path is: the sender
 * is a Job that fails visibly in its own cluster, so a bridge without a room
 * for it is not a broken bridge.
 */

const REQUIRED_ONLY = {
  LISTEN_PORT: "0",
  CAMPFIRE_URL: "https://camp.test/1",
  CAMPFIRE_FLUX_URL: "https://camp.test/2",
};

test("a bridge with no check room is still healthy", async () => {
  const bridge = await listen(REQUIRED_ONLY);
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/healthz`);
    assert.equal(response.status, 200);
  } finally {
    await bridge.close();
  }
});

test("but it refuses findings rather than dropping them", async () => {
  const bridge = await listen(REQUIRED_ONLY);
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/check`, {
      method: "POST",
      body: JSON.stringify({ check: "netpol", findings: ["x"] }),
    });
    assert.equal(response.status, 404);
  } finally {
    await bridge.close();
  }
});

test("the briefing's room is where findings go when they have no room of their own", async () => {
  const bridge = await listen({ ...REQUIRED_ONLY, CAMPFIRE_BRIEFING_URL: "https://camp.test/3" });
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/check`, {
      method: "POST",
      body: "{",
    });
    // 400, not 404: the path is wired, the payload is what was wrong.
    assert.equal(response.status, 400);
  } finally {
    await bridge.close();
  }
});
