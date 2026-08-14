/**
 * Retrying a first connection, and saying what actually went wrong.
 *
 * **A newly started pod cannot reach anything for its first half-second or so,
 * and then can reach everything.** Measured in production, from a pod carrying
 * a beat's own labels, polling two services in turn:
 *
 *   first target polled    000, 000, 000, 200   (~0.9s)
 *   second target polled   200                  (immediate)
 *
 * The second target was the one that had just been failing when it was polled
 * first, which is what rules out the destination, its namespace and its node —
 * all three were tried and none of them predicted the failure. What predicts it
 * is being the pod's *first* outbound connection.
 *
 * So the retry is not waiting for a particular destination to admit this pod;
 * it is waiting for the pod's own egress path to come up. Anything that makes
 * one successful connection first — an init container, an earlier request —
 * absorbs it instead.
 *
 * `fetch` reports all of it as `TypeError: fetch failed` and hides the detail
 * on `error.cause`, so a log that stringifies the error says nothing at all.
 * Three runs were misdiagnosed that way, twice by me. `describe` unwraps it.
 */

const ATTEMPTS = 3;
/**
 * Short, because the recovery is immediate. Five seconds was inherited from a
 * beat that assumed it was waiting for a controller to catch up; the second
 * attempt succeeds as soon as it is made.
 */
const DELAY_MS = 750;

export interface RetryOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  /** What is being reached, for the log line. */
  readonly what?: string;
}

export async function withRetry<T>(
  attempt: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? ATTEMPTS;
  const delayMs = options.delayMs ?? DELAY_MS;
  const what = options.what ?? "request";
  let last: unknown;
  for (let round = 0; round < attempts; round += 1) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
      if (round + 1 < attempts) {
        process.stdout.write(
          `${what} attempt ${round + 1} failed (${describe(error)}), retrying\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw last;
}

/**
 * An error worth reading.
 *
 * `fetch` throws `TypeError: fetch failed` for a refused connection, a DNS
 * failure, a TLS error and a timeout alike; which one it was lives on `cause`,
 * usually as a Node error with a `code` like ECONNREFUSED or EAI_AGAIN.
 */
export function describe(error: unknown): string {
  const text = String(error);
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (!cause) return text;
  const code = (cause as { code?: string }).code;
  return code ? `${text}: ${code}` : `${text}: ${String(cause)}`;
}
