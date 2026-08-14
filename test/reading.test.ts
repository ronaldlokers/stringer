/**
 * The unread backlog, and the security watch.
 *
 * The first of these was nearly not built. Counting `feedentrystatuses` said
 * nothing was unread, because CommaFeed writes a status row only when an entry
 * is *acted on* — absence is unread. The reader knew he had not opened the app
 * for days, which is the only reason the query was questioned rather than the
 * habit. There were 1,475 items sitting there.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { arrived, daysWaiting, total, worst, type Backlog } from "../src/copy/reading/backlog.js";
import { renderBacklog } from "../src/copy/reading/digest.js";
import { notable, phrase, type Event } from "../src/copy/security/events.js";
import { renderSecurity } from "../src/copy/security/digest.js";

const NOW = Date.parse("2026-08-16T08:00:00Z");
const DAY = 86_400_000;

const backlog: Backlog = {
  feeds: [
    { title: "Tweakers", unread: 328, thisWeek: 145 },
    { title: "Engadget", unread: 303, thisWeek: 124 },
    { title: "The Verge", unread: 258, thisWeek: 112 },
    { title: "Bright", unread: 250, thisWeek: 114 },
    { title: "Cloudflare", unread: 38, thisWeek: 2 },
    { title: "Quiet feed", unread: 0, thisWeek: 0 },
  ],
  oldest: NOW - 15 * DAY,
};

describe("the backlog", () => {
  it("adds up what is unread and what arrived this week", () => {
    assert.equal(total(backlog), 1177);
    assert.equal(arrived(backlog), 497);
  });

  it("names the feeds doing the burying, and skips the empty ones", () => {
    assert.deepEqual(worst(backlog).map((feed) => feed.title), [
      "Tweakers",
      "Engadget",
      "The Verge",
      "Bright",
    ]);
  });

  it("counts how long the oldest has waited", () => {
    assert.equal(daysWaiting(backlog, NOW), 15);
    assert.equal(daysWaiting({ feeds: [], oldest: null }, NOW), null);
  });

  it("says nothing at all when the reader is caught up", () => {
    assert.equal(renderBacklog({ feeds: [], oldest: null }, NOW), null);
  });

  it("leads with the total and the week's arrivals", () => {
    const html = renderBacklog(backlog, NOW)!;
    assert.match(html, /📚 1177 unread · commafeed/);
    assert.match(html, /497 arrived this week/);
    assert.match(html, /Tweakers · 328 \(145 this week\)/);
    assert.match(html, /the oldest has waited 15 days/);
  });

  it("does not mention an oldest that is only days old", () => {
    assert.doesNotMatch(renderBacklog({ ...backlog, oldest: NOW - 2 * DAY }, NOW)!, /oldest has waited/);
  });
});

describe("the security watch", () => {
  const event = (action: string, who = "ronaldlokers"): Event => ({
    action,
    at: NOW,
    who,
    from: "10.0.1.110",
  });

  it("keeps the things worth an interruption", () => {
    const kept = notable([
      event("login"),
      event("login_failed"),
      event("authorize_application"),
      event("password_set"),
      event("email_sent"),
    ]);
    assert.deepEqual(kept.map((one) => one.action), ["login_failed", "password_set"]);
  });

  it("ignores a successful login on purpose", () => {
    // Logging in is what the system is for. A bot that announces every sign-in
    // is a bot you mute, after which it cannot tell you about the failures.
    assert.deepEqual(notable([event("login")]), []);
  });

  it("says nothing when nothing was notable", () => {
    assert.equal(renderSecurity([event("login"), event("email_sent")]), null);
  });

  it("puts each event in words a person reads", () => {
    const html = renderSecurity([event("login_failed"), event("user_write")])!;
    assert.match(html, /failed sign-in · ronaldlokers from 10\.0\.1\.110/);
    assert.match(html, /user edited/);
    assert.match(html, /🔐 2 things in authentik/);
  });

  it("says 'something' rather than '1 things'", () => {
    assert.match(renderSecurity([event("login_failed")])!, /🔐 something in authentik/);
  });

  it("has a phrase for every action it watches", () => {
    for (const action of ["login_failed", "password_set", "user_write", "model_deleted"]) {
      assert.notEqual(phrase(action), action, `${action} reads as its raw name`);
    }
  });
});
