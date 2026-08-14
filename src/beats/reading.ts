/**
 * The reading beat: which feeds publish more than you read.
 *
 * CommaFeed records a status row only when an entry is acted on, so unread is
 * the *absence* of a row rather than a flag set to false. Reading it the other
 * way said "nothing unread" while 1,475 items sat there — the reader knew
 * better, which is why this query is written against the absence.
 *
 * Env:
 *   PGUSER, PGPASSWORD  a read-only role on the commafeed database
 *   PGHOST, PGPORT      default the shared cluster's read-write service
 */

import { escape } from "../copy/alerts/render.js";
import { renderBacklog } from "../copy/reading/digest.js";
import type { Backlog, Feed } from "../copy/reading/backlog.js";
import { reading as withDatabase, urlFrom } from "../db.js";
import { describe } from "../retry.js";
import type { Round } from "../rounds.js";

export async function reading(round: Round, environment = process.env): Promise<void> {
  let backlog: Backlog;
  try {
    backlog = await withDatabase(urlFrom(environment, "commafeed"), async (sql) => {
      const feeds = (await sql`
        SELECT sub.title AS title,
               count(*)::int AS unread,
               count(*) FILTER (WHERE e.inserted > now() - interval '7 days')::int AS this_week
          FROM feedentries e
          JOIN feedsubscriptions sub ON sub.feed_id = e.feed_id
         WHERE NOT EXISTS (
                 SELECT 1 FROM feedentrystatuses s
                  WHERE s.entry_id = e.id AND s.user_id = sub.user_id)
         GROUP BY sub.title
      `) as unknown as { title: string; unread: number; this_week: number }[];

      const [oldest] = (await sql`
        SELECT min(e.inserted) AS oldest
          FROM feedentries e
          JOIN feedsubscriptions sub ON sub.feed_id = e.feed_id
         WHERE NOT EXISTS (
                 SELECT 1 FROM feedentrystatuses s
                  WHERE s.entry_id = e.id AND s.user_id = sub.user_id)
      `) as unknown as { oldest: Date | null }[];

      return {
        feeds: feeds.map(
          (row): Feed => ({ title: row.title, unread: row.unread, thisWeek: row.this_week }),
        ),
        oldest: oldest?.oldest ? new Date(oldest.oldest).getTime() : null,
      };
    });
  } catch (error) {
    await round.say(
      "<div><strong>📚 could not read the feeds</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  const html = renderBacklog(backlog, Date.now());
  if (html === null) {
    process.stdout.write("nothing unread, saying nothing\n");
    return;
  }
  process.stdout.write(`${backlog.feeds.length} feeds with unread items\n`);
  await round.say(html);
}
