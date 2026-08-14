/**
 * Retrying a first connection, and saying what actually went wrong.
 *
 * The first connection a fresh pod makes to a *cross-namespace* destination is
 * refused, and the next one succeeds. Measured in production rather than
 * assumed: from a pod carrying a beat's own labels, `campfire.campfire` (same
 * namespace) answered in 1ms, while `prometheus-speedtest.monitoring` refused
 * the first attempt in 4ms and answered the second. The pod's own policy is
 * programmed by the time it runs, so the older explanation — "the NetworkPolicy
 * is still being written" — is not what this is.
 *
 * `fetch` reports every one of these as `TypeError: fetch failed` and hides the
 * detail on `error.cause`, so a log that stringifies the error says nothing at
 * all. Two runs were misdiagnosed that way. `describe` unwraps it.
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
