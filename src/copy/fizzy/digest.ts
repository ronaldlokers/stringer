/**
 * The Monday message, or nothing at all.
 *
 * Boards with nothing in Next, nothing stalled and an empty inbox get no line;
 * a week where every board is quiet gets no message. This is a reminder that
 * the boards exist, not a weekly report on their existence.
 */

import { escape } from "../alerts/render.js";
import { bullets, heading } from "../cluster/briefing.js";
import { days, oldest, type Board, type Card } from "./board.js";

/** Three of anything is a list; ten is a backlog nobody reads in a chat room. */
const SHOWN = 3;

/**
 * Where this came from.
 *
 * Almanac posts everything — sheets, findings, records — so a message that
 * opens with a board's name says nothing about what it is, and "Campfire" is
 * the name of both a board and the room it arrives in. The sheets carry a
 * source line for the same reason; this is that line, in a message with no
 * sheet to put it on.
 */
const SOURCE = "📋 the boards · fizzy";

export function renderDigest(boards: readonly Board[], now: number): string | null {
  const parts: string[] = [];

  for (const board of boards) {
    const lines: string[] = [];

    for (const card of board.next.slice(0, SHOWN)) {
      lines.push(`next · ${card.title} (#${card.number})`);
    }
    if (board.next.length > SHOWN) {
      lines.push(`next · and ${board.next.length - SHOWN} more`);
    }

    for (const card of board.stalled) {
      lines.push(
        `stalled · ${card.title} (#${card.number}) — ` +
          `${days(card.lastActiveAt, now)} days since anything happened`,
      );
    }

    // In progress and moving is the one state that needs no comment: it is
    // working. Only the count, so the board's shape is still visible.
    const moving = board.inProgress.length - board.stalled.length;
    if (moving > 0) {
      lines.push(`in progress · ${moving} moving`);
    }

    if (board.untriaged.length) {
      const [waiting] = oldest(board.untriaged, 1);
      lines.push(
        `untriaged · ${board.untriaged.length}, oldest is ` +
          `"${waiting!.title}" (#${waiting!.number}) from ` +
          `${days(waiting!.lastActiveAt, now)} days ago`,
      );
    }

    if (lines.length) {
      parts.push(heading(escape(board.name)), bullets(lines));
    }
  }

  return parts.length ? heading(SOURCE) + parts.join("") : null;
}

/** Everything the digest would mention, for the log line. */
export function summarise(boards: readonly Board[]): string {
  return boards
    .map(
      (board) =>
        `${board.name}: ${board.next.length} next, ${board.stalled.length} stalled, ` +
        `${board.untriaged.length} untriaged`,
    )
    .join("; ");
}

export type { Board, Card };
