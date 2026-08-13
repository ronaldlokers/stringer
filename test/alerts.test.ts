/**
 * The bridge, and the amend-or-post rule underneath it.
 *
 * The rule is about notification. Where a transport can amend quietly, an
 * amendment reaches nobody's phone — so anything new must be a new message,
 * and only resolutions may be folded into the one already there. Where a
 * transport cannot, every amendment becomes a post; the tests below assert
 * both paths, because the fallback is the whole reason this can be shared.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deliverAlerts, listen } from "../src/beats/alerts.js";
import { Groups, hasEscalated } from "../src/copy/alerts/groups.js";
import {
  firingFingerprints,
  render,
  renderAlert,
  renderFlux,
  silenceUrl,
  type AlertPayload,
  type Silencing,
} from "../src/copy/alerts/render.js";
import { messageIdFrom, type Posted, type Round } from "../src/rounds.js";

const SILENCING: Silencing = {
  grafanaBase: "https://grafana.test",
  datasource: "Alertmanager",
};

/** A round that can amend, like Campfire. */
class Amending implements Round {
  readonly log: string[] = [];
  private next = 100;
  async say(html: string): Promise<Posted> {
    this.log.push(`say:${html.slice(0, 20)}`);
    return { id: String(this.next++) };
  }
  async show(): Promise<Posted> {
    return { id: String(this.next++) };
  }
  async amend(id: string, html: string): Promise<Posted> {
    this.log.push(`amend:${id}:${html.slice(0, 20)}`);
    return { id };
  }
}

/** A round that cannot, like ntfy: every amendment is a fresh post. */
class PostOnly implements Round {
  readonly log: string[] = [];
  async say(html: string): Promise<Posted> {
    this.log.push(`say:${html.slice(0, 20)}`);
    return { id: null };
  }
  async show(): Promise<Posted> {
    return { id: null };
  }
  async amend(_id: string, html: string): Promise<Posted> {
    return this.say(html);
  }
}

function payload(status: string, alerts: [string, string][], groupKey = "g1"): AlertPayload {
  return {
    status,
    groupKey,
    alerts: alerts.map(([fingerprint, alertStatus]) => ({
      status: alertStatus,
      fingerprint,
      labels: { alertname: "TooHot", severity: "critical", namespace: "kitchen" },
      annotations: { summary: "it is too hot" },
    })),
  };
}

describe("the amend-or-post rule", () => {
  it("posts the first time it hears about a group", async () => {
    const round = new Amending();
    const groups = new Groups();
    const what = await deliverAlerts(round, groups, payload("firing", [["a", "firing"]]), SILENCING);
    assert.match(what, /^posted message 100$/);
  });

  it("amends when only a resolution has happened, so nothing pushes", async () => {
    const round = new Amending();
    const groups = new Groups();
    await deliverAlerts(round, groups, payload("firing", [["a", "firing"], ["b", "firing"]]), SILENCING);
    const what = await deliverAlerts(
      round,
      groups,
      payload("firing", [["a", "firing"], ["b", "resolved"]]),
      SILENCING,
    );
    assert.match(what, /^amended message 100$/);
    assert.deepEqual(round.log.map((line) => line.split(":")[0]), ["say", "amend"]);
  });

  it("posts again when the group gains an alert, so it does push", async () => {
    const round = new Amending();
    const groups = new Groups();
    await deliverAlerts(round, groups, payload("firing", [["a", "firing"]]), SILENCING);
    const what = await deliverAlerts(
      round,
      groups,
      payload("firing", [["a", "firing"], ["b", "firing"]]),
      SILENCING,
    );
    assert.match(what, /^posted message 101$/);
  });

  it("forgets a group once it is wholly resolved, so a re-fire pushes", async () => {
    const round = new Amending();
    const groups = new Groups();
    await deliverAlerts(round, groups, payload("firing", [["a", "firing"]]), SILENCING);
    await deliverAlerts(round, groups, payload("resolved", [["a", "resolved"]]), SILENCING);
    assert.equal(groups.size, 0);
    const what = await deliverAlerts(round, groups, payload("firing", [["a", "firing"]]), SILENCING);
    assert.match(what, /^posted message/);
  });

  it("says nothing about an empty payload rather than posting an empty message", async () => {
    const round = new Amending();
    const what = await deliverAlerts(round, new Groups(), { alerts: [] }, SILENCING);
    assert.equal(what, "nothing to say");
    assert.deepEqual(round.log, []);
  });
});

describe("a transport that cannot amend", () => {
  it("falls back to posting, and keeps working", async () => {
    const round = new PostOnly();
    const groups = new Groups();
    await deliverAlerts(round, groups, payload("firing", [["a", "firing"], ["b", "firing"]]), SILENCING);
    await deliverAlerts(round, groups, payload("firing", [["a", "firing"], ["b", "resolved"]]), SILENCING);
    // Two posts rather than a post and a silent amendment: the room becomes a
    // log and the resolution notifies. Honest degradation, not a failure.
    assert.deepEqual(round.log.map((line) => line.split(":")[0]), ["say", "say"]);
  });
});

describe("escalation", () => {
  it("is a fingerprint that was not firing before", () => {
    const known = { id: "1", firing: new Set(["a"]) };
    assert.equal(hasEscalated(known, new Set(["a"])), false);
    assert.equal(hasEscalated(known, new Set<string>()), false);
    assert.equal(hasEscalated(known, new Set(["a", "b"])), true);
  });

  it("ignores resolved alerts when reading what is firing", () => {
    const firing = firingFingerprints(payload("firing", [["a", "firing"], ["b", "resolved"]]));
    assert.deepEqual([...firing], ["a"]);
  });
});

describe("rendering", () => {
  it("puts a single alert in the room without a group heading", () => {
    const html = render(payload("firing", [["a", "firing"]]), SILENCING)!;
    assert.match(html, /🚨 TooHot/);
    assert.ok(!html.includes("alerts firing"));
  });

  it("heads a group with its count", () => {
    const html = render(payload("firing", [["a", "firing"], ["b", "firing"]]), SILENCING)!;
    assert.match(html, /2 alerts firing/);
  });

  it("offers a silence link only while firing", () => {
    const firing = renderAlert({ status: "firing", labels: { alertname: "X" } }, SILENCING);
    const done = renderAlert({ status: "resolved", labels: { alertname: "X" } }, SILENCING);
    assert.match(firing, /silence/);
    assert.ok(!done.includes("silence"));
  });

  it("fills the silence matchers Grafana expects", () => {
    const url = silenceUrl({ alertname: "TooHot", namespace: "kitchen", pod: "x" }, SILENCING);
    assert.match(url, /alertmanager=Alertmanager/);
    assert.match(url, /matcher=alertname%3DTooHot/);
    assert.match(url, /matcher=namespace%3Dkitchen/);
    // Narrower than namespace would be outlived by the next restart.
    assert.ok(!url.includes("pod"));
  });

  it("escapes what it puts in the room", () => {
    const html = renderAlert(
      { labels: { alertname: "<script>x</script>" }, annotations: { summary: "a & b" } },
      SILENCING,
    );
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&amp; b/);
  });

  it("leads a flux event with the cluster that sent it", () => {
    const html = renderFlux({
      involvedObject: { kind: "Kustomization", name: "apps", namespace: "flux-system" },
      severity: "error",
      reason: "BuildFailed",
      message: "something broke",
      metadata: { cluster: "production" },
    });
    assert.match(html, /^<strong>\[production\]<\/strong>/);
    assert.match(html, /🚨 Kustomization\/apps/);
    assert.match(html, /<pre>something broke<\/pre>/);
  });
});

describe("the message handle", () => {
  it("comes out of the Location header a create answers with", () => {
    assert.equal(messageIdFrom("https://camp.test/rooms/1/messages/4321"), "4321");
    assert.equal(messageIdFrom("/messages/7"), "7");
    assert.equal(messageIdFrom(null), null);
    assert.equal(messageIdFrom("nonsense"), null);
  });
});

describe("the server", () => {
  it("reports unhealthy while a destination is unconfigured", async () => {
    const bridge = await listen({ LISTEN_PORT: "0", CAMPFIRE_URL: "https://camp.test/1" });
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/healthz`);
      assert.equal(response.status, 503);
      assert.match(await response.text(), /\/flux/);
    } finally {
      await bridge.close();
    }
  });

  it("is healthy once both are", async () => {
    const bridge = await listen({
      LISTEN_PORT: "0",
      CAMPFIRE_URL: "https://camp.test/1",
      CAMPFIRE_FLUX_URL: "https://camp.test/2",
    });
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/healthz`);
      assert.equal(response.status, 200);
    } finally {
      await bridge.close();
    }
  });

  it("404s a path it has no destination for", async () => {
    const bridge = await listen({ LISTEN_PORT: "0", CAMPFIRE_URL: "https://camp.test/1" });
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/nope`, { method: "POST" });
      assert.equal(response.status, 404);
    } finally {
      await bridge.close();
    }
  });

  it("400s a body that is not JSON, rather than retrying forever", async () => {
    const bridge = await listen({ LISTEN_PORT: "0", CAMPFIRE_URL: "https://camp.test/1" });
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/alerts`, {
        method: "POST",
        body: "not json",
      });
      assert.equal(response.status, 400);
    } finally {
      await bridge.close();
    }
  });
});
