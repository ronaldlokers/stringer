/**
 * A day already over, filed the next morning.
 *
 * The beat's own judgement is where the risk is, and all of it is about
 * refusing to draw. A day the sensor mostly missed still has a mean, a range
 * and a shape, and every one of them describes when the sensor was on rather
 * than the day — so the floor, and what counts towards it, are pinned here
 * first. Treatments share the entries endpoint, so a day carried over the
 * floor by carb entries would be exactly that false picture.
 *
 * The transport is a real server rather than a stubbed `fetch`, because the
 * query is part of what is being tested: a window asked for wrongly comes back
 * as a plausible sheet of the wrong fortnight.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";

import { daysEnding, glucose, wantsFortnight } from "../src/beats/glucose.js";
import { READING_INTERVAL_MINUTES } from "../src/copy/glucose/days.js";
import { hoursIn, localDay } from "../src/time.js";
import type { Posted, Round } from "../src/rounds.js";

const ZONE = "Europe/Amsterdam";
/** A Friday, so the ordinary path is the day sheet. */
const DAY = "2026-08-14";

interface Raw {
  readonly type: string;
  readonly sgv?: number;
  readonly mgdl?: number;
  readonly date: number;
}

/** A room that keeps what it was handed. */
class Recording implements Round {
  readonly said: string[] = [];
  readonly shown: Uint8Array[] = [];
  async say(html: string): Promise<Posted> {
    this.said.push(html);
    return { id: String(this.said.length) };
  }
  async show(png: Uint8Array): Promise<Posted> {
    this.shown.push(png);
    return { id: String(this.shown.length) };
  }
  async amend(_id: string, html: string): Promise<Posted> {
    return this.say(html);
  }
}

/** `count` readings from local midnight, five minutes apart, all in range. */
function readings(date: string, count: number, type = "sgv"): Raw[] {
  const start = localDay(date, ZONE).start;
  return Array.from({ length: count }, (_, index) => ({
    type,
    sgv: 100 + (index % 40),
    date: start + index * READING_INTERVAL_MINUTES * 60_000,
  }));
}

/** A fortnight of full days ending on `last`, so the history is never the reason a sheet is withheld. */
function fortnight(last: string): Raw[] {
  return daysEnding(localDay(last, ZONE), ZONE, 14).flatMap((day) => readings(day.date, 288));
}

interface Fake {
  readonly base: string;
  readonly asked: URL[];
  /** The `api-secret` header of every request, in order. */
  readonly secrets: (string | undefined)[];
  entries: Raw[];
  status: number;
  treatments: unknown[] | null;
  close(): Promise<void>;
}

/** Nightscout, as far as the beat can tell. */
async function nightscout(): Promise<Fake> {
  const asked: URL[] = [];
  const secrets: (string | undefined)[] = [];
  const state = { entries: [] as Raw[], status: 200, treatments: null as unknown[] | null };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url!, "http://nightscout.test");
    asked.push(url);
    secrets.push(request.headers["api-secret"] as string | undefined);
    if (url.pathname === "/api/v1/treatments.json") {
      if (state.treatments === null) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state.treatments));
      return;
    }
    if (url.pathname === "/api/v1/entries.json" && state.status !== 200) {
      response.writeHead(state.status).end("nope");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(url.pathname === "/api/v1/entries.json" ? state.entries : {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    asked,
    secrets,
    get entries() {
      return state.entries;
    },
    set entries(value: Raw[]) {
      state.entries = value;
    },
    get status() {
      return state.status;
    },
    set status(value: number) {
      state.status = value;
    },
    get treatments() {
      return state.treatments;
    },
    set treatments(value: unknown[] | null) {
      state.treatments = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("filing the day", async () => {
  const site = await nightscout();
  after(() => site.close());

  const environment = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NIGHTSCOUT_URL: site.base,
    NIGHTSCOUT_API_SECRET_SHA1: "secret",
    DIGEST_TIMEZONE: ZONE,
    DIGEST_DATE: DAY,
    ...over,
  });

  it("shows the sheet and says nothing, on a day the sensor covered", async () => {
    site.entries = fortnight(DAY);
    site.treatments = [];
    const round = new Recording();
    await glucose(round, environment());
    assert.equal(round.said.length, 0, "a covered day should be the sheet alone");
    assert.equal(round.shown.length, 1);
    assert.deepEqual([...round.shown[0]!.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "not a PNG");
  });

  it("withholds the statistics when the sensor missed too much of the day", async () => {
    // 144 of ~288 is half a day: enough to draw something, not enough for it
    // to be about the day.
    site.entries = fortnight("2026-08-13").concat(readings(DAY, 144));
    const round = new Recording();
    await glucose(round, environment());
    assert.equal(round.shown.length, 0, "half a day was drawn anyway");
    assert.match(round.said[0]!, /50% sensor coverage \(144 of ~288 readings\)/);
  });

  it("counts only sensor values towards the floor, never treatments", async () => {
    // 144 readings and 144 carb entries. Counted together they clear 70%; the
    // day is still half unseen.
    site.entries = fortnight("2026-08-13")
      .concat(readings(DAY, 144))
      .concat(readings(DAY, 144, "mbg"));
    const round = new Recording();
    await glucose(round, environment());
    assert.equal(round.shown.length, 0, "treatments carried the day over the floor");
    assert.match(round.said[0]!, /50% sensor coverage/);
  });

  it("says the day was empty rather than reporting a day of nothing", async () => {
    site.entries = fortnight("2026-08-13");
    const round = new Recording();
    await glucose(round, environment());
    assert.equal(round.shown.length, 0);
    assert.match(round.said[0]!, /No readings/);
    assert.match(round.said[0]!, /Friday 14 August/);
  });

  it("takes the floor from MIN_UPTIME_PERCENT", async () => {
    site.entries = fortnight("2026-08-13").concat(readings(DAY, 144));
    const round = new Recording();
    await glucose(round, environment({ MIN_UPTIME_PERCENT: "40" }));
    assert.equal(round.shown.length, 1, "40% floor should have let half a day through");
  });

  it("asks for the fortnight that ends with the day, and for more than it holds", async () => {
    site.entries = fortnight(DAY);
    site.asked.length = 0;
    await glucose(new Recording(), environment());
    const query = site.asked.find((url) => url.pathname === "/api/v1/entries.json")!.searchParams;
    assert.equal(query.get("find[date][$gte]"), String(localDay("2026-08-01", ZONE).start));
    assert.equal(query.get("find[date][$lt]"), String(localDay(DAY, ZONE).end));
    // A capped query would read as a sensor that was off, not as a truncation.
    assert.equal(query.get("count"), "8000");
  });

  it("draws the sheet when Nightscout has never recorded a sensor start", async () => {
    site.entries = fortnight(DAY);
    site.treatments = null; // the endpoint 404s
    const round = new Recording();
    await glucose(round, environment());
    assert.equal(round.shown.length, 1, "a missing Sensor Start should not cost the sheet");
    assert.equal(round.said.length, 0);
  });

  it("says it could not read Nightscout rather than arriving with nothing", async () => {
    site.status = 500;
    const round = new Recording();
    try {
      await glucose(round, environment());
    } finally {
      site.status = 200;
    }
    assert.equal(round.shown.length, 0);
    assert.match(round.said[0]!, /could not read Nightscout/);
    assert.match(round.said[0]!, /nightscout returned 500/);
  });

  it("refuses to run without the secret, rather than asking unauthenticated", async () => {
    await assert.rejects(
      () => glucose(new Recording(), environment({ NIGHTSCOUT_API_SECRET_SHA1: "" })),
      /NIGHTSCOUT_API_SECRET_SHA1 is unset/,
    );
  });

  it("sends the secret as the header Nightscout reads", async () => {
    site.entries = fortnight(DAY);
    site.asked.length = 0;
    site.secrets.length = 0;
    await glucose(new Recording(), environment({ NIGHTSCOUT_API_SECRET_SHA1: "shibboleth" }));
    const at = site.asked.findIndex((url) => url.pathname === "/api/v1/entries.json");
    // Not the header's whitespace: Node trims that on the way in, so a secret
    // sent untrimmed is indistinguishable here from one sent trimmed.
    assert.equal(site.secrets[at], "shibboleth");
  });

  it("judges a 25-hour day by its own length, not by a nominal 288", async () => {
    // 25 October 2026 is 25 hours in Amsterdam, so a whole day is 300
    // readings. Measured against 288 the same sensor looks better than it was,
    // and the day nearest the floor is the one that decides whether a
    // half-covered day gets drawn.
    site.entries = fortnight("2026-10-24").concat(readings("2026-10-25", 200));
    const round = new Recording();
    await glucose(round, environment({ DIGEST_DATE: "2026-10-25" }));
    assert.equal(round.shown.length, 0);
    assert.match(round.said[0]!, /67% sensor coverage \(200 of ~300 readings\)/);
  });
});

describe("which sheet the morning gets", () => {
  it("gives Saturday the fortnight, so the long look back lands on Sunday", () => {
    assert.equal(wantsFortnight(localDay("2026-08-15", ZONE), {}), true);
  });

  it("gives every other day the day it can honestly answer for", () => {
    for (const date of ["2026-08-14", "2026-08-16", "2026-08-17"]) {
      assert.equal(wantsFortnight(localDay(date, ZONE), {}), false, date);
    }
  });

  it("still decides by the day being reported when the clocks moved that night", () => {
    // 25 October 2026 is a 25-hour Sunday; the half-day offset must not fall
    // back into Saturday.
    assert.equal(wantsFortnight(localDay("2026-10-25", ZONE), {}), false);
    assert.equal(wantsFortnight(localDay("2026-10-24", ZONE), {}), true);
  });

  it("obeys DIGEST_SHEET over the weekday", () => {
    assert.equal(wantsFortnight(localDay("2026-08-15", ZONE), { DIGEST_SHEET: "day" }), false);
    assert.equal(wantsFortnight(localDay("2026-08-14", ZONE), { DIGEST_SHEET: "FORTNIGHT" }), true);
  });

  it("ignores a DIGEST_SHEET that names no sheet", () => {
    assert.equal(wantsFortnight(localDay("2026-08-15", ZONE), { DIGEST_SHEET: "weekly" }), true);
  });
});

describe("the fortnight behind a day", () => {
  it("ends on the day being reported and runs back fourteen", () => {
    const window = daysEnding(localDay(DAY, ZONE), ZONE, 14);
    assert.equal(window.length, 14);
    assert.equal(window[0]!.date, "2026-08-01");
    assert.equal(window.at(-1)!.date, DAY);
  });

  it("keeps every date distinct across a changeover, and gives the long day its extra hour", () => {
    const window = daysEnding(localDay("2026-10-27", ZONE), ZONE, 14);
    assert.equal(new Set(window.map((day) => day.date)).size, 14);
    const long = window.find((day) => day.date === "2026-10-25")!;
    assert.equal(hoursIn(long), 25);
  });

  it("crosses a month end without repeating a day", () => {
    const window = daysEnding(localDay("2026-03-02", ZONE), ZONE, 14);
    assert.equal(window[0]!.date, "2026-02-17");
    assert.equal(new Set(window.map((day) => day.date)).size, 14);
  });
});
