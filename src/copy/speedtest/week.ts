/**
 * A week of speed tests, and what counts as getting what you pay for.
 *
 * The connection is sold as a number. That number is the only honest reference
 * point a sheet about it can have, so everything here is expressed as a share
 * of it rather than in absolute megabits — 940 down means nothing without
 * knowing what was bought, and "94% of it" means the whole thing.
 *
 * One test an hour, so a day is at most 24 marks and the length of a run is a
 * number of hours. That is the Vienna Method the glucose sheets already use,
 * and it survives the move: a count of hours at full speed is countable in a
 * way an average is not.
 */

/** Bits per second, as the exporter publishes them. */
export interface Test {
  /** Epoch seconds. */
  readonly at: number;
  readonly down: number;
  readonly up: number;
  readonly ping: number;
}

export interface Day {
  /** As the sheet prints it: "sat 09". */
  readonly label: string;
  readonly tests: readonly Test[];
}

/** What the connection is sold as, in bits per second. */
export interface Plan {
  readonly down: number;
  readonly up: number;
}

export const GIGABIT: Plan = { down: 1_000_000_000, up: 1_000_000_000 };

/**
 * Bands of shortfall, not of speed.
 *
 * The thresholds are deliberately generous at the top: no connection delivers
 * its headline number over TCP to a public server, and a sheet that painted
 * every ordinary 940 as a shortfall would be crying wolf about physics. 90% is
 * what a healthy gigabit line actually returns.
 */
export const BANDS = ["full", "most", "half", "poor"] as const;
export type BandName = (typeof BANDS)[number];

const FLOOR: Record<BandName, number> = {
  full: 0.9,
  most: 0.7,
  half: 0.4,
  poor: 0,
};

export function bandOf(value: number, ceiling: number): BandName {
  const share = value / ceiling;
  if (share >= FLOOR.full) return "full";
  if (share >= FLOOR.most) return "most";
  if (share >= FLOOR.half) return "half";
  return "poor";
}

/** Worst last, so a sorted row reads outward from the trouble. */
export const SEVERITY: readonly BandName[] = ["full", "most", "half", "poor"];

export function share(value: number, ceiling: number): number {
  return value / ceiling;
}

export function megabits(bits: number): number {
  return bits / 1_000_000;
}

export function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function tests(days: readonly Day[]): Test[] {
  return days.flatMap((day) => [...day.tests]);
}

/**
 * The day's tests sorted into bands, worst last.
 *
 * Sorted rather than left in clock order for the same reason the glucose rows
 * are: sorted, the length of the full-speed run *is* the number of hours at
 * full speed, and a length can be counted. In clock order the eye is left
 * estimating shading, which is the heatmap the design refuses.
 */
export function bandsOf(day: Day, ceiling: number): BandName[] {
  return day.tests
    .map((test) => bandOf(test.down, ceiling))
    .sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b));
}

/**
 * Hours with no test at all.
 *
 * Not a failure of the connection — the tracker was down, or the cluster was —
 * but not nothing either: a week counted over 140 tests is a different claim
 * from one counted over 168, and the sheet says which it is.
 */
export function missed(day: Day): number {
  return Math.max(0, 24 - day.tests.length);
}
