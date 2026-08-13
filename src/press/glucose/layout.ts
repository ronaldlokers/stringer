/**
 * Where this design puts things.
 *
 * Campfire caps an attachment on height, at about 339x400 CSS px, which is
 * 1017x1200 device pixels on a 3x phone. The canvas fills that box at 1:1, so
 * a pixel drawn is a pixel shown — and 30px of body type is about 10 CSS px on
 * the phone, which is the floor everything else is sized from.
 */

import { MARGIN } from "../tokens.js";

export const LAYOUT = {
  sourceBaseline: 64,
  ruleTop: 82,
  headlineBaseline: 150,
  headlineStep: 64,
  rows: { top: 250, height: 30, mark: 22, gap: 6, labelX: MARGIN, marksX: 176 },
  typical: { caption: 712, top: 730, bottom: 880 },
  findings: 918,
  findingStep: 70,
  foot: 1060,
  against: { caption: 330, top: 350, bottom: 780 },
  dayMarks: 850,
  dayFindings: 920,
} as const;
