/**
 * The fizzy beat: what the boards are holding, on Monday morning.
 *
 * The boards are where ideas live between sessions — the repository's history
 * says what was done, the boards say what is wanted — and nothing has ever read
 * them back. A card asking for a durable home for the Fizzy token sat in the
 * inbox for days while the token lived in a chat transcript, which is the
 * failure mode this beat exists for: a board you have to remember to open is a
 * board you stop opening.
 *
 * Quiet when there is nothing to say. A Monday with an empty Next, nothing
 * stalled and an empty inbox gets no message at all.
 *
 * Env:
 *   FIZZY_URL     base URL, default the in-cluster Service
 *   FIZZY_TOKEN   a personal access token (profile → API)
 *   FIZZY_ACCOUNT the account slug in the path, default "1"
 */

import { boardsFrom, type Card } from "../copy/fizzy/board.js";
import { renderDigest, summarise } from "../copy/fizzy/digest.js";
import { escape } from "../copy/alerts/render.js";
import { describe, warmUp, withRetry } from "../retry.js";
import type { Round } from "../rounds.js";

const TIMEOUT_MS = 20_000;

export async function fizzy(round: Round, environment = process.env): Promise<void> {
  const base = environment.FIZZY_URL?.trim() || "http://fizzy.fizzy.svc.cluster.local";
  const account = environment.FIZZY_ACCOUNT?.trim() || "1";
  const token = environment.FIZZY_TOKEN?.trim();
  if (!token) throw new Error("FIZZY_TOKEN is unset");

  await warmUp(`${base}/${account}/boards.json`);

  let cards: Card[];
  try {
    cards = await withRetry(() => fetchCards(base, account, token), { what: "boards" });
  } catch (error) {
    await round.say(
      "<div><strong>📋 could not read the boards</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  const now = Date.now();
  const boards = boardsFrom(cards, now);
  process.stdout.write(`${cards.length} cards — ${summarise(boards)}\n`);

  const html = renderDigest(boards, now);
  if (html === null) {
    process.stdout.write("nothing on any board worth saying, saying nothing\n");
    return;
  }
  await round.say(html);
}

/**
 * Every open card, with its column and board.
 *
 * One request rather than a walk over columns: the documented listing endpoint
 * takes the whole account and each card carries its own board and column, so
 * the shape of every board falls out of a single answer.
 *
 * The `.json` suffix is not decoration. Without it the same path answers 401 —
 * the app treats it as a browser request and looks for a session rather than
 * the bearer token.
 */
async function fetchCards(base: string, account: string, token: string): Promise<Card[]> {
  const seen = new Map<number, Card>();

  // Open cards carry a column; the inbox is indexed separately, because a card
  // awaiting triage is in Fizzy's "Maybe?" state rather than in a column.
  for (const query of ["", "?indexed_by=maybe"]) {
    const response = await fetch(`${base}/${account}/cards.json${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`fizzy answered ${response.status} for cards.json${query}`);
    }
    const body = (await response.json()) as unknown;
    for (const card of asCards(body)) seen.set(card.number, card);
  }
  return [...seen.values()];
}

/**
 * The payload, taken at arm's length.
 *
 * A card whose shape is not what this expects is dropped rather than rendered
 * as `undefined` into a room — the same rule the briefing's coercion follows.
 */
function asCards(payload: unknown): Card[] {
  if (!Array.isArray(payload)) return [];
  const out: Card[] = [];
  for (const item of payload) {
    const raw = (item ?? {}) as Record<string, unknown>;
    const number = Number(raw["number"]);
    const title = typeof raw["title"] === "string" ? raw["title"].trim() : "";
    if (!Number.isFinite(number) || !title) continue;
    const board = (raw["board"] ?? {}) as { name?: unknown };
    const column = (raw["column"] ?? null) as { name?: unknown } | null;
    const active = Date.parse(String(raw["last_active_at"] ?? raw["created_at"] ?? ""));
    out.push({
      number,
      title,
      board: typeof board.name === "string" ? board.name : "?",
      column: column && typeof column.name === "string" ? column.name : null,
      lastActiveAt: Number.isFinite(active) ? active : Date.now(),
    });
  }
  return out;
}
