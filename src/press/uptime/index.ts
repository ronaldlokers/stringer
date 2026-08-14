/** SVG in, PNG out — the same rasteriser every other sheet uses. */

import { Resvg } from "@resvg/resvg-js";

import type { Endpoint, Outage } from "../../copy/uptime/month.js";
import { WIDTH } from "../tokens.js";
import { monthSheet } from "./sheets.js";

export function renderMonth(
  endpoints: readonly Endpoint[],
  outages: readonly Outage[],
  zone: string,
): Uint8Array {
  const resvg = new Resvg(monthSheet(endpoints, outages, zone), {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}
