/**
 * What this beat's colours mean, and the extent it draws over.
 *
 * The bands are the one piece of the category's vocabulary kept deliberately —
 * green reads in range, warm reads high, red reads low — and the only part of
 * the design that is not free to change. Everything else about the sheets is a
 * decision; this is a constraint.
 *
 * Stepped so neighbouring bands differ in lightness as well as hue: an earlier
 * palette put `low` and `in range` 2.2 ΔE apart under deuteranopia, which on a
 * chart about hypoglycaemia is a defect rather than a preference.
 */

export const BAND_COLOUR = {
  "very low": "#96191e",
  low: "#d67a7a",
  "in range": "#2e7d4f",
  high: "#e8a33d",
  "very high": "#d1622a",
} as const;

/** Worst last, so a sorted row reads outward from the trouble. */
export const SEVERITY = ["in range", "high", "very high", "low", "very low"] as const;

export const TARGET_FILL = "#ced6c4";
export const BAND_FILL = "#c4ccba";

/**
 * Fixed vertical extent: a flat day should look flat, not fill the frame. The
 * ceiling is the top of the "high" band — above it the readings are rare and
 * the space they reserve is stolen from the few mmol either side of target,
 * which is the part actually read.
 */
export const Y_MIN = 40;
export const Y_MAX = 14 * 18.0182;
export const TARGET_EDGES = [70, 180] as const;
