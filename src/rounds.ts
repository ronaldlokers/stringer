/**
 * Delivery.
 *
 * A round is what the paper goes out on. It knows nothing about glucose or
 * Renovate, and the desks know nothing about Campfire — which is the whole
 * point of the split: the bots were never really Campfire bots, they were
 * bots with about ten lines of Campfire in them.
 */

import { withRetry } from "./retry.js";

/** What a round hands back, so a beat can come back to what it said. */
export interface Posted {
  /** A handle this transport can amend later, or null if it cannot. */
  readonly id: string | null;
}

export interface Round {
  /** Post words. */
  say(html: string): Promise<Posted>;
  /** Post a picture. Some mornings this is the entire post. */
  show(png: Uint8Array, filename: string): Promise<Posted>;
  /**
   * Change something already said, quietly where the transport allows it.
   *
   * Not every destination can. Where one cannot, this posts anew and returns
   * the new handle, so a beat never has to ask which happened — it gets a
   * handle back either way and uses it next time.
   *
   * The difference is not cosmetic where it exists. Campfire's message update
   * does not call `room.receive`, so an amendment reaches nobody's phone,
   * which is exactly what a resolution should do. A transport without it turns
   * every amendment into a fresh notification; that is the honest degradation,
   * not a bug.
   */
  amend(id: string, html: string): Promise<Posted>;
}

const NOWHERE: Posted = { id: null };

class CampfireRound implements Round {
  constructor(private readonly url: string) {}

  async say(html: string): Promise<Posted> {
    const response = await send(this.url, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
    });
    await expectOk(response);
    return { id: messageIdFrom(response.headers.get("location")) };
  }

  async show(png: Uint8Array, filename: string): Promise<Posted> {
    // The same bot route takes either: Campfire permits `attachment` when the
    // multipart form carries one and falls back to the raw body otherwise.
    const form = new FormData();
    form.append("attachment", pngBlob(png), filename);
    const response = await send(this.url, { method: "POST", body: form });
    await expectOk(response);
    return { id: messageIdFrom(response.headers.get("location")) };
  }

  async amend(id: string, html: string): Promise<Posted> {
    const response = await send(`${this.url}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
    });
    if (response.ok) return { id };
    // 404 is the message having been deleted by hand. Anything else is
    // unexpected, and in both cases a new message beats no message.
    process.stdout.write(`amend of ${id} failed (${response.status}), posting instead\n`);
    return this.say(html);
  }
}

/**
 * The id out of the Location header a create answers with.
 *
 * Campfire's create is `head :created, location: message_url(@message)` — an
 * empty body and a URL — so the id is the last path segment rather than a
 * field in a JSON response.
 */
export function messageIdFrom(location: string | null): string | null {
  const match = /\/(\d+)\D*$/.exec(location ?? "");
  return match ? match[1]! : null;
}

class NtfyRound implements Round {
  constructor(private readonly url: string) {}

  async say(html: string): Promise<Posted> {
    await expectOk(
      await send(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/html", Markdown: "no" },
        body: html,
      }),
    );
    return NOWHERE;
  }

  async show(png: Uint8Array, filename: string): Promise<Posted> {
    await expectOk(
      await send(this.url, {
        method: "PUT",
        headers: { Filename: filename },
        body: pngBlob(png),
      }),
    );
    return NOWHERE;
  }

  /** ntfy has no notion of editing what it delivered, so this posts anew. */
  async amend(_id: string, html: string): Promise<Posted> {
    return this.say(html);
  }
}

/** Prints instead of posting. What tests and a dry run use. */
class StdoutRound implements Round {
  async say(html: string): Promise<Posted> {
    process.stdout.write(`${html}\n`);
    return NOWHERE;
  }

  async show(png: Uint8Array, filename: string): Promise<Posted> {
    process.stdout.write(`[${filename}: ${png.byteLength} bytes]\n`);
    return NOWHERE;
  }

  async amend(id: string, html: string): Promise<Posted> {
    process.stdout.write(`[amending ${id}] ${html}\n`);
    return { id };
  }
}

/** A Blob rather than the array itself: `fetch` wants a BodyInit, and a
 *  Uint8Array over a possibly-shared buffer is not one. */
function pngBlob(png: Uint8Array): Blob {
  return new Blob([png as BlobPart], { type: "image/png" });
}

/**
 * A request that survives one bad connection.
 *
 * Every beat reaches its own source through `withRetry`, and then handed the
 * result to a delivery layer that got exactly one attempt — so a beat could
 * gather a week of data perfectly and lose it to a single refused socket. Three
 * beats did, on their first scheduled run, and the log said only
 * `TypeError: fetch failed` because nothing unwrapped the cause.
 *
 * Only the transport is retried. A response that arrives with a bad status is
 * returned as it is: a 401 is a wrong token and a 404 is a wrong room, and
 * asking either of them twice more just delays the error by a second and a half.
 *
 * A retry can in principle post twice — if the request reached Campfire and the
 * *response* was lost. That needs the failure to land in the window between the
 * server committing and the client reading, which is far narrower than the
 * window this closes, and a duplicate digest is a worse outcome than a missing
 * one only in the sense that you have to read it twice.
 */
function send(url: string, init: RequestInit): Promise<Response> {
  return withRetry(() => fetch(url, init), { what: `${init.method ?? "GET"} ${hostOf(url)}` });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function expectOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
}

/**
 * Pick a round from a URL's scheme: `campfire+https://…`, `ntfy+https://…`,
 * or `stdout:`.
 *
 * `CAMPFIRE_URL` is still read, so a room's Secret can move one bot at a time
 * rather than all of them on one evening.
 */
export function roundFrom(environment: NodeJS.ProcessEnv = process.env): Round {
  const url = environment.ROOM_URL?.trim();
  if (!url) {
    const legacy = environment.CAMPFIRE_URL?.trim();
    if (legacy) return new CampfireRound(legacy);
    return new StdoutRound();
  }
  if (url === "stdout:") return new StdoutRound();

  const split = url.indexOf("+");
  if (split < 0) throw new Error(`ROOM_URL needs a transport prefix: ${url}`);
  const transport = url.slice(0, split);
  const target = url.slice(split + 1);
  switch (transport) {
    case "campfire":
      return new CampfireRound(target);
    case "ntfy":
      return new NtfyRound(target);
    default:
      throw new Error(`unknown transport: ${transport}`);
  }
}
