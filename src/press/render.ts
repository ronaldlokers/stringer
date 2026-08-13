/** SVG in, PNG out. */

import { Resvg } from "@resvg/resvg-js";

import type { Band, Day } from "../copy/glucose/bands.js";
import { daySheet, fortnightSheet } from "./sheets.js";
import { WIDTH } from "./tokens.js";

function rasterise(svg: string): Uint8Array {
  const resvg = new Resvg(svg, {
    // The canvas is already the size Campfire shows it at, so no scaling.
    fitTo: { mode: "width", value: WIDTH },
    // Named families, resolved from the fonts installed in the image.
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

export function renderFortnight(days: readonly Day[], bands?: readonly Band[]): Uint8Array {
  return rasterise(fortnightSheet(days, bands));
}

export function renderDay(days: readonly Day[], bands?: readonly Band[]): Uint8Array {
  return rasterise(daySheet(days, bands));
}
