/**
 * The morning message, or nothing at all.
 *
 * Returning nothing is the whole design. A briefing that arrives every morning
 * saying everything is fine is a briefing you stop opening — and then it is
 * worth less than nothing, because its silence no longer means anything either.
 * So: problems, overnight alerts, and checks that could not run get a message.
 * A clean cluster gets none.
 *
 * A check that failed to run is not silence. An unknown reported as healthy is
 * the one failure mode that makes this worse than having no briefing at all.
 */

import { escape } from "../alerts/render.js";

/** A room message nobody scrolls is a room message nobody reads. */
const MAX_ITEMS = 15;

export interface Briefing {
  readonly problems: readonly string[];
  readonly overnight: readonly string[];
  readonly skipped: readonly string[];
  readonly windowHours: number;
  /**
   * Which cluster this is about, when more than one files into the same room.
   *
   * Absent for the cluster that owns the room — labelling the common case adds
   * a word to every heading and distinguishes nothing. Present for anyone
   * filing from elsewhere, because without it a staging failure reads as a
   * production one, which is the confusion the Flux events already label
   * against.
   */
  readonly cluster?: string;
}

/**
 * A headline on its own line.
 *
 * `<strong>` is inline, so two in a row render as one unbroken run of bold
 * text. A block wrapper is the only thing that separates them, because
 * Campfire ignores newline characters entirely.
 */
export function heading(text: string): string {
  return `<div><strong>${text}</strong></div>`;
}

export function bullets(items: readonly string[]): string {
  const shown = items.slice(0, MAX_ITEMS);
  let body = shown.map((item) => `<li>${escape(item)}</li>`).join("");
  if (items.length > shown.length) {
    body += `<li>… and ${items.length - shown.length} more</li>`;
  }
  return `<ul>${body}</ul>`;
}

export function renderBriefing(briefing: Briefing): string | null {
  const { problems, overnight, skipped, windowHours, cluster } = briefing;
  if (!problems.length && !overnight.length && !skipped.length) return null;

  const parts: string[] = [];
  // Once, at the top, rather than on every heading: the whole message is about
  // one cluster, and repeating the name would read as a comparison.
  if (cluster) parts.push(heading(`[${escape(cluster)}]`));
  if (problems.length) {
    parts.push(
      heading(`⚠️ ${problems.length} problem${problems.length === 1 ? "" : "s"}`),
      bullets(problems),
    );
  }
  if (overnight.length) {
    parts.push(heading(`🌙 fired in the last ${windowHours}h`), bullets(overnight));
  }
  if (skipped.length) {
    parts.push(heading("❓ not checked"), bullets(skipped));
  }
  return parts.join("");
}
