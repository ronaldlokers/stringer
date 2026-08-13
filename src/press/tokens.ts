/**
 * The visual system, as DESIGN.md records it.
 *
 * Every value here was decided once and written down; changing one is a design
 * decision rather than a tweak, and DESIGN.md is where the reasoning lives.
 */

export const GROUND = "#e8e4da";
export const PAPER = "#ded9cd";
export const INK = "#1a1a18";
export const MUTED = "#6e6a60";
export const RULE = "#c4beb0";
export const GRID = "#d2cdc1";
export const TARGET_FILL = "#ced6c4";
export const BAND_FILL = "#c4ccba";

/**
 * Reds below, green in range, ambers above — the one piece of the category's
 * vocabulary kept deliberately, and the only part of this file that is not
 * free to change. Stepped so neighbouring bands differ in lightness as well as
 * hue: an earlier palette put `low` and `in range` 2.2 ΔE apart under
 * deuteranopia, which on a chart about hypoglycaemia is a defect.
 */
export const BAND_COLOUR = {
  "very low": "#96191e",
  low: "#d67a7a",
  "in range": "#2e7d4f",
  high: "#e8a33d",
  "very high": "#d1622a",
} as const;

/** Worst first, so a row reads outward from the trouble. */
export const SEVERITY = ["in range", "high", "very high", "low", "very high"] as const;

/**
 * Type. URW Gothic is the Avant Garde clone and the closest widely packaged
 * face to the geometric sans the Vienna Method's charts were set in; JetBrains
 * Mono carries every figure so a column of numbers lines up as a column of
 * numbers.
 */
export const FACE = {
  gothic: "URW Gothic",
  mono: "JetBrains Mono",
} as const;

export const TYPE = {
  headline: { family: FACE.gothic, weight: 600, size: 56 },
  body: { family: FACE.gothic, weight: 400, size: 30 },
  small: { family: FACE.gothic, weight: 400, size: 26 },
  stat: { family: FACE.mono, weight: 700, size: 42 },
  figure: { family: FACE.mono, weight: 400, size: 28 },
} as const;

export type FaceName = keyof typeof TYPE;

/**
 * Campfire caps an attachment on height, at about 339x400 CSS px, which is
 * 1017x1200 device pixels on a 3x phone. 1000x1200 fills that box at 1:1, so a
 * pixel drawn is a pixel shown — and 30px of body type is about 10 CSS px on
 * the phone, which is the floor.
 */
export const WIDTH = 1000;
export const HEIGHT = 1200;
export const MARGIN = 56;

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

/** Fixed vertical extent: a flat day should look flat, not fill the frame. */
export const Y_MIN = 40;
export const Y_MAX = 14 * 18.0182;
export const TARGET_EDGES = [70, 180] as const;
