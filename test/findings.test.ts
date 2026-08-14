/**
 * The port is held to the Python it replaces, sentence for sentence.
 *
 * `test/golden/` holds four fortnights and what the previous implementation
 * said about each. Reproducing those strings exactly is the only evidence that
 * the statistics survived the move — and statistics about someone's health are
 * not the place to discover a rounding difference in production.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { Day, Reading } from "../src/copy/glucose/bands.js";
import { bandOf, hoursByBand, modalDay, timeInRange } from "../src/copy/glucose/bands.js";
import { findings, outliers } from "../src/copy/glucose/findings.js";
import { fixed } from "../src/numbers.js";

const NAMES = ["ordinary", "spike", "low", "flat"] as const;

function golden(name: string): { days: { label: string; readings: number[][] }[] } {
  const path = fileURLToPath(new URL(`./golden/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function expected(name: string): { findings: string[][]; outliers: string[][] } {
  const path = fileURLToPath(new URL(`./golden/${name}.findings.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function fixture(name: string): Day[] {
  return golden(name).days.map((day) => ({
    label: day.label,
    readings: day.readings.map(([minute, value]) => [minute, value] as Reading),
  }));
}

function flatDay(label: string, value: number, count = 288): Day {
  return {
    label,
    readings: Array.from({ length: count }, (_, step) => [step * 5, value] as Reading),
  };
}

describe("the golden fortnights", () => {
  for (const name of NAMES) {
    it(`says the same thing about ${name} as the implementation it replaces`, () => {
      const days = fixture(`fortnight-${name}`);
      const want = expected(`fortnight-${name}`);
      assert.deepEqual(
        findings(days).map((finding) => [...finding]),
        want.findings,
      );
      // "unbroken" is new, and deliberately so — the encouraging line the
      // Python never had. Parity is asserted for everything it did produce,
      // which is what these goldens are for; the new line has its own test
      // below rather than being quietly folded into the recorded output.
      assert.deepEqual(
        outliers(days)
          .filter(([key]) => key !== "unbroken")
          .map((finding) => [...finding]),
        want.outliers,
      );
    });
  }

  it("adds an encouraging line the Python never had", () => {
    // A fact rather than praise: the longest unbroken stretch in range and
    // when it began. "Well done" every morning is worth nothing by the second
    // week; the reader's own eleven hours is not.
    const found = outliers(fixture("fortnight-ordinary"));
    const line = found.find(([key]) => key === "unbroken");
    assert.ok(line, "no encouraging line: " + found.map(([k]) => k).join(", "));
    assert.match(line![1], /hours in range without a break, from \d\d:\d\d/);
  });

  it("leads with something different in each", () => {
    const leads = NAMES.map((name) => outliers(fixture(`fortnight-${name}`))[0]![0]);
    assert.equal(new Set(leads).size, NAMES.length, leads.join(", "));
  });
});

describe("rounding", () => {
  it("rounds halves to even, the way Python does", () => {
    // 36 of 288 readings is exactly 12.5%. `toFixed` would say 13.
    assert.equal(fixed(12.5, 0), "12");
    assert.equal(fixed(13.5, 0), "14");
    assert.equal(fixed(0.5, 0), "0");
  });

  it("leaves everything else to the ordinary rule", () => {
    assert.equal(fixed(12.4, 0), "12");
    assert.equal(fixed(12.6, 0), "13");
    assert.equal(fixed(6.849, 1), "6.8");
    assert.equal(fixed(6.851, 1), "6.9");
  });
});

describe("the arithmetic underneath", () => {
  it("counts the band edges as inside", () => {
    assert.equal(timeInRange([70, 180]), 1);
    assert.equal(timeInRange([69, 181]), 0);
    assert.equal(timeInRange([69, 100, 100, 181]), 0.5);
  });

  it("puts each band's edges in the right band", () => {
    for (const [value, name] of [
      [53, "very low"],
      [54, "low"],
      [70, "in range"],
      [180, "in range"],
      [251, "very high"],
    ] as const) {
      assert.equal(bandOf(value), name, `${value}`);
    }
  });

  it("takes the majority of each hour", () => {
    const readings: Reading[] = [];
    for (let minute = 0; minute < 1440; minute += 5) {
      readings.push([minute, minute < 40 ? 200 : 110]);
    }
    const hours = hoursByBand(readings);
    assert.equal(hours[0], "high");
    assert.equal(hours[1], "in range");
  });

  it("reports an hour with no readings as unknown, not as zero", () => {
    const readings: Reading[] = [];
    for (let minute = 0; minute < 1440; minute += 5) {
      if (minute < 180 || minute >= 240) readings.push([minute, 110]);
    }
    assert.equal(hoursByBand(readings)[3], null);
  });

  it("takes the median and the middle half", () => {
    const days = [100, 110, 120, 130, 140].map((value, index) =>
      flatDay(`day ${index}`, value),
    );
    const band = modalDay(days, 24);
    assert.ok(band.length > 0);
    for (const slot of band) {
      assert.deepEqual([slot.low, slot.median, slot.high], [110, 120, 130]);
    }
  });
});

describe("ranking a day against its neighbours", () => {
  it("does not call an identical fortnight the worst day", () => {
    const days = Array.from({ length: 14 }, (_, index) => flatDay(`day ${index}`, 110));
    const text = new Map(outliers(days));
    assert.ok(!text.has("hardest lately"));
    assert.match(text.get("in range")!, /the same as every day/);
  });

  it("names the best day", () => {
    const days = Array.from({ length: 13 }, (_, index) => flatDay(`day ${index}`, 200));
    days.push(flatDay("today", 110));
    assert.ok(new Map(outliers(days)).has("best in weeks"));
  });

  it("names the hardest day", () => {
    const days = Array.from({ length: 13 }, (_, index) => flatDay(`day ${index}`, 110));
    days.push(flatDay("today", 200));
    assert.ok(new Map(outliers(days)).has("hardest lately"));
  });

  it("says so rather than guessing when there is too little history", () => {
    const days = Array.from({ length: 3 }, (_, index) => flatDay(`day ${index}`, 110));
    assert.equal(outliers(days)[0]![0], "first days");
  });
});

describe("voice", () => {
  // Not a style rule. Advice from a chat bot is a medical device wearing a chat
  // message, and the line is easy to cross by accident when someone adds a
  // helpful-sounding finding later.
  const FORBIDDEN = [
    "you should", "try ", "consider ", "increase", "decrease", "reduce",
    "take ", "adjust", "correct ", "dose", "insulin", "carb", "eat ",
  ];

  it("never tells the reader what to do", () => {
    for (const name of NAMES) {
      const days = fixture(`fortnight-${name}`);
      for (const [key, text] of [...findings(days), ...outliers(days)]) {
        const sentence = `${key} ${text}`.toLowerCase();
        for (const phrase of FORBIDDEN) {
          assert.ok(!sentence.includes(phrase), `${name}: "${sentence}" contains "${phrase}"`);
        }
      }
    }
  });
});

describe("how old the sensor is", () => {
  // Coverage collapses on a predictable cycle. Saying "day 9" beforehand is the
  // same information at the only moment it is useful.
  const DAY = 86_400_000;
  const NOW = Date.parse("2026-08-14T08:00:00Z");

  function readings(fromDaysAgo: number, gapAt?: number): { at: number; mgdl: number }[] {
    const out: { at: number; mgdl: number }[] = [];
    for (let minute = fromDaysAgo * 1440; minute >= 0; minute -= 5) {
      const at = NOW - minute * 60_000;
      if (gapAt !== undefined && minute < gapAt * 1440 && minute > gapAt * 1440 - 120) continue;
      out.push({ at, mgdl: 110 });
    }
    return out;
  }

  it("believes Nightscout's own Sensor Start over the readings", async () => {
    // The site records one when the uploader writes it, and it is what the
    // SAGE pill reads. Inference is the fallback, not the answer.
    const { sessionFrom, sensorFinding } = await import("../src/copy/glucose/sensor.js");
    const started = NOW - 8 * DAY;
    const session = sessionFrom(readings(14), NOW, started);
    assert.equal(session?.recorded, true);
    assert.equal(session?.days, 8);
    assert.match(sensorFinding(session)![1], /day 8 of 10, due in 2 days/);
  });

  it("prefers a gap that happened after the recorded start", async () => {
    // A sensor changed and nobody wrote it down: the readings are then the more
    // recent truth, and believing the treatment would report a sensor two days
    // older than the one being worn.
    const { sessionFrom } = await import("../src/copy/glucose/sensor.js");
    const session = sessionFrom(readings(14, 4), NOW, NOW - 9 * DAY);
    assert.equal(session?.recorded, false);
    assert.equal(session?.days, 3);
  });

  it("counts from the last gap when nothing was recorded", async () => {
    const { sessionFrom, sensorFinding } = await import("../src/copy/glucose/sensor.js");
    const session = sessionFrom(readings(14, 9), NOW);
    assert.equal(session?.exact, true);
    assert.equal(session?.days, 8);
    assert.match(sensorFinding(session)![1], /day 8 of 10, due in 2 days — counted from a gap/);
  });

  it("says 'at least' when the readings hold no gap at all", async () => {
    const { sessionFrom, sensorFinding } = await import("../src/copy/glucose/sensor.js");
    const session = sessionFrom(readings(14), NOW);
    assert.equal(session?.exact, false);
    assert.match(sensorFinding(session)![1], /at least day 14 — no gap/);
  });

  it("stays quiet until the last three days", async () => {
    // "Day 2 of 10" is not news. A line that appears every morning is one
    // nobody reads on the morning it matters.
    const { sessionFrom, sensorFinding } = await import("../src/copy/glucose/sensor.js");
    assert.equal(sensorFinding(sessionFrom(readings(3), NOW, NOW - 2 * DAY)), null);
    assert.ok(sensorFinding(sessionFrom(readings(3), NOW, NOW - 7 * DAY)));
  });

  it("says a sensor past its ten days is due now", async () => {
    const { sessionFrom, sensorFinding } = await import("../src/copy/glucose/sensor.js");
    const session = sessionFrom(readings(3), NOW, NOW - 11 * DAY);
    assert.match(sensorFinding(session)![1], /day 11 of 10, due now, or already changed/);
  });

  it("ignores a gap short enough to be a shower", async () => {
    const { sessionFrom } = await import("../src/copy/glucose/sensor.js");
    const entries = readings(14).filter((_, index) => index % 200 !== 0);
    assert.equal(sessionFrom(entries, NOW)?.exact, false);
  });
});
