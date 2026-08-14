/**
 * The glucose beat.
 *
 * **This is not an alarm path and must never become one.** A chat room cannot
 * carry CGM alarms — no escalation, no acknowledgement, delivery suppressed
 * while the room is open. Nightscout's own alarms exist because low and high
 * glucose are safety-critical. Everything here concerns a day already over.
 *
 * Saturday gets the fortnight sheet, because a trend is worth sitting with and
 * Saturday is when there is time to. Every other morning asks the smaller
 * question a single day can honestly answer: was any of it unusual.
 *
 * Env:
 *   NIGHTSCOUT_URL              base URL, default the in-cluster Service
 *   NIGHTSCOUT_API_SECRET_SHA1  sent as the api-secret header
 *   DIGEST_TIMEZONE             which day "yesterday" means
 *   DIGEST_DATE                 report this day instead of yesterday
 *   DIGEST_SHEET                force "day" or "fortnight"
 *   MIN_UPTIME_PERCENT          below this the statistics are withheld
 */

import { BANDS } from "../copy/glucose/bands.js";
import {
  READING_INTERVAL_MINUTES,
  splitIntoDays,
  wholeDay,
  type Entry,
} from "../copy/glucose/days.js";
import { renderDay, renderFortnight } from "../press/glucose/index.js";
import { localDay, yesterday, type LocalDay } from "../time.js";
import type { Round } from "../rounds.js";

/** Fourteen days is the clinical convention for a stable time-in-range figure. */
const HISTORY_DAYS = 14;
const TIMEOUT_MS = 20_000;
/**
 * The first connection from a fresh pod to a cross-namespace destination is
 * refused, and the next succeeds. Measured, not assumed — and it is not the
 * pod's own policy being written late, which is what this comment used to say.
 * See src/retry.ts.
 */
const ATTEMPTS = 3;
const RETRY_MS = 5_000;

export async function glucose(round: Round, environment = process.env): Promise<void> {
  const zone = environment.DIGEST_TIMEZONE?.trim() || "Europe/Amsterdam";
  const secret = environment.NIGHTSCOUT_API_SECRET_SHA1?.trim();
  const base =
    environment.NIGHTSCOUT_URL?.trim() ||
    "http://nightscout.nightscout.svc.cluster.local:1337";
  if (!secret) throw new Error("NIGHTSCOUT_API_SECRET_SHA1 is unset");

  const day = environment.DIGEST_DATE?.trim()
    ? localDay(environment.DIGEST_DATE.trim(), zone)
    : yesterday(new Date(), zone);
  const window = daysEnding(day, zone, HISTORY_DAYS);
  const first = window[0]!;

  let entries: Entry[];
  try {
    entries = await fetchWithRetry(base, secret, first.start, day.end);
  } catch (error) {
    // Say so in the room rather than failing quietly. A digest that simply
    // stops arriving is indistinguishable from a day nobody looked at.
    await round.say(
      "<div><strong>🩺 could not read Nightscout</strong></div>" +
        `<pre>${escape(String(error))}</pre>`,
    );
    return;
  }

  const days = splitIntoDays(entries, window, zone);
  const readings = entries.filter((entry) => entry.at >= day.start);
  const expected = wholeDay(day.start, day.end);
  process.stdout.write(
    `${day.date}: ${readings.length} readings, ${days.length} days of history\n`,
  );

  // The sheet is the whole post; words are only for the days with nothing to
  // draw. A partial day makes the same false claim the withheld statistics
  // would have, and a picture of nothing is worse than no picture.
  const floor = Number(environment.MIN_UPTIME_PERCENT ?? "70");
  if (!days.length || (readings.length / expected) * 100 < floor) {
    await round.say(shortfall(day, readings.length, expected, zone));
    return;
  }

  const weekly = wantsFortnight(day, environment);
  const png = weekly ? renderFortnight(days, BANDS) : renderDay(days, BANDS);
  process.stdout.write(
    `${weekly ? "fortnight" : "day"} chart ${png.byteLength} bytes\n`,
  );
  await round.show(png, "glucose.png");
}

/**
 * Saturday gets the long look back. `day` is the day being reported, so the
 * fortnight sheet arrives on Sunday morning covering the fortnight that ended
 * Saturday.
 */
function wantsFortnight(day: LocalDay, environment: NodeJS.ProcessEnv): boolean {
  const forced = environment.DIGEST_SHEET?.trim().toLowerCase();
  if (forced === "day" || forced === "fortnight") return forced === "fortnight";
  return new Date(day.start + 43_200_000).getUTCDay() === 6;
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

async function fetchWithRetry(
  base: string,
  secret: string,
  startMs: number,
  endMs: number,
): Promise<Entry[]> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      return await fetchEntries(base, secret, startMs, endMs);
    } catch (error) {
      last = error;
      if (attempt + 1 < ATTEMPTS) {
        process.stdout.write(`fetch attempt ${attempt + 1} failed (${String(error)}), retrying\n`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }
  throw last;
}

async function fetchEntries(
  base: string,
  secret: string,
  startMs: number,
  endMs: number,
): Promise<Entry[]> {
  const query = new URLSearchParams({
    "find[date][$gte]": String(startMs),
    "find[date][$lt]": String(endMs),
    // A fortnight is ~4000. Ask for well over: a dense uploader silently
    // truncated would look like poor sensor uptime rather than a capped query.
    count: "8000",
  });
  const response = await fetch(`${base}/api/v1/entries.json?${query}`, {
    headers: { "api-secret": secret, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`nightscout returned ${response.status}`);
  const raw = (await response.json()) as { type?: string; sgv?: number; date?: number }[];
  // Treatments and calibrations share the endpoint; only sensor values count.
  return raw
    .filter(
      (entry) =>
        entry.type === "sgv" &&
        typeof entry.sgv === "number" &&
        typeof entry.date === "number",
    )
    .map((entry) => ({ at: entry.date!, mgdl: entry.sgv! }));
}

function shortfall(day: LocalDay, count: number, expected: number, zone: string): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(day.start + 43_200_000));
  if (count === 0) {
    return (
      `<div><strong>🩺 ${date}</strong></div>` +
      "<div>No readings. Nothing was uploaded for this day — a sensor " +
      "between sessions looks exactly like this.</div>"
    );
  }
  const uptime = Math.round((count / expected) * 100);
  return (
    `<div><strong>🩺 ${date}</strong></div>` +
    `<div>Only ${uptime}% sensor coverage (${count} of ~${expected} readings), ` +
    "so the statistics are left out: a range figure from a partial day " +
    "describes when the sensor was on, not the day.</div>"
  );
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
