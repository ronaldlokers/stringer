/**
 * The Sunday message about unread feeds.
 *
 * Quiet when there is nothing unread: an empty reader needs no announcement,
 * and this is the one bot whose subject is a habit rather than a machine.
 */

import { escape } from "../alerts/render.js";
import { bullets, heading } from "../cluster/briefing.js";
import { arrived, daysWaiting, total, worst, type Backlog } from "./backlog.js";

export function renderBacklog(backlog: Backlog, now: number): string | null {
  const unread = total(backlog);
  if (!unread) return null;

  const week = arrived(backlog);
  const waited = daysWaiting(backlog, now);
  const lines: string[] = [];

  for (const feed of worst(backlog)) {
    // How much of a feed's pile is this week's is the whole point: 300 items
    // that arrived over a year is a habit, 300 that arrived since Sunday is a
    // firehose.
    lines.push(
      `${escape(feed.title)} · ${feed.unread}` +
        (feed.thisWeek ? ` (${feed.thisWeek} this week)` : ""),
    );
  }

  if (waited !== null && waited >= 7) {
    lines.push(`the oldest has waited ${waited} days`);
  }

  return (
    heading(`📚 ${unread} unread · commafeed`) +
    `<div>${week} arrived this week</div>` +
    bullets(lines)
  );
}
