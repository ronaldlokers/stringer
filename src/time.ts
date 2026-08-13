/**
 * Local days, in a named zone.
 *
 * Every boundary this program computes is a local midnight. Getting one wrong
 * does not crash — it reports the wrong day, and the output still looks
 * entirely plausible, which makes it the worst failure available here.
 *
 * Two days a year are not 24 hours long. A day bounded by "midnight plus 24
 * hours" is the wrong day on both of them, so days are bounded by two
 * midnights and the length falls out of the arithmetic.
 */

/** Milliseconds the zone is ahead of UTC at a given instant. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Formatting an instant into the zone, then reading those wall-clock fields
  // back as if they were UTC, gives the offset as the difference.
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  );
  return asUtc - instant;
}

/**
 * The UTC instant of a wall-clock time in a zone.
 *
 * Guess, measure the offset at the guess, correct, then measure again: one
 * correction is not always enough near a transition, because the offset at the
 * guess can belong to the other side of it.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall - offsetAt(wall, timeZone);
  instant = wall - offsetAt(instant, timeZone);
  return instant;
}

export interface LocalDay {
  /** The calendar date, as YYYY-MM-DD in the zone. */
  readonly date: string;
  /** UTC milliseconds of this local midnight. */
  readonly start: number;
  /** UTC milliseconds of the next local midnight. */
  readonly end: number;
}

export function localDay(date: string, timeZone: string): LocalDay {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    // Deliberately unguarded elsewhere: a malformed date fails the run and
    // says why. Falling back to today would silently report a different day
    // than the one asked for, which is worse than a failed manual run.
    throw new RangeError(`not a date: ${date}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const start = zonedTimeToUtc(y, m, d, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { date, start, end };
}

/** The day before `now` in the zone — what the digest reports. */
export function yesterday(now: Date, timeZone: string): LocalDay {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // en-CA formats as YYYY-MM-DD, which is the one format that sorts and parses
  // the same way everywhere.
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const before = new Date(Date.UTC(y, m - 1, d - 1));
  return localDay(before.toISOString().slice(0, 10), timeZone);
}

export function hoursIn(day: LocalDay): number {
  return (day.end - day.start) / 3_600_000;
}

/** Minutes past local midnight, as `HH:MM`. */
export function clock(minute: number): string {
  const whole = Math.trunc(minute);
  const hour = Math.floor(whole / 60);
  return `${String(hour).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
