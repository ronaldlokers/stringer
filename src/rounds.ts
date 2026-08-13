/**
 * Delivery.
 *
 * A round is what the paper goes out on. It knows nothing about glucose or
 * Renovate, and the desks know nothing about Campfire — which is the whole
 * point of the split: the bots were never really Campfire bots, they were
 * bots with about ten lines of Campfire in them.
 */

export interface Round {
  /** Post words. */
  say(html: string): Promise<void>;
  /** Post a picture. Some mornings this is the entire post. */
  show(png: Uint8Array, filename: string): Promise<void>;
}

class CampfireRound implements Round {
  constructor(private readonly url: string) {}

  async say(html: string): Promise<void> {
    await expectOk(
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: html,
      }),
    );
  }

  async show(png: Uint8Array, filename: string): Promise<void> {
    // The same bot route takes either: Campfire permits `attachment` when the
    // multipart form carries one and falls back to the raw body otherwise.
    const form = new FormData();
    form.append("attachment", pngBlob(png), filename);
    await expectOk(await fetch(this.url, { method: "POST", body: form }));
  }
}

class NtfyRound implements Round {
  constructor(private readonly url: string) {}

  async say(html: string): Promise<void> {
    await expectOk(
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/html", Markdown: "no" },
        body: html,
      }),
    );
  }

  async show(png: Uint8Array, filename: string): Promise<void> {
    await expectOk(
      await fetch(this.url, {
        method: "PUT",
        headers: { Filename: filename },
        body: pngBlob(png),
      }),
    );
  }
}

/** Prints instead of posting. What tests and a dry run use. */
class StdoutRound implements Round {
  async say(html: string): Promise<void> {
    process.stdout.write(`${html}\n`);
  }

  async show(png: Uint8Array, filename: string): Promise<void> {
    process.stdout.write(`[${filename}: ${png.byteLength} bytes]\n`);
  }
}

/** A Blob rather than the array itself: `fetch` wants a BodyInit, and a
 *  Uint8Array over a possibly-shared buffer is not one. */
function pngBlob(png: Uint8Array): Blob {
  return new Blob([png as BlobPart], { type: "image/png" });
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
