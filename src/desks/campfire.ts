/**
 * The Campfire desk: the answer is the HTTP response.
 *
 * Two consequences of that contract are load-bearing and neither is ours to
 * choose.
 *
 * A response that is not a 200 text reply but still carries a Content-Type is
 * turned into an *attachment*. A 500 with a Content-Type header uploads an
 * error page into the room. So every answer here is 200 `text/html`, failures
 * included, and the only silent path sends no Content-Type at all.
 *
 * The timeout is seven seconds, after which Campfire posts "Failed to respond
 * within 7 seconds" itself. Anything slower has to acknowledge now and answer
 * later — see `later`, which posts using the room path out of the payload. That
 * path already embeds the bot key, so the asynchronous reply needs no
 * credential of its own: the webhook payload *is* the credential, and it only
 * ever reaches the room the question was asked in.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { roundFrom, type Round } from "../rounds.js";
import type { Answer, Desk, Question, Serving } from "./desk.js";

/** Campfire gives up at 7s and posts its own notice. Finish well inside it. */
const BUDGET_MS = 7_000;

export interface CampfirePayload {
  readonly user?: { id?: number | string; name?: string };
  readonly room?: { name?: string; path?: string };
  readonly message?: { body?: { plain?: string } };
}

export class CampfireDesk implements Desk {
  readonly budgetMs = BUDGET_MS;

  constructor(
    private readonly port: number,
    /** Where an asynchronous reply is posted; the room path is appended. */
    private readonly base: string,
  ) {}

  async serve(answer: Answer): Promise<Serving> {
    const server = createServer((request, response) => {
      void this.handle(request, response, answer);
    });
    await new Promise<void>((resolve) => server.listen(this.port, resolve));
    return {
      port: (server.address() as { port: number }).port,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    answer: Answer,
  ): Promise<void> {
    if (request.method === "GET") {
      // Liveness only — deliberately not a cluster read. A readiness probe
      // hitting the API every ten seconds would be more traffic than the bot
      // generates, and RBAC breakage shows up in the answer anyway.
      const ok = (request.url ?? "") === "/healthz";
      response.writeHead(ok ? 200 : 404);
      response.end(ok ? "ok" : "");
      return;
    }

    let payload: CampfirePayload;
    try {
      payload = JSON.parse(await body(request)) as CampfirePayload;
    } catch (error) {
      process.stdout.write(`bad payload: ${String(error)}\n`);
      // No Content-Type: the one path that says nothing into the room.
      response.writeHead(200);
      response.end();
      return;
    }

    const question = questionFrom(payload, this.base);
    process.stdout.write(
      `${question.room}: ${question.asker.name} said ${JSON.stringify(question.words[0] ?? "")}\n`,
    );

    let html: string;
    try {
      html = await answer(question);
    } catch (error) {
      // Nothing may escape. An unhandled throw here would send a 500, which
      // Campfire uploads into the room as an attachment.
      process.stdout.write(`answer failed: ${String(error)}\n`);
      html = "<div><strong>⚠️ could not answer</strong></div>";
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  }
}

export function questionFrom(payload: CampfirePayload, base: string): Question {
  // `plain` arrives with the bot mention already stripped, so
  // "@Kubernetes status" is "status".
  const words = (payload.message?.body?.plain ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const path = payload.room?.path;
  return {
    words,
    asker: {
      id: String(payload.user?.id ?? ""),
      name: payload.user?.name ?? "?",
    },
    room: payload.room?.name ?? "?",
    later: path ? laterRound(base, path) : null,
  };
}

function laterRound(base: string, path: string): Round {
  return roundFrom({ ROOM_URL: `campfire+${base}${path}` });
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
