/**
 * The month, counted — and the two things about Gatus's store that shape it.
 *
 * Hourly rows are merged into daily buckets after 48 hours and deleted past
 * thirty days, so the totals survive and the timing does not. These tests pin
 * the consequences: percentages come from the totals, outages come from the
 * events, and neither pretends to know what the other knows.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { outagesFrom, shape } from "../src/beats/uptime.js";
import { findings } from "../src/copy/uptime/findings.js";
import {
  bandOf,
  cleanDays,
  datesIn,
  longest,
  minutesOf,
  overall,
  sharedOutages,
  spell,
  uptimeOf,
  type Endpoint,
} from "../src/copy/uptime/month.js";
import { monthSheet } from "../src/press/uptime/sheets.js";

const ZONE = "Europe/Amsterdam";

function endpoint(name: string, days: [string, number, number][]): Endpoint {
  return {
    name,
    group: "homelab",
    days: days.map(([date, total, successful]) => ({ date, total, successful })),
    responseMs: 40,
  };
}

describe("a day's band", () => {
  it("is perfect only when every check answered", () => {
    assert.equal(bandOf({ date: "2026-08-01", total: 1440, successful: 1440 }), "perfect");
    // One failed check in a day is 99.93%, and it is not perfect. The whole
    // sheet depends on this: a green that covered it would hide every day
    // worth looking at.
    assert.equal(bandOf({ date: "2026-08-01", total: 1440, successful: 1439 }), "nearly");
  });

  it("separates a wobble from a real outage", () => {
    assert.equal(bandOf({ date: "2026-08-01", total: 1000, successful: 980 }), "patchy");
    assert.equal(bandOf({ date: "2026-08-01", total: 1000, successful: 800 }), "bad");
  });

  it("draws a day it did not watch as absence, not as failure", () => {
    assert.equal(bandOf(undefined), "missing");
    assert.equal(bandOf({ date: "2026-08-01", total: 0, successful: 0 }), "missing");
  });
});

describe("counting the month", () => {
  const endpoints = [
    endpoint("immich", [
      ["2026-08-01", 100, 100],
      ["2026-08-02", 100, 90],
    ]),
    endpoint("ntfy", [
      ["2026-08-01", 100, 100],
      ["2026-08-02", 100, 100],
    ]),
  ];

  it("weights by checks rather than by endpoint", () => {
    assert.equal(uptimeOf(endpoints[0]!), 0.95);
    assert.equal(overall(endpoints), 390 / 400);
  });

  it("counts a day clean only when nothing failed anywhere", () => {
    assert.equal(cleanDays(endpoints), 1);
  });

  it("does not let an endpoint spoil days before it existed", () => {
    const added = [
      ...endpoints.slice(1),
      endpoint("fizzy", [["2026-08-02", 100, 100]]),
    ];
    // 1 August is clean even though fizzy has no row for it.
    assert.equal(cleanDays(added), 2);
    assert.deepEqual(datesIn(added), ["2026-08-01", "2026-08-02"]);
  });
});

describe("outages from transitions", () => {
  it("pairs each failure with the recovery that follows it", () => {
    const outages = outagesFrom([
      { name: "immich", type: "START", at: "2026-08-01T00:00:00Z" },
      { name: "immich", type: "UNHEALTHY", at: "2026-08-01T10:00:00Z" },
      { name: "immich", type: "HEALTHY", at: "2026-08-01T10:30:00Z" },
    ]);
    assert.equal(outages.length, 1);
    assert.equal(minutesOf(outages[0]!), 30);
  });

  it("keeps the first failure when a service reports itself down twice", () => {
    const outages = outagesFrom([
      { name: "immich", type: "UNHEALTHY", at: "2026-08-01T10:00:00Z" },
      { name: "immich", type: "UNHEALTHY", at: "2026-08-01T10:05:00Z" },
      { name: "immich", type: "HEALTHY", at: "2026-08-01T11:00:00Z" },
    ]);
    assert.equal(outages.length, 1);
    assert.equal(minutesOf(outages[0]!), 60);
  });

  it("leaves an unrecovered outage open rather than closing it at the edge", () => {
    const outages = outagesFrom([
      { name: "immich", type: "UNHEALTHY", at: "2026-08-01T10:00:00Z" },
    ]);
    assert.equal(outages[0]!.to, null);
    // Still open means "so far", which would win every longest comparison and
    // mean something different each time it was measured.
    assert.equal(longest(outages), null);
  });
});

describe("outages that were really one outage", () => {
  it("groups failures that land within minutes of each other", () => {
    const at = Date.UTC(2026, 7, 11, 6, 0);
    const shared = sharedOutages([
      { endpoint: "immich", from: at, to: at + 600_000 },
      { endpoint: "ntfy", from: at + 60_000, to: at + 600_000 },
      { endpoint: "mealie", from: at + 120_000, to: at + 600_000 },
    ]);
    assert.equal(shared.length, 1);
    assert.equal(shared[0]!.endpoints.length, 3);
  });

  it("does not call two neighbours a shared outage", () => {
    const at = Date.UTC(2026, 7, 11, 6, 0);
    assert.deepEqual(
      sharedOutages([
        { endpoint: "immich", from: at, to: at + 600_000 },
        { endpoint: "postgres", from: at + 60_000, to: at + 600_000 },
      ]),
      [],
    );
  });

  it("keeps unrelated failures apart", () => {
    const at = Date.UTC(2026, 7, 11, 6, 0);
    const day = 86_400_000;
    assert.deepEqual(
      sharedOutages([
        { endpoint: "immich", from: at, to: at + 600_000 },
        { endpoint: "ntfy", from: at + day, to: at + day + 600_000 },
        { endpoint: "mealie", from: at + 2 * day, to: at + 2 * day + 600_000 },
      ]),
      [],
    );
  });
});

describe("spelling a length of time", () => {
  it("says minutes, hours or days as a person would", () => {
    assert.equal(spell(30), "30m");
    assert.equal(spell(89), "89m");
    assert.equal(spell(120), "2h");
    assert.equal(spell(3450), "2d 10h");
    assert.equal(spell(2880), "2d");
  });
});

describe("what the month says", () => {
  it("leads with the worst service and the gap to the rest", () => {
    const [lead] = findings(
      [
        endpoint("grafana", [["2026-08-01", 100, 79]]),
        endpoint("immich", [["2026-08-01", 100, 98]]),
      ],
      [],
      ZONE,
    );
    assert.equal(lead![0], "grafana");
    assert.match(lead![1], /79\.0% of its checks/);
    assert.match(lead![1], /19\.0 points below immich/);
  });

  it("reports a perfect month as a count of days, not a percentage", () => {
    const [lead] = findings(
      [
        endpoint("immich", [
          ["2026-08-01", 100, 100],
          ["2026-08-02", 100, 100],
        ]),
      ],
      [],
      ZONE,
    );
    // "100.0%" and "99.97%" look identical at a glance and are not.
    assert.equal(lead![0], "all up");
    assert.match(lead![1], /every check answered, 2 days running/);
  });

  it("says when several services went down together", () => {
    const at = Date.UTC(2026, 7, 11, 6, 0);
    const found = findings(
      [endpoint("immich", [["2026-08-11", 100, 90]])],
      [
        { endpoint: "immich", from: at, to: at + 600_000 },
        { endpoint: "ntfy", from: at + 60_000, to: at + 600_000 },
        { endpoint: "mealie", from: at + 120_000, to: at + 600_000 },
      ],
      ZONE,
    );
    const together = found.find(([key]) => key === "together");
    assert.ok(together, "expected a shared-outage finding");
    assert.match(together![1], /3 services went down within minutes/);
    assert.match(together![1], /11 August/);
  });

  it("says nothing about sharing when nothing was shared", () => {
    const found = findings([endpoint("immich", [["2026-08-01", 100, 90]])], [], ZONE);
    assert.equal(found.find(([key]) => key === "together"), undefined);
  });
});

describe("the sheet", () => {
  const endpoints = [
    endpoint("grafana", [
      ["2026-08-01", 100, 79],
      ["2026-08-02", 100, 100],
    ]),
    endpoint("immich", [
      ["2026-08-01", 100, 100],
      ["2026-08-02", 100, 100],
    ]),
  ];

  it("draws a mark for every endpoint on every date", () => {
    const svg = monthSheet(endpoints, [], ZONE);
    // Not the `missing` band: it shares its hex with RULE, which the finding
    // block also draws, so counting it counts hairlines as marks.
    const marks = [...svg.matchAll(/<rect[^>]*fill="#(2e7d4f|d1622a|e8a33d|7f9a5c)"/g)];
    assert.equal(marks.length, 4, "two endpoints over two dates");
  });

  it("names both ends of the window, whatever the headline did", () => {
    const svg = monthSheet(endpoints, [], ZONE);
    assert.match(svg, />1 aug</);
    assert.match(svg, />2 aug</);
  });

  it("keeps the second finding on the sheet rather than dropping it", () => {
    const at = Date.UTC(2026, 7, 1, 6, 0);
    const svg = monthSheet(
      endpoints,
      [
        { endpoint: "grafana", from: at, to: at + 600_000 },
        { endpoint: "immich", from: at + 60_000, to: at + 600_000 },
        { endpoint: "ntfy", from: at + 120_000, to: at + 600_000 },
      ],
      ZONE,
    );
    // The bug this pins: a three-line headline used to push the finding into
    // the foot, where the overrun rule silently dropped it.
    assert.match(svg, />together</);
  });

  it("says how many days it actually found, never how many it asked for", () => {
    assert.match(monthSheet(endpoints, [], ZONE), /uptime, 2 days/);
  });
});

describe("shaping the rows", () => {
  it("gathers each endpoint's days and averages its response time by checks", () => {
    const [endpoint] = shape([
      { name: "immich", grp: "homelab", day: "2026-08-01", total: "100", successful: "100", response_total: "3000" },
      { name: "immich", grp: "homelab", day: "2026-08-02", total: "100", successful: "90", response_total: "5000" },
    ]);
    assert.equal(endpoint!.days.length, 2);
    assert.equal(endpoint!.responseMs, 40);
    assert.equal(uptimeOf(endpoint!), 0.95);
  });
});
