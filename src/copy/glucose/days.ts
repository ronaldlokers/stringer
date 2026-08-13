/**
 * Cutting a run of readings into local days.
 *
 * This is the piece the migration plan named as a port hazard, and it is worth
 * the warning. The Python computes a reading's position in its day as
 * `when - midnight`, which reads like elapsed time and is not: Python ignores
 * the offset when both datetimes share a tzinfo, so it is wall clock.
 *
 * JavaScript has no equivalent shortcut. Subtracting instants here would shift
 * every reading after a changeover by an hour, push some past minute 1439 and
 * off the sheet entirely, and — worse — stop "the 08:00 hour" meaning 08:00 on
 * every day, which is what makes the findings comparisons rather than
 * coincidences. So the local hour and minute are read from the formatter.
 */

import type { Day, Reading } from "./bands.js";

/** One reading per five minutes, so a 24-hour day holds 288. */
export const READING_INTERVAL_MINUTES = 5;

export interface Entry {
  /** Milliseconds since the epoch, as Nightscout stores it. */
  readonly at: number;
  readonly mgdl: number;
}

interface LocalParts {
  readonly date: string;
  readonly minute: number;
}

function localParts(at: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const field = (type: string) => parts.find((part) => part.type === type)!.value;
  // `hour` comes back as 24 at midnight under some locales; 24:00 is 00:00.
  const hour = Number(field("hour")) % 24;
  return {
    date: `${field("year")}-${field("month")}-${field("day")}`,
    minute: hour * 60 + Number(field("minute")),
  };
}

/**
 * How many readings a whole day holds: 288 usually, 276 and 300 twice a year,
 * when the clocks move and the day is 23 or 25 hours long.
 */
export function wholeDay(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / 60_000 / READING_INTERVAL_MINUTES);
}

/** The label a row carries, e.g. `5 Aug`. */
export function labelFor(date: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/**
 * Split into local days, oldest first.
 *
 * A day the sensor sat out is dropped rather than drawn empty: a blank row
 * reads as a day at zero, which is a different and much worse claim. The bar
 * is a third of *that* day, so the two short and long ones are judged by their
 * own length rather than by a nominal 288.
 */
export function splitIntoDays(
  entries: readonly Entry[],
  dates: readonly { date: string; start: number; end: number }[],
  timeZone: string,
): Day[] {
  const buckets = new Map<string, Reading[]>();
  for (const entry of entries) {
    const { date, minute } = localParts(entry.at, timeZone);
    const bucket = buckets.get(date) ?? [];
    bucket.push([minute, entry.mgdl]);
    buckets.set(date, bucket);
  }

  const days: Day[] = [];
  for (const { date, start, end } of dates) {
    const readings = (buckets.get(date) ?? []).sort((a, b) => a[0] - b[0]);
    if (readings.length >= Math.floor(wholeDay(start, end) / 3)) {
      days.push({ label: labelFor(date, timeZone), readings });
    }
  }
  return days;
}
