/**
 * Forecasting a disk.
 *
 * A forecast is a straight line through the past, wrong in the way all
 * forecasts are wrong. What these pin is that it is wrong *honestly*: it says
 * how much history it rests on, it refuses to invent a runway for something
 * that is not growing, and a compaction on Tuesday does not turn into a
 * permanent negative trend.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  USABLE,
  gigabytes,
  growing,
  perWeek,
  weeksLeft,
  windowDays,
  type Disk,
  type Volume,
} from "../src/copy/storage/forecast.js";
import { SOON_WEEKS, pressing, renderStorage } from "../src/copy/storage/digest.js";

const HOUR = 3600;
const GB = 1_000_000_000;

/** A series climbing by `perWeekGb` for `days`, sampled six-hourly. */
function climbing(days: number, perWeekGb: number, from = 100 * GB) {
  const step = 6 * HOUR;
  const points: [number, number][] = [];
  for (let at = 0; at <= days * 86_400; at += step) {
    points.push([at, from + (perWeekGb * GB * at) / 604_800]);
  }
  return points;
}

describe("the rate", () => {
  it("finds a straight climb", () => {
    assert.ok(Math.abs(gigabytes(perWeek(climbing(30, 1.4))) - 1.4) < 0.01);
  });

  it("is not fooled by a compaction", () => {
    // Last-minus-first would call this shrinking forever. A line through the
    // whole window sees a volume that grew and was tidied once.
    const points = climbing(30, 2);
    points[points.length - 1]![1] -= 20 * GB;
    assert.ok(perWeek(points) > 0, "a single drop should not invert the trend");
  });

  it("says nothing from two samples", () => {
    assert.equal(perWeek([[0, GB], [HOUR, 2 * GB]]), 0);
  });

  it("reports the window it fitted", () => {
    assert.equal(Math.round(windowDays(climbing(14, 1))), 14);
    assert.equal(windowDays([]), 0);
  });
});

describe("the runway", () => {
  const disk = (used: number, perWeekGb: number): Disk => ({
    node: "kube-srv-1",
    used: used * GB,
    capacity: 500 * GB,
    perWeek: perWeekGb * GB,
  });

  it("counts to the usable ceiling, not to the last byte", () => {
    // Longhorn needs room to rebuild a replica; a node at 100% cannot.
    const left = weeksLeft(disk(400, 5))!;
    assert.ok(Math.abs(left - (500 * USABLE - 400) / 5) < 0.01);
  });

  it("has no runway for something flat or shrinking", () => {
    assert.equal(weeksLeft(disk(400, 0)), null);
    assert.equal(weeksLeft(disk(400, -3)), null);
  });

  it("floors at zero rather than reporting a negative runway", () => {
    assert.equal(weeksLeft(disk(490, 2)), 0);
  });
});

describe("what gets named", () => {
  const volume = (name: string, perWeekGb: number): Volume => ({
    namespace: "database",
    name,
    bytes: 10 * GB,
    perWeek: perWeekGb * GB,
  });

  it("names the fastest growers and ignores the still ones", () => {
    const named = growing([volume("a", 2), volume("b", 0.01), volume("c", 5), volume("d", -1)]);
    assert.deepEqual(named.map((v) => v.name), ["c", "a"]);
  });

  it("shows at most three", () => {
    const many = Array.from({ length: 9 }, (_, i) => volume(`v${i}`, i + 1));
    assert.equal(growing(many).length, 3);
  });
});

describe("the message", () => {
  const report = (perWeekGb: number) => ({
    disks: [{ node: "kube-srv-1", used: 400 * GB, capacity: 500 * GB, perWeek: perWeekGb * GB }],
    volumes: [{ namespace: "immich", name: "immich-data", bytes: 40 * GB, perWeek: 1.4 * GB }],
    days: 90,
  });

  it("says the figures and how much history they rest on", () => {
    const html = renderStorage(report(1));
    assert.match(html, /kube-srv-1 · 400 of 500 GB \(80%\)/);
    assert.match(html, /immich\/immich-data · 40\.0 GB · \+1\.4 GB a week/);
    assert.match(html, /from 3 months of history/);
  });

  it("counts a near-full disk as pressing, and a roomy one as not", () => {
    assert.equal(pressing(report(20)), true);
    assert.equal(pressing(report(0.1)), false);
  });

  it("says weeks when it is close and months when it is not", () => {
    assert.match(renderStorage(report(20)), /full in about \d+ weeks/);
    assert.match(renderStorage(report(0.5)), /months of room/);
  });

  it("does not pretend a young window is a long one", () => {
    assert.match(renderStorage({ ...report(1), days: 4 }), /from 4 days of history/);
  });

  it("says so plainly when nothing is growing", () => {
    assert.match(
      renderStorage({ ...report(0), volumes: [] }),
      /nothing is growing fast enough to name/,
    );
  });

  it("keeps the horizon it claims", () => {
    assert.equal(SOON_WEEKS, 12);
  });
});
