/**
 * The weekly speedtest sheet, and the arithmetic under it.
 *
 * Two things this pins beyond "it draws". The bands are about shortfall
 * against what the line was sold as, so a 940 Mbps test on a gigabit plan is a
 * good week and not a 6% failure. And the sheet is a record rather than an
 * alarm: a week where nothing went wrong still gets a headline worth reading,
 * because a sheet that only says something when it is bad is one nobody opens
 * on the other fifty Sundays.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findings } from "../src/copy/speedtest/findings.js";
import {
  GIGABIT,
  bandOf,
  bandsOf,
  median,
  missed,
  type Day,
  type Test,
} from "../src/copy/speedtest/week.js";
import { splitIntoDays } from "../src/beats/speedtest.js";
import { renderWeek } from "../src/press/speedtest/index.js";
import { weekSheet } from "../src/press/speedtest/sheets.js";
import { LAYOUT } from "../src/press/speedtest/layout.js";
import { width, wrap } from "../src/press/svg.js";
import { HEIGHT, MARGIN, WIDTH } from "../src/press/tokens.js";
import { localDay } from "../src/time.js";

const MB = 1_000_000;

function test(at: number, down = 940, up = 780, ping = 7): Test {
  return { at, down: down * MB, up: up * MB, ping };
}

/** A week of `perDay` tests a day, all at the same speed unless told otherwise. */
function week(perDay = 24, down = 940): Day[] {
  const days: Day[] = [];
  for (let index = 0; index < 7; index += 1) {
    const base = 1_770_000_000 + index * 86_400;
    days.push({
      label: `day ${index}`,
      tests: Array.from({ length: perDay }, (_, hour) => test(base + hour * 3600, down)),
    });
  }
  return days;
}

function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(0), 0x89504e47, "not a PNG");
  return [view.getUint32(16), view.getUint32(20)];
}

describe("the bands are shortfall, not speed", () => {
  it("calls an ordinary gigabit result full", () => {
    // No line delivers its headline number over TCP to a public server. A
    // palette that painted 940 as a shortfall would cry wolf about physics.
    assert.equal(bandOf(940 * MB, GIGABIT.down), "full");
    assert.equal(bandOf(900 * MB, GIGABIT.down), "full");
  });

  it("steps down through most, half and poor", () => {
    assert.equal(bandOf(899 * MB, GIGABIT.down), "most");
    assert.equal(bandOf(699 * MB, GIGABIT.down), "half");
    assert.equal(bandOf(399 * MB, GIGABIT.down), "poor");
  });

  it("is relative to the plan, not to a gigabit", () => {
    const hundred = 100 * MB;
    assert.equal(bandOf(95 * MB, hundred), "full");
    assert.equal(bandOf(95 * MB, GIGABIT.down), "poor");
  });

  it("sorts a day's marks worst last, so a run can be counted", () => {
    const day: Day = {
      label: "mixed",
      tests: [test(1, 300), test(2, 940), test(3, 800), test(4, 940)],
    };
    assert.deepEqual(bandsOf(day, GIGABIT.down), ["full", "full", "most", "poor"]);
  });

  it("counts the hours with no test at all", () => {
    assert.equal(missed({ label: "x", tests: [test(1), test(2)] }), 22);
    assert.equal(missed({ label: "x", tests: week(24)[0]!.tests }), 0);
  });
});

describe("the sentences", () => {
  it("leads with the speed, then what share of the plan that is", () => {
    // "93% of the gigabit arrived" leads with a ratio and reads like a
    // translation. The speed is the thing; the share is context for it.
    const [[key, sentence]] = findings(week(), GIGABIT) as [[string, string]];
    assert.equal(key, "940 Mbps");
    assert.match(sentence, /down on a typical test, 94% of the gigabit/);
  });

  it("says so plainly when every test held", () => {
    const said = findings(week(), GIGABIT).map(([, sentence]) => sentence).join(" ");
    assert.match(said, /within 10% of the line, all week/);
  });

  it("names the slowest test when there was one", () => {
    const days = week();
    days[3] = { ...days[3]!, tests: [...days[3]!.tests.slice(1), test(999, 210)] };
    const said = findings(days, GIGABIT);
    assert.match(said[1]![0], /^1 test$/);
    assert.match(said[1]![1], /slowest at 210 Mbps/);
  });

  it("reports upload against the direction the plan sells it in", () => {
    const said = findings(week(), GIGABIT).map(([key, sentence]) => `${key} ${sentence}`);
    assert.ok(said.some((line) => /780 Mbps up on a typical test, 78% of the gigabit/.test(line)));
  });

  it("counts the hours it could not count", () => {
    const said = findings(week(20), GIGABIT).map(([key, sentence]) => `${key} ${sentence}`);
    assert.ok(said.some((line) => /28 hours had no test at all/.test(line)));
    assert.ok(said.some((line) => /140 of a possible 168/.test(line)));
  });

  it("puts the furthest-from-as-sold finding first, because only two are drawn", () => {
    // Written in source order, "15 tests under 90%" sat above an upload at 61%
    // of a symmetric plan — the smaller fact above the week's story, on a sheet
    // that then dropped the second for want of a line.
    const days = week().map((day) => ({
      ...day,
      tests: day.tests.map((t) => ({ ...t, up: 610 * MB })),
    }));
    days[3] = { ...days[3]!, tests: [...days[3]!.tests.slice(1), test(999, 880, 610)] };
    const [, second] = findings(days, GIGABIT);
    assert.match(second![1], /up on a typical test/);
  });

  it("keeps the ping last, however stable it is", () => {
    const said = findings(week(), GIGABIT);
    assert.match(said[said.length - 1]![1], /typical ping/);
  });

  it("says nothing was recorded rather than dividing by zero", () => {
    const empty = week().map((day) => ({ ...day, tests: [] }));
    const [[key, sentence]] = findings(empty, GIGABIT) as [[string, string]];
    assert.equal(key, "no tests");
    assert.match(sentence, /nothing was recorded/);
  });
});

describe("the sheet", () => {
  it("comes out at the size Campfire shows it", () => {
    assert.deepEqual(pngSize(renderWeek(week(), GIGABIT)), [WIDTH, HEIGHT]);
  });

  it("draws a week with gaps and a bad night without falling over", () => {
    const days = week(18);
    days[2] = { ...days[2]!, tests: days[2]!.tests.map((t) => ({ ...t, down: 120 * MB })) };
    assert.deepEqual(pngSize(renderWeek(days, GIGABIT)), [WIDTH, HEIGHT]);
  });

  it("draws a sheet for a week with no tests at all", () => {
    const empty = week().map((day) => ({ ...day, tests: [] }));
    assert.deepEqual(pngSize(renderWeek(empty, GIGABIT)), [WIDTH, HEIGHT]);
  });

  it("names both faces, so a substitution is visible in the markup", () => {
    const svg = weekSheet(week(), GIGABIT);
    assert.match(svg, /font-family="URW Gothic"/);
    assert.match(svg, /font-family="JetBrains Mono"/);
  });

  it("wraps the headline within the measure", () => {
    const measure = WIDTH - 2 * MARGIN;
    const [key, sentence] = findings(week(), GIGABIT)[0]!;
    for (const line of wrap("headline", `${key} ${sentence}`, measure)) {
      assert.ok(width("headline", line) <= measure, `"${line}" is too wide`);
    }
  });

  it("never lets the findings reach the figures", () => {
    // The collision the glucose sheet had to be corrected for twice. Same
    // layout skeleton, same failure available.
    for (const days of [week(), week(18), week(24, 300)]) {
      const svg = weekSheet(days, GIGABIT);
      const baselines = [...svg.matchAll(/<text x="\d+" y="([\d.]+)"[^>]*font-size="30"/g)]
        .map((match) => Number(match[1]))
        .filter((y) => y > LAYOUT.findings);
      for (const y of baselines) {
        assert.ok(y < LAYOUT.foot, `a finding sits at ${y}, the foot is ${LAYOUT.foot}`);
      }
    }
  });

  it("keeps every drawn x inside the canvas", () => {
    // A full day is 24 marks plus a figure, and the row is the widest thing on
    // the sheet: this is the assertion that catches a mark size that no longer
    // fits the measure.
    const svg = weekSheet(week(), GIGABIT);
    for (const match of svg.matchAll(/<rect x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"/g)) {
      const right = Number(match[1]) + Number(match[2]);
      assert.ok(right <= WIDTH, `a rect reaches ${right}, the canvas is ${WIDTH}`);
    }
    for (const match of svg.matchAll(/<text x="([\d.-]+)"/g)) {
      assert.ok(Number(match[1]) <= WIDTH - MARGIN, `text starts at ${match[1]}`);
    }
  });
});

describe("days are local days", () => {
  const zone = "Europe/Amsterdam";

  it("puts each test in the day it happened in", () => {
    const window = ["2026-03-02", "2026-03-03"].map((date) => localDay(date, zone));
    const first = window[0]!;
    const tests = [
      test(Math.floor(first.start / 1000) + 60),
      test(Math.floor(first.end / 1000) - 60),
      test(Math.floor(first.end / 1000) + 60),
    ];
    const days = splitIntoDays(tests, window);
    assert.equal(days[0]!.tests.length, 2);
    assert.equal(days[1]!.tests.length, 1);
  });

  it("holds 23 hours of tests on the morning the clocks go forward", () => {
    // The day is however long the zone says. Bucketing on 86,400 would put the
    // last hour of that Sunday into Monday, every spring, in one direction.
    const window = [localDay("2026-03-29", zone)];
    const start = Math.floor(window[0]!.start / 1000);
    const tests = Array.from({ length: 26 }, (_, hour) => test(start + hour * 3600));
    const days = splitIntoDays(tests, window);
    assert.equal(days[0]!.tests.length, 23);
  });
});

describe("median", () => {
  it("is the middle of an odd count and the mean of the middle two of an even one", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });

  it("is NaN rather than 0 for nothing, so an empty week cannot read as a slow one", () => {
    assert.ok(Number.isNaN(median([])));
  });
});
