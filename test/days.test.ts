/**
 * Cutting readings into local days — the hazard the migration plan named.
 *
 * The Python gets wall-clock minutes by accident of a language rule: it ignores
 * the offset when both datetimes share a tzinfo. JavaScript has no such
 * shortcut, so subtracting instants here would shift every reading after a
 * changeover by an hour and push some off the sheet. These pin the behaviour
 * rather than the implementation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitIntoDays, wholeDay, type Entry } from "../src/copy/glucose/days.js";
import { localDay } from "../src/time.js";

const ZONE = "Europe/Amsterdam";

function sensor(day: { start: number; end: number }, everySeconds = 300): Entry[] {
  const out: Entry[] = [];
  for (let at = day.start; at < day.end; at += everySeconds * 1000) {
    out.push({ at, mgdl: 110 });
  }
  return out;
}

describe("a whole day", () => {
  it("holds 288 readings on an ordinary day", () => {
    const day = localDay("2026-08-05", ZONE);
    assert.equal(wholeDay(day.start, day.end), 288);
  });

  it("holds 276 when the clocks go forward and 300 when they go back", () => {
    assert.equal(wholeDay(...span("2026-03-29")), 276);
    assert.equal(wholeDay(...span("2026-10-25")), 300);
  });

  it("reports a perfect sensor as 100% on all three", () => {
    for (const date of ["2026-08-05", "2026-03-29", "2026-10-25"]) {
      const day = localDay(date, ZONE);
      const emitted = sensor(day).length;
      assert.equal(Math.round((emitted / wholeDay(day.start, day.end)) * 100), 100, date);
    }
  });
});

describe("minutes are wall clock", () => {
  it("keeps every reading inside the day, even the 25-hour one", () => {
    const day = localDay("2026-10-25", ZONE);
    const entries = sensor(day);
    assert.equal(entries.length, 300, "a 25-hour day emits 300 readings");

    const [split] = splitIntoDays(entries, [day], ZONE);
    const minutes = split!.readings.map(([minute]) => minute);
    assert.equal(minutes.length, 300, "no reading may be dropped");
    assert.ok(Math.max(...minutes) < 1440, "a minute past 1439 falls off the sheet");
    // The hour that happened twice lands in the same slot twice, which is the
    // honest answer: it did happen twice.
    assert.equal(minutes.length - new Set(minutes).size, 12);
  });

  it("keeps 08:00 meaning 08:00 on both sides of a changeover", () => {
    // Without this the findings stop comparing like with like.
    const before = localDay("2026-10-24", ZONE);
    const after = localDay("2026-10-25", ZONE);
    const entries = [...sensor(before), ...sensor(after)];
    const days = splitIntoDays(entries, [before, after], ZONE);
    for (const day of days) {
      const eight = day.readings.filter(([minute]) => minute >= 480 && minute < 540);
      assert.equal(eight.length, 12, `${day.label} should have twelve readings in the 08:00 hour`);
    }
  });
});

describe("days that are not there", () => {
  it("drops a day too sparse to describe rather than drawing it empty", () => {
    const day = localDay("2026-08-05", ZONE);
    const thin = sensor(day).slice(0, 40); // well under a third
    assert.deepEqual(splitIntoDays(thin, [day], ZONE), []);
  });

  it("keeps a day just over the bar", () => {
    const day = localDay("2026-08-05", ZONE);
    const enough = sensor(day).slice(0, 96);
    assert.equal(splitIntoDays(enough, [day], ZONE).length, 1);
  });

  it("labels rows the way the sheet reads them", () => {
    const day = localDay("2026-08-05", ZONE);
    assert.equal(splitIntoDays(sensor(day), [day], ZONE)[0]!.label, "5 Aug");
  });
});

function span(date: string): [number, number] {
  const day = localDay(date, ZONE);
  return [day.start, day.end];
}
