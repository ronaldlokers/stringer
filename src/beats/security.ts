/**
 * The security beat: authentik's events, when any of them matter.
 *
 * Exception-only and hourly. This cluster produces about thirty events a
 * quarter and one failed sign-in in ninety days, so a scheduled digest would
 * be a weekly sentence saying nothing — and the one message that matters would
 * arrive up to six days late.
 *
 * Env:
 *   PGUSER, PGPASSWORD  a read-only role on the authentik database
 *   SECURITY_WINDOW     how far back to look, default 65m
 */

import { escape } from "../copy/alerts/render.js";
import { renderSecurity } from "../copy/security/digest.js";
import type { Event } from "../copy/security/events.js";
import { needsAttention } from "../copy/mention.js";
import { reading as withDatabase, urlFrom } from "../db.js";
import { describe } from "../retry.js";
import type { Round } from "../rounds.js";

export async function security(round: Round, environment = process.env): Promise<void> {
  // Slightly longer than the hour between runs: an event landing in the seam
  // between two windows would otherwise be seen by neither.
  const window = environment.SECURITY_WINDOW?.trim() || "65 minutes";

  let events: Event[];
  try {
    events = await withDatabase(urlFrom(environment, "authentik"), async (sql) => {
      const rows = (await sql`
        SELECT action,
               created,
               -- The subject lives on the event's own user column (jsonb, and
               -- a reserved word, hence the quoting); context carries it too
               -- for some actions.
               coalesce("user"->>'username', context->>'username', 'unknown') AS who,
               coalesce(client_ip::text, '') AS client_ip
          FROM authentik_events_event
         WHERE created > now() - ${window}::interval
         ORDER BY created
      `) as unknown as { action: string; created: Date; who: string; client_ip: string }[];
      return rows.map((row) => ({
        action: row.action,
        at: new Date(row.created).getTime(),
        who: String(row.who ?? "").replace(/^"|"$/g, ""),
        from: row.client_ip ?? "",
      }));
    });
  } catch (error) {
    await round.say(
      "<div><strong>🔐 could not read authentik's events</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  const html = renderSecurity(events);
  if (html === null) {
    process.stdout.write(`${events.length} events, none worth saying\n`);
    return;
  }
  process.stdout.write(`${events.length} events, some worth saying\n`);
  // Always a mention: this only speaks when something unexpected happened, and
  // an unexpected thing you find on Tuesday is not much use.
  await round.say(needsAttention(html, environment.CAMPFIRE_MENTION_SGID));
}
