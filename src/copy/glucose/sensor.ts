/**
 * How old the sensor is, and when it is due to end.
 *
 * Coverage collapses on a predictable cycle — a sensor ends, and until the next
 * one has warmed up there are no readings at all. The digest has always
 * reported that afterwards, as a day with poor coverage and withheld
 * statistics. Saying "day 9 of 10" beforehand is the same information at the
 * only moment it is any use.
 *
 * **Nightscout knows this when the uploader tells it.** A `Sensor Start`
 * treatment is the authoritative answer and is what the site's own SAGE pill
 * reads; this instance has them. So the treatment is used when there is one,
 * and the gaps are only a fallback for when there is not.
 *
 * The fallback works because a sensor change leaves a hole: the old sensor
 * stops, the new one warms up for an hour or two, and nothing arrives between.
 * Ordinary life leaves smaller holes — a phone out of range, a shower, a flat
 * battery — so the threshold sits above those and below a warm-up. It never
 * claims a session it cannot see: with no gap in the window the answer is "at
 * least fourteen days", because the sensor may be older than the readings.
 */

import type { Entry } from "./days.js";

/**
 * Ninety minutes.
 *
 * A Libre warm-up is an hour, a Dexcom's is two, and a lost phone is minutes.
 * Ninety sits between the two populations rather than in either.
 */
export const GAP_MINUTES = 90;

/**
 * How long a sensor is sold to last.
 *
 * Ten days: Dexcom ONE+. A G6 is ten, a Libre 2 is fourteen — so this is a
 * number about the hardware rather than about the reading, and it lives here
 * rather than in a sentence.
 */
export const SENSOR_DAYS = 10;

export interface Session {
  /** When the sensor started, in epoch milliseconds. */
  readonly startedAt: number;
  /** Whole days from that moment to now. */
  readonly days: number;
  /**
   * False when the start was inferred from a gap that may not be there — the
   * sensor is then *at least* this old rather than exactly.
   */
  readonly exact: boolean;
  /** True when Nightscout recorded the start itself. */
  readonly recorded: boolean;
}

export function sessionFrom(
  entries: readonly Entry[],
  now: number,
  /** The newest `Sensor Start` treatment, if the uploader records them. */
  recordedStart?: number,
): Session | null {
  const sorted = [...entries].sort((a, b) => a.at - b.at);

  let startedAt = sorted[0]?.at ?? recordedStart;
  let exact = false;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = (sorted[index]!.at - sorted[index - 1]!.at) / 60_000;
    if (gap >= GAP_MINUTES) {
      startedAt = sorted[index]!.at;
      exact = true;
    }
  }

  // The recorded start wins, unless the readings show a gap *after* it — which
  // means a sensor was changed and nobody wrote it down, and the readings are
  // then the more recent truth.
  if (recordedStart !== undefined && (!exact || recordedStart >= startedAt!)) {
    return {
      startedAt: recordedStart,
      days: Math.floor((now - recordedStart) / 86_400_000),
      exact: true,
      recorded: true,
    };
  }
  if (startedAt === undefined) return null;

  return {
    startedAt,
    days: Math.floor((now - startedAt) / 86_400_000),
    exact,
    recorded: false,
  };
}

/**
 * The sentence, or nothing.
 *
 * Silent until the last three days: "day 2 of 10" is not news, and a line that
 * appears every morning is one nobody reads on the morning it matters. The
 * wording carries how the number was arrived at, because an inferred count is
 * a floor and a recorded one is a fact.
 */
export function sensorFinding(
  session: Session | null,
  lifetime = SENSOR_DAYS,
): readonly [string, string] | null {
  if (!session) return null;
  const left = lifetime - session.days;
  if (left > 3) return null;

  const due =
    left <= 0
      ? "due now, or already changed"
      : `due in ${left} day${left === 1 ? "" : "s"}`;

  if (!session.exact) {
    return ["sensor", `on at least day ${session.days} — no gap in the readings, so it began before them`];
  }
  return [
    "sensor",
    session.recorded
      ? `day ${session.days} of ${lifetime}, ${due}`
      : `day ${session.days} of ${lifetime}, ${due} — counted from a gap in the readings`,
  ];
}
