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
  /**
   * The week as two traces, down and up, against the line the plan promises.
   *
   * An earlier version counted marks instead — one per test, in the Vienna
   * Method the glucose sheets use. It read well and was replaced anyway,
   * because the reader wanted the shape of the week rather than its tally. The
   * thing the marks did carry survives here: both directions on one field, so
   * the gap between what is sold and what arrives upward is the first thing
   * seen.
   *
   * The failed version in between was one filled bar per test on the same
   * field. That is a solid block of colour where the eye estimates shading; two
   * lines encode by position, which the eye reads exactly.
   */
  plot: { caption: 288, top: 312, bottom: 700, axis: 40 },
  /**
   * Ping, under the speeds, with the middle half of the week shaded.
   *
   * Its own field rather than a second trace on the one above: milliseconds and
   * megabits share no axis, and drawing them together would either flatten the
   * ping into the floor or invent a second scale nobody asked to read.
   */
  latency: { caption: 736, top: 758, bottom: 872 },
  findings: 912,
  findingStep: 70,
  foot: 1060,
} as const;
