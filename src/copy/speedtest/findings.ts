/**
 * What the week actually says, in sentences.
 *
 * The rule the glucose beat set holds here: findings describe and never
 * instruct. "The connection held all week" is a fact; whether that is worth
 * paying for is not this program's business.
 *
 * A quiet week still gets a sheet — this is a record, not an alarm — so the
 * leading sentence has to be true and worth reading on the many Sundays when
 * nothing went wrong. "The internet was fine" every week teaches the reader to
 * stop opening it, so the headline carries the figure that varies even when
 * nothing breaks: how much of what was bought actually arrived.
 */

import { fixed, percent } from "../../numbers.js";
import {
  bandOf,
  median,
  megabits,
  missed,
  share,
  tests,
  type Day,
  type Plan,
} from "./week.js";

/** A label and a sentence, as the sheet prints them. */
export type Finding = readonly [string, string];

export function findings(days: readonly Day[], plan: Plan): Finding[] {
  const all = tests(days);
  if (!all.length) {
    return [["no tests", "nothing was recorded this week, so there is nothing to report"]];
  }

  const downs = all.map((test) => test.down);
  const ups = all.map((test) => test.up);
  const pings = all.map((test) => test.ping);
  const typical = median(downs);
  const out: Finding[] = [];

  // Both numbers, one unit, no ratio: "93% of the gigabit" makes the reader
  // hold a percentage and a noun at once, and is not how anyone says this out
  // loud. Two figures side by side make the comparison themselves.
  out.push([
    `${fixed(megabits(typical), 0)}`,
    `of the ${fixed(megabits(plan.down), 0)} Mbps you pay for, on a typical test`,
  ]);

  /**
   * The middle findings arrive in order of consequence, because the sheet has
   * room for two of them and drops the rest.
   *
   * Ordering them by how they were written put "15 tests under 90%" above an
   * upload sitting at 61% of a symmetric plan — the smaller fact above the
   * whole week's story, on the sheet where the second one was then dropped for
   * want of a line. So each carries how far from as-sold it is, and the
   * furthest goes first.
   */
  const weighted: [number, Finding][] = [];

  const slow = all.filter((test) => bandOf(test.down, plan.down) !== "full");
  if (slow.length) {
    const worst = slow.reduce((a, b) => (a.down < b.down ? a : b));
    weighted.push([
      1 - share(worst.down, plan.down),
      [
        `${slow.length} ${slow.length === 1 ? "test" : "tests"}`,
        `came in under ${percent(0.9)}% of the line, the slowest at ` +
          `${fixed(megabits(worst.down), 0)} Mbps`,
      ],
    ]);
  } else {
    weighted.push([0, ["every test", `was within ${percent(0.1)}% of the line, all week`]]);
  }

  // Upload is where a symmetric plan quietly stops being symmetric, and it is
  // the half nobody watches until a backup takes all night.
  const typicalUp = median(ups);
  weighted.push([
    1 - share(typicalUp, plan.up),
    [
      `${fixed(megabits(typicalUp), 0)} up`,
      // "the same N" only where it is the same number. On an asymmetric plan
      // that phrasing would quietly claim a symmetry the bill never sold.
      plan.up === plan.down
        ? `against the same ${fixed(megabits(plan.up), 0)} in the other direction, ` +
          "on a typical test"
        : `against the ${fixed(megabits(plan.up), 0)} Mbps sold upward, on a typical test`,
    ],
  ]);

  const gaps = days.reduce((total, day) => total + missed(day), 0);
  if (gaps) {
    weighted.push([
      gaps / (days.length * 24),
      [
        `${gaps} ${gaps === 1 ? "hour" : "hours"}`,
        "had no test at all, so this week is counted over " +
          `${all.length} of a possible ${days.length * 24}`,
      ],
    ]);
  }

  weighted.sort((a, b) => b[0] - a[0]);
  out.push(...weighted.map(([, finding]) => finding));

  // Last regardless: a ping this stable is the least consequential thing here,
  // and it is only news on the week it stops being true.
  out.push([
    `${fixed(median(pings), 1)} ms`,
    `is the typical ping; the worst this week was ${fixed(Math.max(...pings), 1)} ms`,
  ]);

  return out;
}

