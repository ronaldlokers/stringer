/**
 * What the month says, in sentences.
 *
 * The rule holds here as everywhere: findings describe and never instruct.
 * "grafana answered four checks in five" is a fact; whether that is worth
 * fixing tonight is not this program's business.
 *
 * The headline has to be worth reading in a month where nothing broke, which
 * rules out "everything was up" — true most months and therefore unread by the
 * third one. So the lead is the spread: the worst endpoint against the rest.
 * That figure moves whether or not anything failed, and on a genuinely perfect
 * month it becomes the perfect month, stated as a count of days rather than a
 * percentage nobody can tell from 99.99%.
 */

import { fixed, percent } from "../../numbers.js";
import {
  byUptime,
  cleanDays,
  datesIn,
  longest,
  minutesOf,
  overall,
  sharedOutages,
  spell,
  uptimeOf,
  type Endpoint,
  type Outage,
} from "./month.js";

/** A label and a sentence, as the sheet prints them. */
export type Finding = readonly [string, string];

export function findings(
  endpoints: readonly Endpoint[],
  outages: readonly Outage[],
  zone: string,
): Finding[] {
  if (!endpoints.length) {
    return [["no history", "gatus has recorded nothing in this window, so there is nothing to count"]];
  }

  const out: Finding[] = [];
  const ranked = byUptime(endpoints);
  const worst = ranked[0]!;
  const days = datesIn(endpoints).length;
  const clean = cleanDays(endpoints);

  // The lead. A month where everything answered everything is reported as
  // that, because "100.00%" and "99.97%" look identical at a glance and mean
  // very different things.
  if (uptimeOf(worst) >= 1) {
    out.push(["all up", `every check answered, ${days} days running`]);
  } else {
    const rest = ranked[1];
    const gap = rest ? (uptimeOf(rest) - uptimeOf(worst)) * 100 : 0;
    out.push([
      worst.name,
      rest && gap >= 0.5
        ? `answered ${percent(uptimeOf(worst), 1)}% of its checks — the month's worst, ` +
          `${fixed(gap, 1)} points below ${rest.name}`
        : `answered ${percent(uptimeOf(worst), 1)}% of its checks, the month's worst`,
    ]);
  }

  // Then the one that changes what the numbers mean: several endpoints failing
  // in the same minutes is one outage wearing several costumes.
  const shared = sharedOutages(outages);
  const biggest = shared.slice().sort((a, b) => b.endpoints.length - a.endpoints.length)[0];
  if (biggest) {
    out.push([
      "together",
      `${biggest.endpoints.length} services went down within minutes of each other on ` +
        `${dayName(biggest.at, zone)}${shared.length > 1 ? `, one of ${shared.length} such moments` : ""}` +
        " — one outage rather than several faults",
    ]);
  }

  const worstOutage = longest(outages);
  if (worstOutage) {
    out.push([
      "longest",
      `${worstOutage.endpoint} was down ${spell(minutesOf(worstOutage))} on ` +
        `${dayName(worstOutage.from, zone)}, the longest single stretch`,
    ]);
  }

  if (clean === days) {
    out.push(["clean", `nothing failed anywhere, on any of the ${days} days`]);
  } else if (clean) {
    out.push([
      "clean days",
      `${clean} of ${days} days passed with nothing failing anywhere`,
    ]);
  }

  const slowest = [...endpoints].sort((a, b) => b.responseMs - a.responseMs)[0];
  if (slowest && slowest.responseMs > 0) {
    out.push([
      "slowest",
      `${slowest.name} answered in ${Math.round(slowest.responseMs)} ms on average, ` +
        `against ${Math.round(overall_(endpoints))} ms across everything watched`,
    ]);
  }

  return out;
}

/** The overall figure, for the foot and the sentence above. */
export function overallUptime(endpoints: readonly Endpoint[]): number {
  return overall(endpoints);
}

function overall_(endpoints: readonly Endpoint[]): number {
  const withChecks = endpoints.filter((endpoint) => endpoint.responseMs > 0);
  if (!withChecks.length) return 0;
  return withChecks.reduce((total, e) => total + e.responseMs, 0) / withChecks.length;
}

/** "3 August" — the day an outage happened, in the reader's own zone. */
export function dayName(at: number, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: zone,
  }).format(new Date(at));
}
