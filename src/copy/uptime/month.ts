/**
 * The month as Gatus can actually answer it.
 *
 * Argus shouts when a probe fails and says nothing afterwards, so an outage is
 * something you were told about once and never counted. This is the counting:
 * per endpoint, per day, over the window the store still holds.
 *
 * **That window is thirty days, not a calendar month, and the difference is
 * forced rather than chosen.** Gatus keeps hourly rows for 48 hours, merges
 * everything older into daily buckets, and deletes what passes thirty days:
 *
 *     uptimeHourlyBuffer        = 48 * time.Hour
 *     uptimeRetention           = 30 * 24 * time.Hour
 *     uptimeAgeCleanUpThreshold = 32 * 24 * time.Hour
 *
 * So a review posted on the 1st cannot see the 1st of the month before — that
 * day is thirty-one days old and already gone. Reporting "July" from a store
 * that has forgotten July's first days would be a quiet lie, and these bots
 * exist not to tell them. The sheet says the window it found.
 *
 * The merge into daily buckets costs nothing here: a day's totals are a day's
 * totals whether they arrive as one row or twenty-four. What it does cost is
 * knowing *when* within an older day something broke — and that is why outage
 * timing comes from the events table instead, which keeps exact transitions.
 */

/** A day of one endpoint's checks, however many rows the store kept it in. */
export interface Day {
  /** `YYYY-MM-DD`, in the zone the review is written for. */
  readonly date: string;
  readonly total: number;
  readonly successful: number;
}

export interface Endpoint {
  readonly name: string;
  /** Gatus's own grouping — `homelab`, `external`, `infrastructure`. */
  readonly group: string;
  readonly days: readonly Day[];
  /** Mean response time across the window, in milliseconds. */
  readonly responseMs: number;
}

/** A stretch during which an endpoint was failing its checks. */
export interface Outage {
  readonly endpoint: string;
  /** Epoch milliseconds. */
  readonly from: number;
  /**
   * When it recovered, or null for an outage still open at the window's end —
   * which is a different thing from a long one and is never counted as the
   * longest.
   */
  readonly to: number | null;
}

/**
 * How a day is coloured.
 *
 * `perfect` is every check answered, not "about right". The ordinary day here
 * is a full one, so a band that swallowed a single failed check would make the
 * sheet a field of green with the interesting days hidden inside it — which is
 * the heatmap failure DESIGN.md refuses on the glucose sheet.
 */
export type BandName = "perfect" | "nearly" | "patchy" | "bad" | "missing";

export function bandOf(day: Day | undefined): BandName {
  if (!day || day.total === 0) return "missing";
  if (day.successful >= day.total) return "perfect";
  const share = day.successful / day.total;
  if (share >= 0.995) return "nearly";
  if (share >= 0.95) return "patchy";
  return "bad";
}

export function uptimeOf(endpoint: Endpoint): number {
  const total = sum(endpoint.days.map((day) => day.total));
  if (!total) return 0;
  return sum(endpoint.days.map((day) => day.successful)) / total;
}

/** Every date in the window, oldest first, whether or not anything ran. */
export function datesIn(endpoints: readonly Endpoint[]): string[] {
  const dates = new Set<string>();
  for (const endpoint of endpoints) {
    for (const day of endpoint.days) dates.add(day.date);
  }
  return [...dates].sort();
}

export function dayOn(endpoint: Endpoint, date: string): Day | undefined {
  return endpoint.days.find((day) => day.date === date);
}

/** Worst first: the sheet is read from the top and the worst row is the news. */
export function byUptime(endpoints: readonly Endpoint[]): Endpoint[] {
  return [...endpoints].sort((a, b) => uptimeOf(a) - uptimeOf(b));
}

/** Overall, weighted by checks rather than by endpoint. */
export function overall(endpoints: readonly Endpoint[]): number {
  const total = sum(endpoints.flatMap((e) => e.days.map((day) => day.total)));
  if (!total) return 0;
  return sum(endpoints.flatMap((e) => e.days.map((day) => day.successful))) / total;
}

/**
 * How long a window of simultaneous failures has to be to count as one event.
 *
 * Gatus checks each endpoint on its own schedule, so a single cluster-wide
 * outage is discovered by seventeen probes over the following minute or two
 * rather than at one instant.
 */
const TOGETHER_MS = 10 * 60_000;

/**
 * How many endpoints failing at once stops being a coincidence.
 *
 * Three, because two neighbours going down together is common when one depends
 * on the other — a database and the app in front of it — and says nothing about
 * the cluster.
 */
const TOGETHER_COUNT = 3;

export interface SharedOutage {
  readonly at: number;
  readonly endpoints: readonly string[];
}

/**
 * Outages that were really one outage.
 *
 * This is the finding the per-endpoint figures hide. Ten services reading 98.3%
 * looks like ten unreliable services and is almost always one bad twenty
 * minutes that they all sat through — and knowing which of the two it was is
 * the entire difference between "the cluster wobbled" and "immich is broken".
 */
export function sharedOutages(outages: readonly Outage[]): SharedOutage[] {
  const starts = [...outages].sort((a, b) => a.from - b.from);
  const out: SharedOutage[] = [];
  let group: Outage[] = [];

  const flush = (): void => {
    const names = [...new Set(group.map((outage) => outage.endpoint))];
    if (names.length >= TOGETHER_COUNT) {
      out.push({ at: group[0]!.from, endpoints: names });
    }
    group = [];
  };

  for (const outage of starts) {
    if (group.length && outage.from - group[0]!.from > TOGETHER_MS) flush();
    group.push(outage);
  }
  if (group.length) flush();
  return out;
}

/**
 * The longest outage that ended.
 *
 * One still open is excluded deliberately: its length is "so far", which would
 * win this comparison every time it was measured and mean something different
 * each time.
 */
export function longest(outages: readonly Outage[]): Outage | null {
  let best: Outage | null = null;
  for (const outage of outages) {
    if (outage.to === null) continue;
    if (!best || outage.to - outage.from > best.to! - best.from) best = outage;
  }
  return best;
}

export function minutesOf(outage: Outage): number {
  if (outage.to === null) return 0;
  return Math.max(1, Math.round((outage.to - outage.from) / 60_000));
}

/**
 * A length of time as somebody would say it.
 *
 * "3450 minutes" is arithmetic homework. The first sheet printed exactly that
 * and it was the one figure on it nobody could read at a glance — an outage
 * lasting most of a weekend should look like most of a weekend.
 */
export function spell(minutes: number): string {
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** Days on which nothing failed anywhere. */
export function cleanDays(endpoints: readonly Endpoint[]): number {
  return datesIn(endpoints).filter((date) =>
    endpoints.every((endpoint) => {
      const day = dayOn(endpoint, date);
      // A day an endpoint did not exist for cannot spoil it: an endpoint added
      // mid-month would otherwise mark every preceding day as imperfect.
      return day === undefined || day.total === 0 || day.successful >= day.total;
    }),
  ).length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
