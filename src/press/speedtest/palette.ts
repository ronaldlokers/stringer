/**
 * What this beat's colours mean.
 *
 * The house rule the glucose sheets set is that green means "as it should be",
 * and that survives here: a test at the speed the line was sold at is green.
 * What does *not* carry over is "warm reads high" — on this sheet high is the
 * good end, and reusing the glucose mapping would have amber meaning the
 * opposite thing on two sheets from the same press.
 *
 * So the ramp encodes shortfall rather than magnitude: further from what was
 * paid for is further from green. The hues are the house's, in the same
 * stepped lightness the glucose palette uses, so a reader who has seen one
 * sheet is not learning a second vocabulary.
 */

import type { BandName } from "../../copy/speedtest/week.js";

export const BAND_COLOUR: Record<BandName, string> = {
  full: "#2e7d4f",
  most: "#7f9a5c",
  half: "#e8a33d",
  poor: "#d1622a",
};

/** An hour with no test: absence, drawn as absence rather than as a failure. */
export const MISSED_COLOUR = "#c4beb0";

/** The plot's field, matching the glucose sheets' plot card. */
export const PLOT_FILL = "#ded9cd";

/**
 * The line the plan promises, and the floor the plot draws down to.
 *
 * The extent is fixed rather than fitted to the week: a week where everything
 * worked should look like a flat line just under the top, not like a full
 * frame of noise auto-scaled to the last three megabits.
 */
export const PLAN_LINE = "#1a1a18";
export const Y_FLOOR = 0;
