/**
 * The memories beat: photographs taken on this date in earlier years.
 *
 * The only beat that exists to be enjoyed. It measures nothing, and on a day
 * with no photographs it says nothing at all — an occasion that arrives every
 * morning stops being one, which is the same reason the briefing stays quiet on
 * a green cluster.
 *
 * Env:
 *   IMMICH_URL      base URL, default the in-cluster Service
 *   IMMICH_API_KEY  a key from Account Settings → API Keys
 *   MEMORY_YEARS    how far back to look, default 10
 *   DIGEST_TIMEZONE which day "today" means
 *   DIGEST_DATE     look at this day instead of today
 */

import { choose, summarise, yearsOf, type Photo } from "../copy/immich/memories.js";
import { escape } from "../copy/alerts/render.js";
import { renderCollage, type Framed } from "../press/immich/index.js";
import { describe, warmUp, withRetry } from "../retry.js";
import { localDay, type LocalDay } from "../time.js";
import type { Round } from "../rounds.js";

const TIMEOUT_MS = 30_000;

export async function memories(round: Round, environment = process.env): Promise<void> {
  const base = environment.IMMICH_URL?.trim() || "http://immich-server.immich.svc.cluster.local:2283";
  const key = environment.IMMICH_API_KEY?.trim();
  if (!key) throw new Error("IMMICH_API_KEY is unset");
  const zone = environment.DIGEST_TIMEZONE?.trim() || "Europe/Amsterdam";
  const back = Number(environment.MEMORY_YEARS ?? "10");

  const today = environment.DIGEST_DATE?.trim()
    ? localDay(environment.DIGEST_DATE.trim(), zone)
    : localDay(new Date().toISOString().slice(0, 10), zone);

  await warmUp(`${base}/api/server/ping`);

  let photos: Photo[];
  try {
    photos = await withRetry(() => search(base, key, today, Number.isFinite(back) ? back : 10), {
      what: "immich",
    });
  } catch (error) {
    await round.say(
      "<div><strong>📷 could not look up this day</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  if (!photos.length) {
    process.stdout.write(`${today.date}: nothing from earlier years, saying nothing\n`);
    return;
  }

  const picked = choose(photos);
  process.stdout.write(
    `${today.date}: ${summarise(photos.length, yearsOf(photos))}, showing ${picked.length}\n`,
  );

  const framed: Framed[] = [];
  for (const photo of picked) {
    try {
      framed.push({ photo, jpeg: await thumbnail(base, key, photo.id) });
    } catch (error) {
      // One photograph that will not fetch is not worth losing the morning
      // over; the grid simply has one fewer.
      process.stdout.write(`skipping ${photo.id}: ${describe(error)}\n`);
    }
  }
  if (!framed.length) {
    process.stdout.write("no thumbnails could be fetched, saying nothing\n");
    return;
  }

  const png = renderCollage(framed, new Date(today.start));
  process.stdout.write(`collage ${png.byteLength} bytes\n`);
  await round.show(png, "on-this-day.png");
}

/** Every photograph taken on this day, in each of the last `back` years. */
async function search(base: string, key: string, today: LocalDay, back: number): Promise<Photo[]> {
  const [, month, day] = today.date.split("-").map(Number) as [number, number, number];
  const thisYear = Number(today.date.slice(0, 4));
  const out: Photo[] = [];

  for (let year = thisYear - 1; year >= thisYear - back; year -= 1) {
    const from = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const to = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    const response = await fetch(`${base}/api/search/metadata`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        takenAfter: from.toISOString(),
        takenBefore: to.toISOString(),
        type: "IMAGE",
        size: 100,
        withArchived: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`immich answered ${response.status} searching ${year}`);
    const body = (await response.json()) as {
      assets?: { items?: { id?: unknown; fileCreatedAt?: unknown; localDateTime?: unknown }[] };
    };
    for (const item of body.assets?.items ?? []) {
      const id = typeof item.id === "string" ? item.id : "";
      const stamp = Date.parse(String(item.localDateTime ?? item.fileCreatedAt ?? ""));
      if (!id || !Number.isFinite(stamp)) continue;
      out.push({ id, year, at: stamp });
    }
  }
  return out;
}

async function thumbnail(base: string, key: string, id: string): Promise<Uint8Array> {
  const response = await fetch(`${base}/api/assets/${id}/thumbnail?size=preview`, {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`thumbnail ${id} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
