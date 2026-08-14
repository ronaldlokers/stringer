/**
 * Where this design puts things.
 *
 * The same skeleton the glucose sheets use — source line, rule, headline
 * finding, the middle, findings, ruled foot with four exact figures — because
 * that skeleton is the house style rather than one sheet's idea. What differs
 * is the middle: seven counted rows and a week-long plot against the line the
 * plan promises.
 */

import { MARGIN } from "../tokens.js";

export const LAYOUT = {
  sourceBaseline: 64,
  ruleTop: 82,
  headlineBaseline: 150,
  headlineStep: 64,
  /** Seven rows, one per day, newest first. Both blocks share the metrics. */
  rows: { height: 34, mark: 24, gap: 6, labelX: MARGIN, marksX: 176 },
  down: { caption: 288, top: 310 },
  /**
   * The same week in the other direction, counted the same way.
   *
   * This replaced a plot of every test against the plan. Drawn from zero to a
   * gigabit, a good week is 168 bars all within a few percent of the top: a
   * solid field where the eye estimates shading, which is the heatmap this
   * design refuses. Counting the upload says more, because the upload is where
   * a symmetric plan quietly stops being symmetric.
   */
  up: { caption: 596, top: 618 },
  findings: 900,
  findingStep: 70,
  foot: 1060,
} as const;
