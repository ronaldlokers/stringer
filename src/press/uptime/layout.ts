/**
 * Where this design puts things.
 *
 * The house skeleton — source line, rule, headline finding, the middle,
 * findings, ruled foot with four exact figures — with the middle given over to
 * counted rows: one endpoint per row, one mark per day.
 *
 * This is the Vienna answer and it is the right one here, where the speedtest
 * sheet's is not. A trace answers "when"; a tally answers "how much", and
 * uptime is a how-much question asked thirty times per service. It also happens
 * to be the shape the store keeps its data in — a day at a time, once the
 * hourly rows are merged — so nothing is invented to draw it.
 *
 * Seventeen rows is more than any other sheet carries, so the row height is
 * computed from what is left rather than fixed here: a row pitch that fitted
 * seventeen endpoints would waste half the field at eight, and one that fitted
 * eight would run through the foot at seventeen.
 */

import { MARGIN, WIDTH } from "../tokens.js";

export const LAYOUT = {
  sourceBaseline: 64,
  ruleTop: 82,
  headlineBaseline: 150,
  headlineStep: 64,
  /** Where the field of marks may start, if the headline leaves room. */
  gridTop: 300,
  /** The label column, wide enough for the longest endpoint name in view. */
  labelWidth: 232,
  /** The percentage at the right-hand end of each row. */
  figureWidth: 104,
  /** A row is never taller than this, however few endpoints there are. */
  maxRow: 44,
  /** Room under the marks for the two date labels, reserved before sizing. */
  axisRoom: 52,
  findingStep: 70,
  foot: 1060,
} as const;

/** The marks' own column: what is left between the label and the percentage. */
export const MARKS_LEFT = MARGIN + LAYOUT.labelWidth;
export const MARKS_WIDTH = WIDTH - MARGIN - LAYOUT.figureWidth - MARKS_LEFT;
