/**
 * Delivery, and what it survives.
 *
 * Every beat retried its own source and then handed the result to a transport
 * that got one attempt. Three beats lost a first scheduled run that way — the
 * data was gathered, and the post was refused once.
 */

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { roundFrom } from "../src/rounds.js";

describe("posting to campfire", () => {
  it("survives a refused connection, which is what a beat's whole run rides on", async () => {
    // The server is started only after the first attempt has been refused, so
    // the refusal is real rather than simulated: nothing is listening yet.
    const port = await freePort();
    const posted: string[] = [];
    const round = roundFrom({ ROOM_URL: `campfire+http://127.0.0.1:${port}/messages` });

    const post = round.say("<div>morning</div>");
    const server = await listen(port, async (request, response) => {
      posted.push(await body(request));
      response.writeHead(201, { location: "/rooms/1/messages/99" });
      response.end();
    });

    try {
      const result = await post;
      assert.equal(result.id, "99");
      assert.deepEqual(posted, ["<div>morning</div>"]);
    } finally {
      await server.close();
    }
  });

  it("does not retry a bad status, because asking twice more changes nothing", async () => {
    let calls = 0;
    const server = await listen(0, (_request, response) => {
      calls += 1;
      response.writeHead(401);
      response.end();
    });
    const round = roundFrom({ ROOM_URL: `campfire+http://127.0.0.1:${server.port}/messages` });

    try {
      await assert.rejects(() => round.say("<div>hello</div>"), /401/);
      assert.equal(calls, 1);
    } finally {
      await server.close();
    }
  });
});

/** A port nothing is listening on: bound, read, released. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function listen(
  port: number,
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((request, response) => void handler(request, response));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const bound = (server.address() as { port: number }).port;
  return {
    port: bound,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
