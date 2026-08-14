/**
 * What is burying you, and how fast.
 *
 * The original idea was a guilt bot: bookmarks saved and never opened,
 * articles piling up. The data said otherwise — linkding holds 44 bookmarks
 * and none of them unread, because it is a store rather than a queue. What is
 * genuinely unread is the feeds: 1,475 items across six of them.
 *
 * So this is not a nag. It is the question those 1,475 items actually pose:
 * which feeds publish more than you read? A feed that produces three hundred
 * items a fortnight and gets read never is not a backlog, it is a
 * subscription that has stopped earning its place — and that is a decision,
 * which a number alone never prompts.
 */

export interface Feed {
  readonly title: string;
  readonly unread: number;
  /** Of those, how many arrived in the last seven days. */
  readonly thisWeek: number;
}

export interface Backlog {
  readonly feeds: readonly Feed[];
  /** The oldest unread item's arrival, epoch milliseconds, or null when clear. */
  readonly oldest: number | null;
}

export function total(backlog: Backlog): number {
  return backlog.feeds.reduce((sum, feed) => sum + feed.unread, 0);
}

export function arrived(backlog: Backlog): number {
  return backlog.feeds.reduce((sum, feed) => sum + feed.thisWeek, 0);
}

/** Biggest first: the feeds doing the burying. */
export function worst(backlog: Backlog, limit = 4): Feed[] {
  return [...backlog.feeds]
    .filter((feed) => feed.unread > 0)
    .sort((a, b) => b.unread - a.unread)
    .slice(0, limit);
}

export function daysWaiting(backlog: Backlog, now: number): number | null {
  if (backlog.oldest === null) return null;
  return Math.floor((now - backlog.oldest) / 86_400_000);
}
