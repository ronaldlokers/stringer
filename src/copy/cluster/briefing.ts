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
  const { problems, overnight, skipped, windowHours } = briefing;
  if (!problems.length && !overnight.length && !skipped.length) return null;

  const parts: string[] = [];
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
