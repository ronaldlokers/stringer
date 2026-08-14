/** SVG in, PNG out — the same rasteriser the other sheets use. */

import { Resvg } from "@resvg/resvg-js";

import { WIDTH } from "../tokens.js";
import { collageSheet, type Framed } from "./sheet.js";

export function renderCollage(framed: readonly Framed[], today: Date): Uint8Array {
  const resvg = new Resvg(collageSheet(framed, today), {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

export type { Framed };
