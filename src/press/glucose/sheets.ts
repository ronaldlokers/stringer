/**
 * The two sheets, as SVG.
 *
 * Saturday gets the fortnight: fourteen counted rows and the day this
 * fortnight typically has. Every other morning gets the smaller question a
 * single day can honestly answer — was any of it unusual — with yesterday drawn
 * over the middle half of the days before it.
 *
 * Both lead with a finding rather than a date, because a date is not news.
 */

import {
  type Band,
  type Day,
  BANDS,
  bandOf,
  hoursByBand,
  modalDay,
  timeInRange,
  valuesOf,
} from "../../copy/glucose/bands.js";
import { findings, outliers, type Finding } from "../../copy/glucose/findings.js";
import { MMOL } from "../../copy/glucose/units.js";
import { mean, fixed, percent, pstdev } from "../../numbers.js";
import { GRID, GROUND, HEIGHT, INK, MARGIN, MUTED, PAPER, RULE, WIDTH } from "../tokens.js";
import { circle, polyline, rect, text, width, wrap } from "../svg.js";
import { LAYOUT } from "./layout.js";
import {
  BAND_COLOUR,
  BAND_FILL,
  SEVERITY,
  TARGET_EDGES,
  TARGET_FILL,
  Y_MAX,
  Y_MIN,
} from "./palette.js";

const MEASURE = WIDTH - 2 * MARGIN;

export const FORTNIGHT_SOURCE = "glucose, fourteen days  ·  nightscout";
export const DAY_SOURCE = "glucose  ·  nightscout";

export function fortnightSheet(
  days: readonly Day[],
  bands: readonly Band[] = BANDS,
  extra: readonly Finding[] = [],
): string {
  const found = withExtra(findings(days, bands), extra);
  const parts: string[] = [masthead(FORTNIGHT_SOURCE, found)];
  parts.push(countedRows(days, bands));
  parts.push(typicalDay(days));
  parts.push(findingBlock(found.slice(1, 3), LAYOUT.findings));
  parts.push(foot(days.flatMap(valuesOf)));
  return document(parts.join(""));
}

export function daySheet(
  days: readonly Day[],
  bands: readonly Band[] = BANDS,
  extra: readonly Finding[] = [],
): string {
  const today = days[days.length - 1]!;
  const history = days.slice(0, -1);
  const found = withExtra(outliers(days, bands), extra);
  const head = masthead(`${today.label}  ·  ${DAY_SOURCE}`, found);
  const parts: string[] = [head.svg];

  const caption = Math.max(LAYOUT.against.caption, head.bottom + 52);
  parts.push(againstNormal(today, history, bands, caption));
  // The encouraging line rides on the hour-marks caption rather than competing
  // for the findings block, which draws two of them and would drop it every
  // day. "The sheet has room under the bar" was the request, and this is that
  // room — no extra rows, and it sits beside the marks it describes.
  const unbroken = found.find(([key]) => key === "unbroken");
  parts.push(dayMarks(today, bands, unbroken?.[1]));
  parts.push(
    findingBlock(
      found.filter(([key]) => key !== "unbroken").slice(1, 3),
      LAYOUT.dayFindings,
    ),
  );
  parts.push(foot(valuesOf(today)));
  return document(parts.join(""));
}

/**
 * Findings the sheet was handed rather than computed — today, the sensor's age,
 * which needs the raw readings and their gaps rather than days of values.
 *
 * Placed second, never first: the headline is the most consequential thing the
 * data says, and how old the sensor is has never been that. Second is where
 * the drawn block starts, so it is seen rather than dropped.
 */
function withExtra(found: readonly Finding[], extra: readonly Finding[]): Finding[] {
  if (!extra.length) return [...found];
  return [found[0]!, ...extra, ...found.slice(1)];
}

// --- pieces ----------------------------------------------------------------

interface Masthead {
  readonly svg: string;
  readonly bottom: number;
}

/**
 * The finding leads, over as many lines as it needs.
 *
 * Its length is not knowable when the layout is written — it is a computed
 * sentence — so clipping it at a fixed two lines cut sentences mid-word.
 */
function masthead(source: string, found: readonly Finding[]): Masthead & string {
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
  const bottom = LAYOUT.headlineBaseline + (lines.length - 1) * LAYOUT.headlineStep;
  // Returned as a string so the fortnight sheet can ignore the measurement.
  return Object.assign(svg, { svg, bottom }) as Masthead & string;
}

/**
 * One row per day, newest first, hours sorted into bands.
 *
 * Sorted rather than left in clock order on purpose: sorted, the length of the
 * green run *is* the time in range, and a length can be counted. Clock order
 * would make this a heatmap, where the eye estimates shading instead.
 */
function countedRows(days: readonly Day[], bands: readonly Band[]): string {
  const { top, height, mark, gap, labelX, marksX } = LAYOUT.rows;
  const out: string[] = [];
  [...days].reverse().forEach((day, index) => {
    const y = top + index * height;
    const newest = index === 0;
    const ink = newest ? INK : MUTED;
    out.push(text(labelX, y + mark - 4, "small", day.label, ink));
    const hours = hoursByBand(day.readings, bands)
      .filter((name): name is NonNullable<typeof name> => name !== null)
      .sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b));
    let x = marksX;
    for (const name of hours) {
      out.push(rect(x, y, mark, mark, BAND_COLOUR[name]));
      x += mark + gap;
    }
    out.push(text(x + 16, y + mark - 4, "figure", `${percent(timeInRange(valuesOf(day)))}%`, ink));
    if (newest) out.push(rect(MARGIN, y + mark + 6, MEASURE, 1, RULE));

    // A rule between the two weeks: the split, without a figure crowding the
    // day's own percentage at the right edge.
    const perWeek = Math.floor(days.length / 2);
    if (perWeek >= 3 && (index + 1) % perWeek === 0 && index + 1 < days.length) {
      out.push(rect(MARGIN, y + mark + 6, MEASURE, 1, RULE));
    }
  });

  // The two weeks compared, on their own line beneath the rows.
  //
  // The findings have said this in words since the first version — "this week,
  // 71% in range, up 5 points on the week before" — and the rows, which are the
  // part actually looked at, showed nothing of it. Drawn at the right edge of
  // each week it collided with that day's own percentage: "85%94%", which is
  // two true numbers and one unreadable sheet.
  const perWeek = Math.floor(days.length / 2);
  if (perWeek >= 3) {
    const ordered = [...days].reverse();
    const recent = timeInRange(ordered.slice(0, perWeek).flatMap(valuesOf));
    const older = timeInRange(ordered.slice(perWeek, perWeek * 2).flatMap(valuesOf));
    const move = (recent - older) * 100;
    const direction = move >= 0 ? "up" : "down";
    out.push(
      text(
        MARGIN,
        top + days.length * height + 14,
        "small",
        `this week ${percent(recent)}% · the week before ${percent(older)}% · ` +
          `${direction} ${fixed(Math.abs(move), 0)}`,
        MUTED,
      ),
    );
  }
  return out.join("");
}

function plotScale(top: number, bottom: number, inset: number) {
  return (value: number): number => {
    const clamped = Math.max(Y_MIN, Math.min(Y_MAX, value));
    return bottom - inset - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (bottom - top - 2 * inset);
  };
}

/** The one idea worth taking from the report every CGM product ships. */
function typicalDay(days: readonly Day[]): string {
  const { caption, top, bottom } = LAYOUT.typical;
  const left = MARGIN;
  const right = WIDTH - MARGIN;
  const y = plotScale(top, bottom, 14);
  const out = [
    text(left, caption, "body", "a typical day, drawn from all fourteen", INK),
    rect(left, top, MEASURE, bottom - top, PAPER),
    rect(left, y(180), MEASURE, y(70) - y(180), TARGET_FILL),
  ];

  const band = modalDay(days);
  if (band.length) {
    const step = MEASURE / band.length;
    for (const slot of band) {
      const x = left + (slot.minute / 1440) * MEASURE;
      out.push(rect(x, y(slot.high), step + 1, y(slot.low) - y(slot.high), BAND_FILL));
    }
    out.push(...trace(band.map((slot) => [left + (slot.minute / 1440) * MEASURE, y(slot.median), slot.median] as const), 3.4));
  }

  out.push(...axis(left, right, top, bottom, y));
  return out.join("");
}

/**
 * Yesterday's trace over the band its own history draws.
 *
 * The shaded band is the middle half of the previous days at that time of day;
 * the line leaving it is the only thing the reader has to look for.
 */
function againstNormal(
  today: Day,
  history: readonly Day[],
  bands: readonly Band[],
  caption: number,
): string {
  const top = Math.max(LAYOUT.against.top, caption + 20);
  const bottom = LAYOUT.against.bottom;
  const left = MARGIN;
  const right = WIDTH - MARGIN;
  const y = plotScale(top, bottom, 16);

  const out = [
    text(
      left,
      caption,
      "body",
      `yesterday, against the middle half of the last ${history.length} days`,
      INK,
    ),
    rect(left, top, MEASURE, bottom - top, PAPER),
    rect(left, y(180), MEASURE, y(70) - y(180), TARGET_FILL),
  ];

  const band = history.length ? modalDay(history) : [];
  if (band.length) {
    const step = MEASURE / band.length;
    for (const slot of band) {
      const x = left + (slot.minute / 1440) * MEASURE;
      out.push(rect(x, y(slot.high), step + 1, y(slot.low) - y(slot.high), BAND_FILL));
    }
  }

  const points = today.readings.map(
    ([minute, value]) => [left + (minute / 1440) * MEASURE, y(value), value] as const,
  );
  out.push(...trace(points, 3.4, bands, (20 / 1440) * MEASURE));
  out.push(...axis(left, right, top, bottom, y));
  return out.join("");
}

/**
 * The trace, in runs of one colour.
 *
 * Only readings adjacent in time are joined: a gap where the sensor dropped out
 * should read as a gap, not as a straight line through values that were never
 * measured.
 */
function trace(
  points: readonly (readonly [number, number, number])[],
  stroke: number,
  bands: readonly Band[] = BANDS,
  maxGap = Infinity,
): string[] {
  const out: string[] = [];
  let run: [number, number][] = [];
  let colour = "";
  const flush = () => {
    if (run.length > 1) out.push(polyline(run, colour, stroke));
    run = [];
  };
  let previousX: number | null = null;
  for (const [x, y, value] of points) {
    const next = BAND_COLOUR[bandOf(value, bands)];
    if (previousX !== null && x - previousX > maxGap) flush();
    if (next !== colour) {
      // Carry the joining point into the new run so the colours meet.
      const carry = run.length ? run[run.length - 1] : undefined;
      flush();
      colour = next;
      if (carry) run.push(carry);
    }
    run.push([x, y]);
    previousX = x;
  }
  flush();
  return out;
}

function axis(
  left: number,
  right: number,
  top: number,
  bottom: number,
  y: (value: number) => number,
): string[] {
  const out: string[] = [];
  for (const edge of TARGET_EDGES) {
    out.push(rect(left, y(edge), right - left, 1, RULE));
    const label = fixed(edge / MMOL, 1);
    // A pad the trace can pass behind without eating the number.
    out.push(rect(left + 4, y(edge) - 34, width("small", label) + 12, 32, PAPER));
    out.push(text(left + 10, y(edge) - 10, "small", label, MUTED));
  }
  for (const hour of [6, 12, 18]) {
    const x = left + (hour / 24) * (right - left);
    out.push(rect(x, top, 1, bottom - top, GRID));
    out.push(text(x + 10, bottom - 12, "small", String(hour).padStart(2, "0"), MUTED));
  }
  return out;
}

/** The day as counted hours, so both sheets speak the same language. */
function dayMarks(today: Day, bands: readonly Band[], encouragement?: string): string {
  const top = LAYOUT.dayMarks;
  const mark = 26;
  const gap = 8;
  const hours = hoursByBand(today.readings, bands)
    .filter((name): name is NonNullable<typeof name> => name !== null)
    .sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b));
  const out = [text(MARGIN, top - 14, "body", "the day, hour by hour", INK)];
  if (encouragement) {
    out.push(
      text(WIDTH - MARGIN, top - 14, "small", encouragement, MUTED, { anchor: "end" }),
    );
  }
  let x = MARGIN;
  for (const name of hours) {
    out.push(rect(x, top, mark, mark, BAND_COLOUR[name]));
    x += mark + gap;
  }
  return out.join("");
}

/**
 * Each finding takes the height its own text needs, and stops at the foot.
 *
 * These are computed sentences of unknowable length, so a fixed row height is
 * a collision waiting for the day the wording runs long. There are two of
 * those: a second line landing on the finding below, and the block as a whole
 * growing down into the figures — which happens whenever the first finding
 * wraps, and was shipped and running in the implementation this replaces.
 *
 * A finding that does not fit is dropped rather than drawn over the foot. They
 * arrive in order of consequence, so the one lost is the least consequential,
 * and one finding legible beats two on top of each other.
 */
function findingBlock(items: readonly Finding[], start: number): string {
  const out: string[] = [];
  let top = start;
  for (const [key, sentence] of items) {
    const lines = wrap("body", sentence, WIDTH - MARGIN - 250);
    const height = LAYOUT.findingStep + (lines.length - 1) * 34;
    // How far this finding's *ink* reaches, not how far it advances the next
    // one. Measuring the advance drops a finding that fits comfortably: the
    // row is 70 tall but the last baseline sits 40 below its rule, and only
    // that has to clear the foot.
    const ink = top + 40 + (lines.length - 1) * 34 + 12;
    if (ink > LAYOUT.foot) break;
    out.push(rect(MARGIN, top, MEASURE, 1, RULE));
    out.push(text(MARGIN, top + 40, "body", key, BAND_COLOUR["in range"]));
    lines.forEach((line, index) => {
      out.push(text(250, top + 40 + index * 34, "body", line, INK));
    });
    top += height;
  }
  return out.join("");
}

function foot(values: readonly number[]): string {
  const average = mean(values);
  const cells: [string, string][] = [
    ["time in range", `${percent(timeInRange(values))}%`],
    ["average", fixed(average / MMOL, 1)],
    // Glucose Management Indicator, the standard estimate of HbA1c from mean
    // glucose. Defined on mg/dL, hence the unconverted mean.
    ["gmi", `${fixed(3.31 + 0.02392 * average, 1)}%`],
    ["spread", fixed(pstdev(values) / MMOL, 1)],
  ];
  const out = [rect(MARGIN, LAYOUT.foot, MEASURE, 2, INK)];
  cells.forEach(([label, value], index) => {
    const x = MARGIN + index * (MEASURE / 4);
    out.push(text(x, LAYOUT.foot + 40, "small", label, MUTED));
    out.push(text(x, LAYOUT.foot + 92, "stat", value, INK));
  });
  return out.join("");
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

export { circle };
