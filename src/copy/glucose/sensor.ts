/**
 * How old the sensor is, inferred from the gaps it leaves.
 *
 * Coverage collapses on a predictable cycle — a sensor ends, and until the next
 * one has warmed up there are no readings at all. The digest has always
 * reported that afterwards, as a day with poor coverage and withheld
 * statistics. Saying "this sensor is on day 9" beforehand is the same
 * information at the only moment it is any use.
 *
 * Nightscout stores readings, not sessions, so a session boundary has to be
 * inferred. A sensor change leaves a hole: the old sensor stops, the new one
 * warms up for an hour or two, and nothing arrives in between. Ordinary life
 * leaves smaller holes — a phone out of range, a shower, a flat battery — so
 * the threshold has to sit above those and below a warm-up.
 *
 * This never claims a session it cannot see. With a fortnight of readings and
 * no gap in them, the honest answer is "at least fourteen days", not "fourteen
 * days": the sensor may well be older than the window.
 */

import type { Entry } from "./days.js";

/**
 * Ninety minutes.
 *
 * A Libre warm-up is an hour, a Dexcom's is two, and a lost phone is minutes.
 * Ninety sits between the two populations rather than in either.
 */
export const GAP_MINUTES = 90;

export interface Session {
  /** When the first reading after the gap arrived, in epoch milliseconds. */
  readonly startedAt: number;
  /** Whole days from that reading to the newest one. */
  readonly days: number;
  /**
   * False when no gap was found in the window, so the sensor started before
   * the readings did and is *at least* this old.
   */
  readonly exact: boolean;
}

export function sessionFrom(entries: readonly Entry[], now: number): Session | null {
  if (entries.length < 2) return null;
  const sorted = [...entries].sort((a, b) => a.at - b.at);

  let startedAt = sorted[0]!.at;
  let exact = false;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = (sorted[index]!.at - sorted[index - 1]!.at) / 60_000;
    if (gap >= GAP_MINUTES) {
      startedAt = sorted[index]!.at;
      exact = true;
    }
  }

  return {
    startedAt,
    days: Math.floor((now - startedAt) / 86_400_000),
    exact,
  };
}

/**
 * The sentence, or nothing.
 *
 * Silent for the first days of a sensor: "on day 2" is not news, and a line
 * that appears every morning is one nobody reads by the morning it matters.
 * From day 8 it is worth knowing, and the wording carries whether the count is
 * a floor rather than a fact.
 */
export function sensorFinding(session: Session | null): readonly [string, string] | null {
  if (!session || session.days < 8) return null;
  const day = `day ${session.days}`;
  return session.exact
    ? ["sensor", `on ${day}, counting from the last gap in the readings`]
    : ["sensor", `on at least ${day} — no gap in the readings, so it started before them`];
}
