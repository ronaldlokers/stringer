/**
 * What the data says about itself.
 *
 * These describe the reader's own readings and nothing else. They name what
 * happened and how often; they never say what to do about it. This is a review
 * of a day already over, posted into a chat room — advice about insulin or food
 * is not the job, and a digest that gives it is a medical device wearing a chat
 * message. The test suite enforces that as a rule, not a habit.
 *
 * Both lists are ordered by consequence rather than by order of computation, so
 * the sheet's headline is the most consequential *true* thing available.
 */

import {
  BANDS,
  TARGET,
  type Band,
  type Day,
  hourMeans,
  hoursByBand,
  timeInRange,
  valuesOf,
} from "./bands.js";
import { MMOL, clock, fixed, mean, percent, pstdev } from "./numbers.js";

/** A key, and the sentence that follows it. */
export type Finding = readonly [key: string, text: string];

/**
 * What a fortnight says about itself: a low, then a habitual bad hour, then a
 * week-on-week move, then the night, then a streak.
 */
export function findings(days: readonly Day[], bands: readonly Band[] = BANDS): Finding[] {
  const out: Finding[] = [];
  const labelled = days.map((day) => ({ label: day.label, values: valuesOf(day) }));

  const lows = labelled.filter((day) => Math.min(...day.values) < 70);
  if (lows.length) {
    out.push([
      "below 3.9",
      `on ${lows.length} of ${days.length} days, most recently ${lows[lows.length - 1]!.label}`,
    ]);
  }

  let worstHour = 0;
  let worstCount = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const count = days.filter(
      (day) => (hoursByBand(day.readings, bands)[hour] ?? "in range") !== "in range",
    ).length;
    // Strictly greater, so the earliest hour wins a tie.
    if (count > worstCount) {
      worstHour = hour;
      worstCount = count;
    }
  }
  if (worstCount >= Math.max(3, Math.floor(days.length / 3))) {
    out.push([
      `${String(worstHour).padStart(2, "0")}:00`,
      `out of range on ${worstCount} of ${days.length} days, more than any other hour`,
    ]);
  }

  if (days.length >= 8) {
    const half = Math.floor(days.length / 2);
    const recent = mean(labelled.slice(half).map((day) => timeInRange(day.values)));
    const earlier = mean(labelled.slice(0, half).map((day) => timeInRange(day.values)));
    const change = (recent - earlier) * 100;
    if (Math.abs(change) >= 3) {
      out.push([
        "this week",
        `${percent(recent)}% in range, ${change > 0 ? "up" : "down"} ` +
          `${fixed(Math.abs(change), 0)} points on the week before`,
      ]);
    }
  }

  const night = readingsWhere(days, (minute) => minute < 360);
  const daytime = readingsWhere(days, (minute) => minute >= 360);
  if (night.length && daytime.length) {
    out.push([
      "nights",
      `${percent(timeInRange(night))}% in range, against ` +
        `${percent(timeInRange(daytime))}% by day`,
    ]);
  }

  let streak = 0;
  for (let index = labelled.length - 1; index >= 0; index -= 1) {
    if (timeInRange(labelled[index]!.values) >= TARGET) streak += 1;
    else break;
  }
  if (streak >= 2) {
    out.push(["streak", `${streak} days running at or above the ${percent(TARGET)}% target`]);
  }

  // A fortnight with nothing notable in it still gets a sentence.
  if (out.length === 0) {
    const overall = timeInRange(labelled.flatMap((day) => day.values));
    out.push(["steady", `${percent(overall)}% in range across the fortnight`]);
  }
  return out;
}

/**
 * How yesterday departed from the days before it.
 *
 * A day that was simply ordinary says so. That is a real answer to "was
 * anything unusual", and the most common one — a sheet that manufactures a
 * finding every morning teaches the reader to ignore all of them.
 */
export function outliers(days: readonly Day[], bands: readonly Band[] = BANDS): Finding[] {
  const today = days[days.length - 1]!;
  const history = days.slice(0, -1);
  const values = valuesOf(today);
  const out: Finding[] = [];

  if (history.length < 3) {
    return [
      [
        "first days",
        `only ${days.length} days on record, so there is nothing to compare against yet`,
      ],
    ];
  }

  // A low is the one thing worth leading with whenever it happened.
  if (Math.min(...values) < 70) {
    const clear = history.filter((day) => Math.min(...valuesOf(day)) >= 70).length;
    let lowest = today.readings[0]!;
    for (const reading of today.readings) {
      if (reading[1] < 70 && reading[1] < lowest[1]) lowest = reading;
    }
    out.push([
      "below 3.9",
      `reached ${fixed(lowest[1] / MMOL, 1)} at ${clock(lowest[0])}, ` +
        `after ${clear} of the last ${history.length} days stayed clear`,
    ]);
  }

  // The hour that departed furthest from its own normal, which is the whole
  // point of holding history behind a single day.
  const todayHours = hourMeans(today.readings);
  const pastHours = history.map((day) => hourMeans(day.readings));
  let worst: { hour: number; gap: number; delta: number } | null = null;
  for (let hour = 0; hour < 24; hour += 1) {
    const mine = todayHours[hour];
    const theirs = pastHours
      .map((hours) => hours[hour])
      .filter((value): value is number => value !== null && value !== undefined);
    if (mine === null || mine === undefined || theirs.length < 3) continue;
    const spread = pstdev(theirs);
    // A flat hour makes every deviation look enormous.
    if (spread < 6) continue;
    const usual = mean(theirs);
    const gap = (mine - usual) / spread;
    if (worst === null || Math.abs(gap) > Math.abs(worst.gap)) {
      worst = { hour, gap, delta: mine - usual };
    }
  }
  if (worst && Math.abs(worst.gap) >= 1.5) {
    out.push([
      `${String(worst.hour).padStart(2, "0")}:00`,
      `ran ${fixed(Math.abs(worst.delta) / MMOL, 1)} mmol ` +
        `${worst.delta > 0 ? "above" : "below"} its usual, the day's biggest departure`,
    ]);
  }

  // Where the day placed among its neighbours. Ties are counted separately
  // from losses on purpose: a fortnight of identical days beats nothing, and
  // counting only strictly-worse days called a flat 100% "the lowest of the
  // last 14 days" — a true arithmetic and a false sentence.
  const mine = timeInRange(values);
  const others = history.map((day) => timeInRange(valuesOf(day)));
  const worse = others.filter((other) => other < mine).length;
  const better = others.filter((other) => other > mine).length;
  if (better === 0 && worse) {
    out.push([
      "best in weeks",
      `${percent(mine)}% in range, the best of the last ${days.length} days`,
    ]);
  } else if (worse === 0 && better) {
    out.push([
      "hardest lately",
      `${percent(mine)}% in range, the lowest of the last ${days.length} days`,
    ]);
  } else if (worse || better) {
    out.push([
      "in range",
      `${percent(mine)}%, better than ${worse} of the last ${history.length} days`,
    ]);
  } else {
    out.push(["in range", `${percent(mine)}%, the same as every day this fortnight`]);
  }

  const night = today.readings
    .filter(([minute]) => minute < 360)
    .map(([, value]) => value);
  const pastNight = readingsWhere(history, (minute) => minute < 360);
  if (night.length && pastNight.length) {
    const delta = mean(night) - mean(pastNight);
    if (Math.abs(delta) / MMOL >= 0.5) {
      out.push([
        "the night",
        `${fixed(Math.abs(delta) / MMOL, 1)} mmol ` +
          `${delta > 0 ? "higher" : "lower"} than your usual night`,
      ]);
    }
  }

  if (out.length === 1 && out[0]![0] === "in range") {
    out.unshift(["nothing unusual", "yesterday sat inside its normal spread all day"]);
  }
  return out;
}

function readingsWhere(
  days: readonly Day[],
  keep: (minute: number) => boolean,
): number[] {
  const out: number[] = [];
  for (const day of days) {
    for (const [minute, value] of day.readings) {
      if (keep(minute)) out.push(value);
    }
  }
  return out;
}
