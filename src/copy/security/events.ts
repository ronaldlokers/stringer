/**
 * The authentik events worth interrupting someone for.
 *
 * This is a household of one, and the numbers say so: about thirty events a
 * quarter, of which one was a failed login. A weekly digest of that would read
 * "one login this week", which is not information anybody was missing.
 *
 * So it is exception-only. Everything here is something you would want to know
 * within the hour — a failed sign-in, a password changed, a user edited — and
 * everything else is left in authentik's own log where it belongs.
 */

export interface Event {
  readonly action: string;
  readonly at: number;
  /** Whatever the event names as its subject: a username, an application. */
  readonly who: string;
  readonly from: string;
}

/**
 * The watchlist.
 *
 * `login` is deliberately absent. Logging in is what the system is for, and a
 * bot that announces every successful sign-in is a bot you mute — after which
 * it cannot tell you about the failures either.
 */
export const WATCHED = [
  "login_failed",
  "password_set",
  "user_write",
  "model_deleted",
  "impersonation_started",
  "suspicious_request",
] as const;

export function notable(events: readonly Event[]): Event[] {
  return events.filter((event) => (WATCHED as readonly string[]).includes(event.action));
}

/** How each action reads in a room, where "user_write" means nothing. */
const PHRASE: Record<string, string> = {
  login_failed: "failed sign-in",
  password_set: "password changed",
  user_write: "user edited",
  model_deleted: "something deleted",
  impersonation_started: "impersonation started",
  suspicious_request: "suspicious request",
};

export function phrase(action: string): string {
  return PHRASE[action] ?? action.replace(/_/g, " ");
}
