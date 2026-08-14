/** SVG in, PNG out — the same rasteriser the glucose sheets use. */

import { Resvg } from "@resvg/resvg-js";

import type { Day, Plan } from "../../copy/speedtest/week.js";
import { WIDTH } from "../tokens.js";
import { weekSheet } from "./sheets.js";

export function renderWeek(days: readonly Day[], plan: Plan): Uint8Array {
  const resvg = new Resvg(weekSheet(days, plan), {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}
