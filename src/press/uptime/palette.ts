/**
 * What this beat's colours mean.
 *
 * The house rule survives a third tenant unchanged: green means "as it should
 * be". Here that is a day on which every check was answered — not a day that
 * was mostly fine. The ordinary day on this sheet is a perfect one, so a green
 * that also covered 99.6% would turn thirty days into an unbroken field with
 * the interesting ones hidden inside it, which is the heatmap DESIGN.md refuses.
 *
 * The ramp is the speedtest one: shortfall against what was promised, in the
 * house's stepped lightness. A reader who has seen the Sunday sheet is not
 * learning a second vocabulary on the 1st.
 */

import type { BandName } from "../../copy/uptime/month.js";

export const BAND_COLOUR: Record<BandName, string> = {
  perfect: "#2e7d4f",
  nearly: "#7f9a5c",
  patchy: "#e8a33d",
  bad: "#d1622a",
  /**
   * A day the endpoint was not watched — added mid-month, or beyond what the
   * store still holds. Absence drawn as absence, never as a failure: the
   * speedtest sheet colours a missing hour the same way and for the same
   * reason.
   */
  missing: "#c4beb0",
};

/** The field the rows of marks sit on, matching every other sheet's plot card. */
export const FIELD_FILL = "#ded9cd";
