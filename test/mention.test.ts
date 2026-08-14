/**
 * Waking someone, and only when it is warranted.
 *
 * A mention is not text — `Message#mentionees` is
 * `body.body.attachables.grep(User)`, so "@ronald" in a bot message reaches
 * nobody. It is an ActionText attachment carrying a signed global id that only
 * Campfire can mint, which is why the id is configuration rather than
 * something this program can derive.
 *
 * The rule these tests pin: problems notify, good news does not. A resolution
 * at 3am is still 3am.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mention, needsAttention } from "../src/copy/mention.js";
import { Reported, type Check } from "../src/copy/cluster/check.js";
import { deliverAlerts, deliverCheck } from "../src/beats/alerts.js";
import { Groups } from "../src/copy/alerts/groups.js";
import type { Posted, Round } from "../src/rounds.js";
import type { AlertPayload, Silencing } from "../src/copy/alerts/render.js";

const SGID = "eyJfcmFpbHMiOnsiZGF0YSI6ImdpZDovL2NhbXBmaXJlL1VzZXIvMSJ9fQ==--abc123";
const SILENCING: Silencing = { grafanaBase: "https://grafana.test", datasource: "Alertmanager" };

class Recording implements Round {
  readonly log: string[] = [];
  async say(html: string): Promise<Posted> {
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

function alert(status: "firing" | "resolved"): AlertPayload {
  return {
    status,
    groupKey: "g1",
    alerts: [
      {
        status,
        labels: { alertname: "PostgresDown", severity: "critical" },
        annotations: { description: "it is down" },
        fingerprint: "abc",
        startsAt: "2026-08-14T03:00:00Z",
      },
    ],
  } as unknown as AlertPayload;
}

describe("the attachment", () => {
  it("is an action-text attachment carrying the signed id", () => {
    assert.match(mention(SGID), /<action-text-attachment sgid="[^"]+"/);
  });

  it("is nothing at all when no id is configured", () => {
    // An unconfigured deployment still posts: the message is the point and the
    // notification is the courtesy.
    assert.equal(mention(undefined), "");
    assert.equal(mention("   "), "");
    assert.equal(needsAttention("<div>hello</div>", undefined), "<div>hello</div>");
  });

  it("escapes the id rather than trusting it into an attribute", () => {
    assert.doesNotMatch(mention('bad" onload="x'), /onload="x/);
  });

  it("puts the mention after the message, not before it", () => {
    // First it reads as an address. The message is about the cluster; the
    // mention is only the reason it arrived now.
    const html = needsAttention("<div>the news</div>", SGID);
    assert.ok(html.indexOf("the news") < html.indexOf("action-text-attachment"));
  });
});

describe("what wakes someone", () => {
  it("mentions on a firing alert", async () => {
    const round = new Recording();
    await deliverAlerts(round, new Groups(), alert("firing"), SILENCING, SGID);
    assert.match(round.log[0]!, /action-text-attachment/);
  });

  it("stays quiet on a resolution", async () => {
    const round = new Recording();
    const groups = new Groups();
    await deliverAlerts(round, groups, alert("firing"), SILENCING, SGID);
    await deliverAlerts(round, groups, alert("resolved"), SILENCING, SGID);
    assert.doesNotMatch(round.log[round.log.length - 1]!, /action-text-attachment/);
  });

  it("mentions on findings and not on the clear that follows", async () => {
    const round = new Recording();
    const reported = new Reported();
    const report: Check = { check: "netpol", findings: ["something is reachable"] };
    await deliverCheck(round, reported, report, SGID);
    assert.match(round.log[0]!, /action-text-attachment/);

    await deliverCheck(round, reported, { check: "netpol", findings: [] }, SGID);
    assert.doesNotMatch(round.log[1]!, /action-text-attachment/);
  });
});
