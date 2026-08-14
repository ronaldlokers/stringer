/**
 * The weekly sheet, as SVG.
 *
 * Two blocks of counted rows: seven days down, seven days up, each test a mark
 * and each mark placed by how much of the line it delivered. The length of the
 * green run is the number of hours that arrived as sold, and a length can be
 * counted — which is the whole argument for this press over an average.
 *
 * The upload block earns its place by being where the news usually is. A
 * symmetric plan stops being symmetric quietly, and a fortnight of 61% upstream
 * is invisible in any figure that averages the two directions.
 *
 * It leads with a finding rather than a date, because a date is not news.
 */

import { findings, type Finding } from "../../copy/speedtest/findings.js";
import {
  bandOf,
  median,
  megabits,
  missed,
  share,
  tests,
  SEVERITY,
  type BandName,
  type Day,
  type Plan,
} from "../../copy/speedtest/week.js";
import { fixed, percent } from "../../numbers.js";
import { GROUND, HEIGHT, INK, MARGIN, MUTED, RULE, WIDTH } from "../tokens.js";
import { rect, text, width, wrap } from "../svg.js";
import { LAYOUT } from "./layout.js";
import { BAND_COLOUR, MISSED_COLOUR } from "./palette.js";

const MEASURE = WIDTH - 2 * MARGIN;

export const WEEK_SOURCE = "internet, seven days  ·  speedtest tracker";

export function weekSheet(days: readonly Day[], plan: Plan): string {
  const found = findings(days, plan);
  const parts: string[] = [masthead(WEEK_SOURCE, found)];
  parts.push(
    countedRows(days, plan.down, (test) => test.down, LAYOUT.down, `down, against the ${planWord(plan.down)}`),
  );
  parts.push(
    countedRows(days, plan.up, (test) => test.up, LAYOUT.up, `up, against the same line`),
  );
  parts.push(findingBlock(found.slice(1, 3), LAYOUT.findings));
  parts.push(foot(days, plan));
  return document(parts.join(""));
}

// --- pieces ----------------------------------------------------------------

/** The finding leads, over as many lines as it needs. */
function masthead(source: string, found: readonly Finding[]): string {
  const [key, sentence] = found[0]!;
  const lines = wrap("headline", `${key} ${sentence}`, MEASURE).slice(0, 3);
  return (
    text(MARGIN, LAYOUT.sourceBaseline, "small", source, MUTED) +
    rect(MARGIN, LAYOUT.ruleTop, MEASURE, 2, INK) +
    lines
      .map((line, index) =>
        text(MARGIN, LAYOUT.headlineBaseline + index * LAYOUT.headlineStep, "headline", line, INK),
      )
      .join("")
  );
}

/**
 * One row per day, newest first, tests sorted into bands worst last.
 *
 * An hour with no test gets a mark too, in the rule colour. Leaving it out
 * would quietly shorten the row and make a day the tracker slept through look
 * like a day with fewer problems.
 */
function countedRows(
  days: readonly Day[],
  ceiling: number,
  valueOf: (test: Day["tests"][number]) => number,
  place: { readonly caption: number; readonly top: number },
  caption: string,
): string {
  const { height, mark, gap, labelX, marksX } = LAYOUT.rows;
  const out: string[] = [text(MARGIN, place.caption, "body", caption, INK)];

  [...days].reverse().forEach((day, index) => {
    const y = place.top + index * height;
    const newest = index === 0;
    const ink = newest ? INK : MUTED;
    out.push(text(labelX, y + mark - 4, "small", day.label, ink));

    const bands: BandName[] = day.tests
      .map((test) => bandOf(valueOf(test), ceiling))
      .sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b));

    let x = marksX;
    for (const band of bands) {
      out.push(rect(x, y, mark, mark, BAND_COLOUR[band]));
      x += mark + gap;
    }
    for (let hour = 0; hour < missed(day); hour += 1) {
      out.push(rect(x, y, mark, mark, MISSED_COLOUR));
      x += mark + gap;
    }

    const values = day.tests.map(valueOf);
    const figure = values.length ? `${percent(share(median(values), ceiling))}%` : "—";
    out.push(text(WIDTH - MARGIN, y + mark - 4, "figure", figure, ink, { anchor: "end" }));
    if (newest) out.push(rect(MARGIN, y + mark + 8, MEASURE, 1, RULE));
  });
  return out.join("");
}

/** Each finding takes the height its own text needs, and stops at the foot. */
function findingBlock(items: readonly Finding[], start: number): string {
  const out: string[] = [];
  let top = start;
  for (const [key, sentence] of items) {
    const lines = wrap("body", sentence, WIDTH - MARGIN - 250);
    const height = LAYOUT.findingStep + (lines.length - 1) * 34;
    // How far this finding's ink reaches, not how far it advances the next one
    // — the same measurement the glucose sheet had to be corrected to.
    const ink = top + 40 + (lines.length - 1) * 34 + 12;
    if (ink > LAYOUT.foot) break;
    out.push(rect(MARGIN, top, MEASURE, 1, RULE));
    out.push(text(MARGIN, top + 40, "body", key, BAND_COLOUR.full));
    lines.forEach((line, index) => {
      out.push(text(250, top + 40 + index * 34, "body", line, INK));
    });
    top += height;
  }
  return out.join("");
}

function foot(days: readonly Day[], plan: Plan): string {
  const all = tests(days);
  const downs = all.map((test) => test.down);
  const ups = all.map((test) => test.up);
  const pings = all.map((test) => test.ping);
  const cells: [string, string][] = [
    ["typical down", all.length ? fixed(megabits(median(downs)), 0) : "—"],
    ["typical up", all.length ? fixed(megabits(median(ups)), 0) : "—"],
    ["slowest", all.length ? fixed(megabits(Math.min(...downs)), 0) : "—"],
    ["ping", all.length ? fixed(median(pings), 1) : "—"],
  ];
  const out = [rect(MARGIN, LAYOUT.foot, MEASURE, 2, INK)];
  cells.forEach(([label, value], index) => {
    const x = MARGIN + index * (MEASURE / 4);
    out.push(text(x, LAYOUT.foot + 40, "small", label, MUTED));
    out.push(text(x, LAYOUT.foot + 92, "stat", value, INK));
  });
  // The units once, on the label row: three of these are megabits and the
  // fourth is milliseconds, and repeating either four times costs more room
  // than it earns. Not below the figures — a baseline there sits 8px off the
  // canvas edge and loses its descenders.
  out.push(
    text(WIDTH - MARGIN, LAYOUT.foot + 40, "small", "mbps · ms", MUTED, { anchor: "end" }),
  );
  return out.join("");
}

function planWord(bits: number): string {
  return bits === 1_000_000_000 ? "gigabit it is sold as" : `${fixed(megabits(bits), 0)} Mbps sold`;
}

function document(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    rect(0, 0, WIDTH, HEIGHT, GROUND) +
    body +
    "</svg>"
  );
}

export { width };
