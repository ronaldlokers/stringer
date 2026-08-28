/**
 * Retrying a first connection, and reporting what failed.
 *
 * `fetch` throws `TypeError: fetch failed` for a refused connection, a DNS
 * failure and a timeout alike, with the detail hidden on `cause`. Two
 * production runs were misdiagnosed from a log line that stringified the
 * error and so said nothing at all.
 */

import assert from "node:assert/strict";
import { Throttled } from "../src/copy/cluster/kube.js";
import { describe as report, warmUp, withRetry } from "../src/retry.js";
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

  it("waits as long as the server asked, not as long as it planned to", async () => {
    // The whole point: a 429 carries a Retry-After, and retrying inside it
    // spends another share of the budget to be refused again.
    let calls = 0;
    const started = Date.now();
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new Throttled("HTTP 429 for /apis", 120);
        return "ok";
      },
      { delayMs: 5_000 },
    );
    assert.equal(value, "ok");
    const waited = Date.now() - started;
    assert.ok(waited >= 100, `waited ${waited}ms, which is less than the 120ms asked for`);
    assert.ok(waited < 1_000, `waited ${waited}ms, which is the planned delay rather than the asked one`);
  });

  it("keeps its own delay for an error that asks for nothing", async () => {
    let calls = 0;
    const started = Date.now();
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw refused();
        return "ok";
      },
      { delayMs: 120 },
    );
    const waited = Date.now() - started;
    assert.ok(waited >= 100, `waited ${waited}ms, so the configured delay was not used`);
  });

  it("ignores a retry-after that is not a positive number", async () => {
    // A negative or zero wait is not advice, it is a header worth distrusting:
    // honoured literally it turns the retry into an immediate second refusal.
    let calls = 0;
    const started = Date.now();
    const error = Object.assign(new Error("odd"), { retryAfterMs: -1 });
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw error;
        return "ok";
      },
      { delayMs: 150 },
    );
    const waited = Date.now() - started;
    assert.ok(waited >= 130, `waited ${waited}ms, so a negative retry-after was obeyed`);
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

describe("warming up", () => {
  it("returns quietly when the first connection works", async () => {
    const server = await listenOnce();
    try {
      await warmUp(server.url, 500);
    } finally {
      await server.close();
    }
  });

  it("never throws when nothing answers, because the real request reports", async () => {
    // Port 1 on localhost: refused immediately, four times over.
    await warmUp("http://127.0.0.1:1/", 100);
  });
});

async function listenOnce(): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = await import("node:http");
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
