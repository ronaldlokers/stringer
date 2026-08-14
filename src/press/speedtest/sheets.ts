/**
 * The weekly sheet, as SVG.
 *
 * One field, both directions, traced over the week against the line the plan
 * promises. The gap between the two traces is the finding a symmetric plan
 * hides — the first real week read 93% down and 61% up — and it is a gap you
 * see rather than a pair of numbers you compare.
 *
 * An earlier version counted marks instead, fourteen rows of them, in the
 * Vienna Method the glucose sheets use. It read well and was replaced anyway:
 * on this subject the reader wants the shape of the week, not its tally. See
 * DESIGN.md, which records both that and the filled-bar version before it.
 *
 * It leads with a finding rather than a date, because a date is not news.
 */

import { findings, type Finding } from "../../copy/speedtest/findings.js";
import { median, megabits, tests, type Day, type Plan } from "../../copy/speedtest/week.js";
import { fixed } from "../../numbers.js";
import { GRID, GROUND, HEIGHT, INK, MARGIN, MUTED, RULE, WIDTH } from "../tokens.js";
import { polyline, rect, text, width, wrap } from "../svg.js";
import { LAYOUT } from "./layout.js";
import { BAND_COLOUR, PLAN_LINE, PLOT_FILL } from "./palette.js";

const MEASURE = WIDTH - 2 * MARGIN;

/** Room above the plan, so its line sits inside the field and can be read. */
const HEADROOM = 1.08;

export const WEEK_SOURCE = "internet, seven days  ·  speedtest tracker";

export function weekSheet(days: readonly Day[], plan: Plan): string {
  const found = findings(days, plan);
  const head = masthead(WEEK_SOURCE, found);
  const parts: string[] = [head.svg];
  // The headline is a computed sentence, so how far down it reaches is not
  // knowable when the layout is written. The plot follows it rather than
  // sitting at a fixed height a three-line headline draws straight through.
  parts.push(theWeek(days, plan, Math.max(LAYOUT.plot.caption, head.bottom + 46)));
  parts.push(findingBlock(found.slice(1, 3), LAYOUT.findings));
  parts.push(foot(days, plan));
  return document(parts.join(""));
}

// --- pieces ----------------------------------------------------------------

/** The finding leads, over as many lines as it needs. */
function masthead(source: string, found: readonly Finding[]): { svg: string; bottom: number } {
  const [key, sentence] = found[0]!;
  const lines = wrap("headline", `${key} ${sentence}`, MEASURE).slice(0, 3);
  const svg =
    text(MARGIN, LAYOUT.sourceBaseline, "small", source, MUTED) +
    rect(MARGIN, LAYOUT.ruleTop, MEASURE, 2, INK) +
    lines
      .map((line, index) =>
        text(MARGIN, LAYOUT.headlineBaseline + index * LAYOUT.headlineStep, "headline", line, INK),
      )
      .join("");
  return { svg, bottom: LAYOUT.headlineBaseline + (lines.length - 1) * LAYOUT.headlineStep };
}

/**
 * The week, both directions, against the line the plan promises.
 *
 * Fixed extent from nothing to the plan, never fitted to the week: what is
 * being read is the distance between the trace and the top, so the top has to
 * mean the same thing every Sunday. A week where everything worked is a line
 * riding just under the plan, and a bad night is a notch — not a full frame of
 * noise auto-scaled to the last three megabits.
 *
 * Two traces rather than one per sheet because the gap between them is the
 * finding a symmetric plan hides: 93% down and 61% up is one picture, and two
 * sheets would make it an inference.
 */
function theWeek(days: readonly Day[], plan: Plan, caption: number): string {
  const { top: fixedTop, bottom, axis } = LAYOUT.plot;
  const top = Math.max(fixedTop, caption + 24);
  const left = MARGIN;
  const field = bottom - axis;
  const all = tests(days);

  const out: string[] = [
    text(left, caption, "body", `the week against the ${planWord(plan.down)}`, INK),
    rect(left, top, MEASURE, field - top, PLOT_FILL),
  ];
  if (!all.length) return out.join("");

  // Time, not test index: an hour the tracker missed should read as a gap in
  // the week rather than quietly compressing the days around it.
  const start = all[0]!.at;
  const end = all[all.length - 1]!.at;
  const span = Math.max(end - start, 1);
  const x = (at: number): number => left + ((at - start) / span) * MEASURE;
  // A little headroom above the plan, so the line it promises is a line inside
  // the field rather than the field's own top edge.
  const y = (value: number, ceiling: number): number =>
    field - Math.max(0, Math.min(1, value / (ceiling * HEADROOM))) * (field - top);

  // Day boundaries first, so the traces sit over them.
  days.forEach((day, index) => {
    const first = day.tests[0];
    if (!first) return;
    const at = x(first.at);
    if (at > left && at < left + MEASURE) out.push(rect(at, top, 1, field - top, GRID));
    // The first day starts at the field's edge and gets no rule, but it still
    // gets its name: an unlabelled seventh of the week is the day a notch is
    // hardest to place.
    out.push(text(Math.min(at + 8, left + MEASURE - 90), field + 30, "small", day.label, MUTED));
  });

  // What was paid for, and the 90% below it that counts as delivered. Labelled
  // inside the field: the caption above already says what the line is, and
  // repeating it there collided with it.
  for (const [value, label, colour] of [
    [plan.down, planFigure(plan.down), PLAN_LINE],
    [plan.down * 0.9, "90%", GRID],
    [plan.down * 0.5, "50%", GRID],
  ] as const) {
    const at = y(value, plan.down);
    out.push(rect(left, at, MEASURE, colour === PLAN_LINE ? 2 : 1, colour));
    // A pad the traces pass behind without eating the number: the down line
    // rides at 90-93% all week, which is exactly where the 90% label sits.
    // The glucose axis solved this the same way.
    out.push(rect(left + 4, at - 32, width("small", label) + 12, 30, PLOT_FILL));
    out.push(text(left + 10, at - 10, "small", label, MUTED));
  }

  out.push(...trace(all.map((t) => [x(t.at), y(t.down, plan.down)] as const), BAND_COLOUR.full));
  out.push(...trace(all.map((t) => [x(t.at), y(t.up, plan.up)] as const), BAND_COLOUR.half));

  // Named at the right-hand end, where each line finishes, rather than in a
  // legend the eye has to carry back to the plot.
  const lastTest = all[all.length - 1]!;
  out.push(
    text(left + MEASURE, y(lastTest.down, plan.down) - 14, "small", "down", BAND_COLOUR.full, {
      anchor: "end",
    }),
  );
  out.push(
    text(left + MEASURE, y(lastTest.up, plan.up) - 14, "small", "up", BAND_COLOUR.half, {
      anchor: "end",
    }),
  );
  return out.join("");
}

/**
 * A trace, broken where the week is.
 *
 * Only tests adjacent in time are joined: an hour with no test should read as a
 * gap, not as a straight line through a speed nobody measured. The same rule
 * the glucose trace follows, for the same reason.
 */
function trace(points: readonly (readonly [number, number])[], colour: string): string[] {
  const out: string[] = [];
  const maxGap = (2 / 168) * MEASURE;
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 1) out.push(polyline(run, colour, 2.6));
    else if (run.length === 1) out.push(rect(run[0]![0] - 1.3, run[0]![1] - 1.3, 2.6, 2.6, colour));
    run = [];
  };
  let previous: number | null = null;
  for (const [px, py] of points) {
    if (previous !== null && px - previous > maxGap) flush();
    run.push([px, py]);
    previous = px;
  }
  flush();
  return out;
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

/** The plan as a figure on an axis, where the word would not fit. */
function planFigure(bits: number): string {
  return `${fixed(megabits(bits), 0)}`;
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
