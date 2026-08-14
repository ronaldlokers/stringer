/**
 * What the boards are holding, and which of it has stopped moving.
 *
 * Fizzy is where ideas go between sessions: the repository's history says what
 * was done, the boards say what is wanted. Nothing has ever read them back,
 * which is how a card asking for a durable home for the Fizzy token sat in the
 * inbox while the token lived in a chat transcript.
 *
 * The digest answers three questions and no others: what is next, what has
 * stalled, and what was written down and never triaged.
 */

/** A card, in the fields this actually uses. */
export interface Card {
  readonly number: number;
  readonly title: string;
  readonly board: string;
  /** The column's name, or null for a card still awaiting triage. */
  readonly column: string | null;
  /** Epoch milliseconds. */
  readonly lastActiveAt: number;
}

export interface Board {
  readonly name: string;
  readonly next: readonly Card[];
  readonly inProgress: readonly Card[];
  readonly stalled: readonly Card[];
  readonly untriaged: readonly Card[];
}

/**
 * How long in progress is too long.
 *
 * Three weeks, because a fortnight is a holiday and a month is a decision. A
 * card that has not been touched in three weeks is either finished and unmoved
 * or abandoned and unadmitted, and both are worth a line.
 */
export const STALE_DAYS = 21;

export function days(from: number, to: number): number {
  return Math.floor((to - from) / 86_400_000);
}

export function boardsFrom(cards: readonly Card[], now: number): Board[] {
  const names = [...new Set(cards.map((card) => card.board))].sort();
  return names.map((name) => {
    const mine = cards.filter((card) => card.board === name);
    const inProgress = mine.filter((card) => card.column === "In progress");
    return {
      name,
      next: mine.filter((card) => card.column === "Next"),
      inProgress,
      stalled: inProgress.filter((card) => days(card.lastActiveAt, now) >= STALE_DAYS),
      // A card with no column is in the inbox. Fizzy calls that state "Maybe?",
      // which is a kinder name for the same thing.
      untriaged: mine.filter((card) => card.column === null),
    };
  });
}

/** Oldest first: the ones that have been waiting longest are the news. */
export function oldest(cards: readonly Card[], count: number): Card[] {
  return [...cards].sort((a, b) => a.lastActiveAt - b.lastActiveAt).slice(0, count);
}
