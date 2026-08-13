/**
 * The zone database is present, and days are bounded by midnights.
 *
 * This is phase one's whole reason for existing. A container without tzdata
 * does not crash — `Intl` silently falls back to UTC, every day comes out 24
 * hours long, and the digest reports the wrong day with a completely plausible
 * face. The two DST cases below are the cheapest way to catch that, because
 * they are the only days whose length disagrees with the fallback.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hoursIn, localDay, yesterday } from "../src/time.js";

const ZONE = "Europe/Amsterdam";

describe("the zone database", () => {
  it("is loaded, and is not UTC", () => {
    const summer = new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE,
      timeZoneName: "short",
    }).format(new Date("2026-07-01T12:00:00Z"));
    assert.ok(
      summer.includes("GMT+2") || summer.includes("CEST"),
      `Amsterdam in July should be two hours ahead, got ${summer}`,
    );
  });

  it("knows Amsterdam changes offset across the year", () => {
    const january = localDay("2026-01-15", ZONE);
    const july = localDay("2026-07-15", ZONE);
    assert.notEqual(
      new Date(january.start).getUTCHours(),
      new Date(july.start).getUTCHours(),
      "midnight fell at the same UTC hour in winter and summer, so tzdata is missing",
    );
  });
});

describe("local days", () => {
  it("is 24 hours on an ordinary day", () => {
    assert.equal(hoursIn(localDay("2026-08-05", ZONE)), 24);
  });

  it("is 23 hours when the clocks go forward", () => {
    assert.equal(hoursIn(localDay("2026-03-29", ZONE)), 23);
  });

  it("is 25 hours when the clocks go back", () => {
    assert.equal(hoursIn(localDay("2026-10-25", ZONE)), 25);
  });

  it("starts where the day before ended", () => {
    for (const [first, second] of [
      ["2026-03-28", "2026-03-29"],
      ["2026-10-24", "2026-10-25"],
      ["2026-08-05", "2026-08-06"],
    ] as const) {
      assert.equal(
        localDay(first, ZONE).end,
        localDay(second, ZONE).start,
        `${first} and ${second} do not meet`,
      );
    }
  });

  it("refuses a malformed date rather than reporting another day", () => {
    assert.throws(() => localDay("not-a-date", ZONE), RangeError);
    assert.throws(() => localDay("2026-8-5", ZONE), RangeError);
  });
});

describe("yesterday", () => {
  it("is the day before, in the zone rather than in UTC", () => {
    // 00:30 Amsterdam on 6 August is still 5 August in UTC. Reporting
    // "yesterday" from the UTC date would name the wrong day for the half of
    // the night the zone is ahead.
    const justAfterMidnight = new Date("2026-08-05T22:30:00Z");
    assert.equal(yesterday(justAfterMidnight, ZONE).date, "2026-08-05");
  });

  it("crosses a month boundary", () => {
    assert.equal(yesterday(new Date("2026-08-01T09:00:00Z"), ZONE).date, "2026-07-31");
  });
});
