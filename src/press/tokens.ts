/**
 * The house style: what every sheet this press prints has in common.
 *
 * Ground, ink and type live here because a second beat's sheet would want the
 * same ones. What a particular beat's colours *mean*, and where its design puts
 * things, belong with that beat — see `glucose/palette.ts` and
 * `glucose/layout.ts`.
 *
 * Every value was decided once and written down; changing one is a design
 * decision rather than a tweak, and DESIGN.md is where the reasoning lives.
 */

export const GROUND = "#e8e4da";
export const PAPER = "#ded9cd";
export const INK = "#1a1a18";
export const MUTED = "#6e6a60";
export const RULE = "#c4beb0";
export const GRID = "#d2cdc1";

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

