/**
 * A small SVG builder, and the one measurement it cannot do itself.
 *
 * SVG is a much better fit for this than a hand-rolled rasteriser: rectangles
 * are rectangles, the trace is a polyline, and resvg does the anti-aliasing.
 * What it does not give us is text metrics, and the sheet wraps a computed
 * sentence at 56px across a fixed measure — so widths are estimated from the
 * face's own advance ratios and checked against the rendered result in the
 * tests rather than trusted.
 */

import { ADVANCE } from "./metrics.js";
import { TYPE, type FaceName } from "./tokens.js";

export function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TextOptions {
  readonly anchor?: "start" | "middle" | "end";
  readonly opacity?: number;
}

export function text(
  x: number,
  baseline: number,
  face: FaceName,
  content: string,
  fill: string,
  options: TextOptions = {},
): string {
  const { family, weight, size } = TYPE[face];
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : "";
  const opacity = options.opacity === undefined ? "" : ` opacity="${options.opacity}"`;
  return (
    `<text x="${round(x)}" y="${round(baseline)}" font-family="${family}" ` +
    `font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor}${opacity}>` +
    `${escape(content)}</text>`
  );
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radius = 0,
): string {
  if (width <= 0 || height <= 0) return "";
  const rounded = radius ? ` rx="${radius}"` : "";
  return (
    `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" ` +
    `height="${round(height)}" fill="${fill}"${rounded}/>`
  );
}

export function polyline(points: readonly (readonly [number, number])[], stroke: string, width: number): string {
  if (points.length < 2) return "";
  const path = points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  return (
    `<polyline points="${path}" fill="none" stroke="${stroke}" ` +
    `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

export function circle(cx: number, cy: number, r: number, fill: string, opacity?: number): string {
  const alpha = opacity === undefined ? "" : ` opacity="${opacity}"`;
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}"${alpha}/>`;
}

/**
 * The real width of a string in a face.
 *
 * An unknown character advances a space rather than nothing, so an unforeseen
 * label degrades to a gap in the measurement rather than a line that overflows.
 */
export function width(face: FaceName, content: string): number {
  const table = ADVANCE[face]!;
  const space = table[" "] ?? TYPE[face].size * 0.28;
  let total = 0;
  for (const character of content) total += table[character] ?? space;
  return total;
}

/** Greedy wrap on the estimate above. */
export function wrap(face: FaceName, content: string, measure: number): string[] {
  const words = content.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (line && width(face, trial) > measure) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  lines.push(line);
  return lines;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
