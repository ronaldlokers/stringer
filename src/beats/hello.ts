/**
 * The first desk: it files nothing but proves the wire.
 *
 * Phase one of the migration exists to answer one question — does an image
 * built here run on both clusters — and this is what answers it. It goes when
 * the first real desk arrives.
 */

import { hoursIn, localDay, yesterday } from "../time.js";
import type { Round } from "../rounds.js";

export async function hello(round: Round, environment = process.env): Promise<void> {
  const zone = environment.DIGEST_TIMEZONE?.trim() || "Europe/Amsterdam";
  const day = environment.DIGEST_DATE?.trim()
    ? localDay(environment.DIGEST_DATE.trim(), zone)
    : yesterday(new Date(), zone);

  // If the zone database is missing this reports a 24-hour day on a day that
  // was not 24 hours long, which is exactly the failure phase one is here to
  // rule out.
  await round.say(
    `<div><strong>stringer</strong></div>` +
      `<div>${day.date} in ${zone} was ${hoursIn(day)} hours long.</div>`,
  );
}
