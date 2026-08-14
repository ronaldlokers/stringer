/**
 * The uptime beat: the month, counted.
 *
 * Argus posts the moment a probe fails and never mentions it again, so an
 * outage is something you were told about once. Nothing has ever said "here is
 * the month" — which service was worst, how long the longest stretch was, and
 * how many days passed with nothing failing at all.
 *
 * Two tables, because they answer different questions and only one of them
 * survives intact:
 *
 *   endpoint_uptimes  totals per endpoint, hourly for 48 hours and daily after
 *                     that. Complete at any age, so every percentage here is
 *                     exact.
 *   endpoint_events   the UP/DOWN transitions, with real timestamps. This is
 *                     the only place outage *timing* survives the merge — but
 *                     gatus caps them per endpoint by count, so a flappy
 *                     service loses its oldest ones. Timing is best-effort;
 *                     the numbers are not.
 *
 * The window is thirty days rather than a calendar month, which the store
 * forces: see `copy/uptime/month.ts`.
 *
 * Env:
 *   PGUSER, PGPASSWORD  a read-only role on the gatus database
 *   PGHOST, PGPORT      default the shared cluster's read-write service
 *   DIGEST_TIMEZONE     which days these are
 *   UPTIME_DAYS         how far back to count, default 30
 */

import { escape } from "../copy/alerts/render.js";
import { renderMonth } from "../press/uptime/index.js";
import { datesIn, type Endpoint, type Outage } from "../copy/uptime/month.js";
import { reading as withDatabase, urlFrom } from "../db.js";
import { describe } from "../retry.js";
import type { Round } from "../rounds.js";

/**
 * Thirty days.
 *
 * Gatus deletes uptime rows past thirty and starts merging hourly ones at
 * forty-eight hours, so this is the whole of what there is rather than a
 * choice about how much of it to read.
 */
const DEFAULT_DAYS = 30;

export async function uptime(round: Round, environment = process.env): Promise<void> {
  const zone = environment.DIGEST_TIMEZONE?.trim() || "Europe/Amsterdam";
  const days = Number(environment.UPTIME_DAYS?.trim()) || DEFAULT_DAYS;

  let month: { endpoints: Endpoint[]; outages: Outage[] };
  try {
    month = await withDatabase(urlFrom(environment, "gatus"), async (sql) => {
      // Days are cut in the reader's own zone, not in UTC: an outage at half
      // past midnight belongs to the day he would say it happened on.
      const rows = (await sql`
        SELECT e.endpoint_name AS name,
               e.endpoint_group AS grp,
               to_char(to_timestamp(u.hour_unix_timestamp) AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
               sum(u.total_executions)::bigint AS total,
               sum(u.successful_executions)::bigint AS successful,
               sum(u.total_response_time)::bigint AS response_total
          FROM endpoint_uptimes u
          JOIN endpoints e ON e.endpoint_id = u.endpoint_id
         WHERE to_timestamp(u.hour_unix_timestamp) >= now() - make_interval(days => ${days})
         GROUP BY 1, 2, 3
         ORDER BY 1, 3
      `) as unknown as {
        name: string;
        grp: string;
        day: string;
        total: string;
        successful: string;
        response_total: string;
      }[];

      // Transitions, oldest first. UNHEALTHY opens an outage and the next
      // HEALTHY for that endpoint closes it; START is gatus booting and is
      // neither.
      const events = (await sql`
        SELECT e.endpoint_name AS name, ev.event_type AS type, ev.event_timestamp AS at
          FROM endpoint_events ev
          JOIN endpoints e ON e.endpoint_id = ev.endpoint_id
         WHERE ev.event_timestamp >= now() - make_interval(days => ${days})
         ORDER BY ev.event_timestamp
      `) as unknown as { name: string; type: string; at: Date }[];

      return { endpoints: shape(rows), outages: outagesFrom(events) };
    });
  } catch (error) {
    await round.say(
      "<div><strong>📡 could not read the uptime history</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  const covered = datesIn(month.endpoints).length;
  process.stdout.write(
    `${month.endpoints.length} endpoints, ${covered} days, ${month.outages.length} outages\n`,
  );

  if (!month.endpoints.length) {
    await round.say(
      "<div><strong>📡 no uptime history</strong></div>" +
        "<div>gatus has recorded nothing in the last " +
        `${days} days, so there is no sheet to draw.</div>`,
    );
    return;
  }

  const png = renderMonth(month.endpoints, month.outages, zone);
  process.stdout.write(`month sheet ${png.byteLength} bytes\n`);
  await round.show(png, "uptime.png");
}

/** Rows into endpoints, keeping each one's days in date order. */
export function shape(
  rows: readonly {
    name: string;
    grp: string;
    day: string;
    total: string | number;
    successful: string | number;
    response_total: string | number;
  }[],
): Endpoint[] {
  const byName = new Map<string, { group: string; days: Map<string, [number, number]>; response: number; checks: number }>();

  for (const row of rows) {
    const total = Number(row.total);
    const successful = Number(row.successful);
    const entry = byName.get(row.name) ?? {
      group: row.grp,
      days: new Map<string, [number, number]>(),
      response: 0,
      checks: 0,
    };
    entry.days.set(row.day, [total, successful]);
    entry.response += Number(row.response_total);
    entry.checks += total;
    byName.set(row.name, entry);
  }

  return [...byName.entries()].map(([name, entry]) => ({
    name,
    group: entry.group,
    days: [...entry.days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, [total, successful]]) => ({ date, total, successful })),
    responseMs: entry.checks ? entry.response / entry.checks : 0,
  }));
}

/**
 * Transitions into outages.
 *
 * An UNHEALTHY with no HEALTHY after it is still open, and is recorded as such
 * rather than closed at the window's edge — an outage that is still happening
 * has no length yet, and inventing one would put it at the top of every
 * "longest" comparison.
 */
export function outagesFrom(
  events: readonly { name: string; type: string; at: Date | string | number }[],
): Outage[] {
  const open = new Map<string, number>();
  const out: Outage[] = [];

  for (const event of events) {
    const at = new Date(event.at).getTime();
    if (!Number.isFinite(at)) continue;
    if (event.type === "UNHEALTHY") {
      // A second UNHEALTHY without a recovery between is the same outage still
      // being reported, so the first timestamp is the one that counts.
      if (!open.has(event.name)) open.set(event.name, at);
    } else if (event.type === "HEALTHY") {
      const from = open.get(event.name);
      if (from !== undefined) {
        out.push({ endpoint: event.name, from, to: at });
        open.delete(event.name);
      }
    }
  }

  for (const [endpoint, from] of open) out.push({ endpoint, from, to: null });
  return out.sort((a, b) => a.from - b.from);
}
