/**
 * Retrying a first connection, and reporting what failed.
 *
 * `fetch` throws `TypeError: fetch failed` for a refused connection, a DNS
 * failure and a timeout alike, with the detail hidden on `cause`. Two
 * production runs were misdiagnosed from a log line that stringified the
 * error and so said nothing at all.
 */

import assert from "node:assert/strict";
import { describe as report, withRetry } from "../src/retry.js";
import { describe, it } from "node:test";

function refused(): Error {
  const error = new TypeError("fetch failed");
  (error as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return error;
}

describe("reporting an error", () => {
  it("unwraps the cause's code, which is the whole diagnosis", () => {
    assert.equal(report(refused()), "TypeError: fetch failed: ECONNREFUSED");
  });

  it("falls back to the cause itself when it carries no code", () => {
    const error = new TypeError("fetch failed");
    (error as { cause?: unknown }).cause = new Error("socket hang up");
    assert.match(report(error), /socket hang up/);
  });

  it("says the plain thing when there is no cause", () => {
    assert.equal(report(new Error("nope")), "Error: nope");
  });
});

describe("retrying", () => {
  it("returns the first success without waiting", async () => {
    let calls = 0;
    const value = await withRetry(async () => {
      calls += 1;
      return "ok";
    });
    assert.equal(value, "ok");
    assert.equal(calls, 1);
  });

  it("survives one refusal, which is the case this exists for", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw refused();
        return "ok";
      },
      { delayMs: 1 },
    );
    assert.equal(value, "ok");
    assert.equal(calls, 2);
  });

  it("gives up after the last attempt and throws what it last saw", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw refused();
          },
          { attempts: 3, delayMs: 1 },
        ),
      /fetch failed/,
    );
    assert.equal(calls, 3);
  });
});
