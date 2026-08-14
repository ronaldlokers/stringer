/**
 * The speedtest beat: what the connection delivered against what it is sold as.
 *
 * Sunday morning, covering the seven days that ended Saturday. Unlike the
 * briefing this always posts — it is a record rather than an alarm, and the
 * figure that makes it worth opening (how much of the line actually arrived)
 * varies every week whether or not anything went wrong.
 *
 * The numbers come from the speedtest-only Prometheus, which keeps 400 days
 * where the main instance keeps ten. Both answer the same metric names, so the
 * URL matters: pointed at the wrong one this looks right and quietly reports
 * whatever fits in a week and a half.
 *
 * Env:
 *   PROMETHEUS_URL    base URL, default the speedtest instance's Service
 *   PLAN_DOWN_MBPS    what the line is sold as, default 1000
 *   PLAN_UP_MBPS      default 1000
 *   DIGEST_TIMEZONE   which days these are
 *   DIGEST_DATE       report the week ending this day instead of yesterday
 */

import { escape } from "../copy/alerts/render.js";
import { GIGABIT, type Day, type Plan, type Test } from "../copy/speedtest/week.js";
import { renderWeek } from "../press/speedtest/index.js";
import { localDay, yesterday, type LocalDay } from "../time.js";
import type { Round } from "../rounds.js";

const DAYS = 7;
const TIMEOUT_MS = 20_000;
/** The first connection from a new pod can be refused while its NetworkPolicy
 *  is still being programmed; the symptom is one refusal and then success. */
const ATTEMPTS = 3;
const RETRY_MS = 5_000;

/** One test an hour: the tracker's schedule, and the resolution of everything here. */
const STEP_SECONDS = 3600;

export async function speedtest(round: Round, environment = process.env): Promise<void> {
  const zone = environment.DIGEST_TIMEZONE?.trim() || "Europe/Amsterdam";
  const base =
    environment.PROMETHEUS_URL?.trim() ||
    "http://prometheus-speedtest.monitoring.svc.cluster.local:9090";
  const plan = planFrom(environment);

  const last = environment.DIGEST_DATE?.trim()
    ? localDay(environment.DIGEST_DATE.trim(), zone)
    : yesterday(new Date(), zone);
  const window = daysEnding(last, zone, DAYS);
  const first = window[0]!;

  let tests: Test[];
  try {
    tests = await withRetry(() => fetchTests(base, first.start, last.end));
  } catch (error) {
    // Say so rather than failing quietly: a weekly record that simply stops
    // arriving is indistinguishable from a week nobody looked at.
    await round.say(
      "<div><strong>📉 could not read the speedtest history</strong></div>" +
        `<pre>${escape(String(error))}</pre>`,
    );
    return;
  }

  const days = splitIntoDays(tests, window);
  const counted = days.reduce((total, day) => total + day.tests.length, 0);
  process.stdout.write(`${first.date}..${last.date}: ${counted} tests over ${days.length} days\n`);

  if (!counted) {
    await round.say(
      "<div><strong>📉 no speed tests this week</strong></div>" +
        "<div>Nothing was recorded between " +
        `${escape(first.date)} and ${escape(last.date)}, so there is no sheet to draw.</div>`,
    );
    return;
  }

  const png = renderWeek(days, plan);
  process.stdout.write(`week sheet ${png.byteLength} bytes\n`);
  await round.show(png, "speedtest.png");
}

function planFrom(environment: NodeJS.ProcessEnv): Plan {
  const megabits = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 1_000_000 : fallback;
  };
  return {
    down: megabits(environment.PLAN_DOWN_MBPS, GIGABIT.down),
    up: megabits(environment.PLAN_UP_MBPS, GIGABIT.up),
  };
}

function daysEnding(last: LocalDay, timeZone: string, count: number): LocalDay[] {
  const out: LocalDay[] = [];
  const [year, month, day] = last.date.split("-").map(Number) as [number, number, number];
  for (let back = count - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(year, month - 1, day - back));
    out.push(localDay(at.toISOString().slice(0, 10), timeZone));
  }
  return out;
}

/**
 * Each local day's tests, in the order they happened.
 *
 * A day is however many hours the zone says it is — 23 on the morning the
 * clocks go forward — which is why the boundaries come from LocalDay rather
 * than from arithmetic on 86,400.
 */
export function splitIntoDays(tests: readonly Test[], window: readonly LocalDay[]): Day[] {
  return window.map((day) => ({
    label: labelOf(day),
    tests: tests
      .filter((test) => test.at * 1000 >= day.start && test.at * 1000 < day.end)
      .sort((a, b) => a.at - b.at),
  }));
}

function labelOf(day: LocalDay): string {
  const at = new Date(day.start + 43_200_000);
  const name = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][at.getUTCDay()]!;
  return `${name} ${day.date.slice(8)}`;
}

async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let round = 0; round < ATTEMPTS; round += 1) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
      if (round + 1 < ATTEMPTS) {
        process.stdout.write(`query attempt ${round + 1} failed (${String(error)}), retrying\n`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }
  throw last;
}

/**
 * The week, one point per hour.
 *
 * `max_over_time` over the step rather than the bare metric: the exporter
 * republishes its last result at every scrape, so the raw series carries the
 * same test sixty times over. Aggregating with `max` is also what makes the
 * backfilled history usable — those samples carry fewer labels than scraped
 * ones, and only an aggregate puts the two on one line.
 */
async function fetchTests(base: string, startMs: number, endMs: number): Promise<Test[]> {
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  const [down, up, ping] = await Promise.all([
    range(base, "max(max_over_time(speedtest_tracker_download_bits[1h]))", start, end),
    range(base, "max(max_over_time(speedtest_tracker_upload_bits[1h]))", start, end),
    range(base, "min(min_over_time(speedtest_tracker_ping_ms[1h]))", start, end),
  ]);

  // Keyed on the step, so the three series line up even where one has a gap the
  // others do not. A test missing its download is not a test.
  const out: Test[] = [];
  for (const [at, value] of down) {
    const upAt = up.get(at);
    const pingAt = ping.get(at);
    if (upAt === undefined || pingAt === undefined) continue;
    out.push({ at, down: value, up: upAt, ping: pingAt });
  }
  return out.sort((a, b) => a.at - b.at);
}

async function range(
  base: string,
  query: string,
  start: number,
  end: number,
): Promise<Map<number, number>> {
  const url = new URL("/api/v1/query_range", base);
  url.searchParams.set("query", query);
  url.searchParams.set("start", String(start));
  url.searchParams.set("end", String(end));
  url.searchParams.set("step", String(STEP_SECONDS));

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`prometheus answered ${response.status} for ${query}`);
  }
  const body = (await response.json()) as {
    status?: string;
    data?: { result?: { values?: [number, string][] }[] };
  };
  if (body.status !== "success") throw new Error(`prometheus refused ${query}`);

  const out = new Map<number, number>();
  for (const [at, value] of body.data?.result?.[0]?.values ?? []) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) out.set(at, parsed);
  }
  return out;
}
