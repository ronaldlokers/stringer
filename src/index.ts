#!/usr/bin/env node
/**
 * `stringer <beat>` — work one beat, once.
 *
 * A beat is the territory one reporter covers; the copy it files goes out on
 * whatever round the environment names. The CronJob passes the beat as its
 * only argument.
 */

import { alerts } from "./beats/alerts.js";
import { briefing } from "./beats/briefing.js";
import { fizzy } from "./beats/fizzy.js";
import { glucose } from "./beats/glucose.js";
import { hello } from "./beats/hello.js";
import { renovate } from "./beats/renovate.js";
import { speedtest } from "./beats/speedtest.js";
import { status } from "./beats/status.js";
import { roundFrom } from "./rounds.js";
import type { Round } from "./rounds.js";

const BEATS: Record<string, (round: Round) => Promise<void>> = {
  alerts,
  briefing,
  fizzy,
  glucose,
  hello,
  renovate,
  speedtest,
  status,
};

async function main(): Promise<number> {
  const name = process.argv[2];
  const beat = name ? BEATS[name] : undefined;
  if (!beat) {
    const known = Object.keys(BEATS).join(", ");
    process.stderr.write(`usage: stringer <${known}>\n`);
    return 2;
  }
  try {
    await beat(roundFrom());
    return 0;
  } catch (error) {
    // Say so rather than failing quietly: a desk that stops filing is
    // indistinguishable from a morning nobody looked at.
    process.stderr.write(`${name} failed: ${String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main();
