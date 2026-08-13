/**
 * Inbound. A round carries copy out; a desk takes a question in.
 *
 * The difference between transports here is bigger than it is for a round, and
 * one of them is load-bearing. Campfire delivers a mention by POSTing to a
 * callback URL and treats the **response body** as the bot's reply — so the
 * answer is the HTTP response, the process needs no bot key at all, and there
 * is a hard seven-second budget after which Campfire posts its own failure
 * notice over the top.
 *
 * A transport without that contract receives the question and posts the answer
 * as a new message, with no deadline worth speaking of. Both are expressible
 * here; only the first constrains what a bot may do while thinking.
 */

import type { Round } from "../rounds.js";

export interface Asker {
  /** Whatever identity the transport knows. Authorisation is the bot's call. */
  readonly id: string;
  readonly name: string;
}

export interface Question {
  /** The verb and its arguments, mention stripped, lowercased. */
  readonly words: readonly string[];
  readonly asker: Asker;
  readonly room: string;
  /**
   * Somewhere to put an answer that arrives after this one returns, or null
   * when the transport offers no way back. A bot that wants to think for
   * minutes has to check.
   */
  readonly later: Round | null;
}

export type Answer = (question: Question) => Promise<string>;

export interface Serving {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export interface Desk {
  serve(answer: Answer): Promise<Serving>;
  /**
   * How long an answer has before the transport gives up on it, or null when
   * nothing is waiting. Campfire's is seven seconds and not negotiable.
   */
  readonly budgetMs: number | null;
}
