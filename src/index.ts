#!/usr/bin/env node
/**
 * `stringer <desk>` — run one desk, once.
 *
 * Each desk covers a beat and files to whatever round the environment names.
 * The CronJob passes the desk as its only argument.
 */

import { hello } from "./desks/hello.js";
import { roundFrom } from "./rounds.js";
import type { Round } from "./rounds.js";

const DESKS: Record<string, (round: Round) => Promise<void>> = {
  hello,
};

async function main(): Promise<number> {
  const name = process.argv[2];
  const desk = name ? DESKS[name] : undefined;
  if (!desk) {
    const known = Object.keys(DESKS).join(", ");
    process.stderr.write(`usage: stringer <${known}>\n`);
    return 2;
  }
  try {
    await desk(roundFrom());
    return 0;
  } catch (error) {
    // Say so rather than failing quietly: a desk that stops filing is
    // indistinguishable from a morning nobody looked at.
    process.stderr.write(`${name} failed: ${String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main();
