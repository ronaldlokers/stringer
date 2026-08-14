/**
 * The collage, as SVG.
 *
 * The press has never carried a photograph before — every other sheet draws
 * marks it computed. So this is the one place where the house style gets out of
 * the way: ground, type and margin stay, and the middle of the sheet is given
 * over entirely to the pictures.
 *
 * Photographs are embedded as data URIs and cropped to fill their cells
 * (`preserveAspectRatio="slice"`), because a grid of letterboxed rectangles in
 * assorted proportions reads as a contact sheet rather than as a memory.
 */

import type { Photo } from "../../copy/immich/memories.js";
import { GROUND, HEIGHT, INK, MARGIN, MUTED, RULE, WIDTH } from "../tokens.js";
import { rect, text, width } from "../svg.js";

const MEASURE = WIDTH - 2 * MARGIN;

/** A photograph and the bytes to draw it with. */
export interface Framed {
  readonly photo: Photo;
  /** JPEG bytes, as fetched from Immich's thumbnail endpoint. */
  readonly jpeg: Uint8Array;
}

export const SOURCE = "on this day  ·  immich";

/**
 * Two across, three down, filling the sheet.
 *
 * Three shapes were tried against real days. Three-by-two left a third of the
 * sheet empty. Three-by-three fitted nine, and at the ~339 CSS px Campfire
 * shows this at, nine cells is a mosaic — texture where there should be faces.
 * Six landscape cells is the most of a day that stays legible on a phone.
 */
const GRID = { top: 246, gap: 16, columns: 2, rows: 3 } as const;
const BOTTOM = 1150;

export function collageSheet(framed: readonly Framed[], today: Date): string {
  const cell = (MEASURE - GRID.gap * (GRID.columns - 1)) / GRID.columns;
  const cellHeight = (BOTTOM - GRID.top - GRID.gap * (GRID.rows - 1)) / GRID.rows;

  const parts: string[] = [
    text(MARGIN, 64, "small", SOURCE, MUTED),
    rect(MARGIN, 82, MEASURE, 2, INK),
    text(MARGIN, 150, "headline", headline(today), INK),
  ];

  framed.slice(0, GRID.columns * GRID.rows).forEach((item, index) => {
    const column = index % GRID.columns;
    const row = Math.floor(index / GRID.columns);
    const x = MARGIN + column * (cell + GRID.gap);
    const y = GRID.top + row * (cellHeight + GRID.gap);
    const base64 = Buffer.from(item.jpeg).toString("base64");
    parts.push(
      `<image x="${x}" y="${y}" width="${cell}" height="${cellHeight}" ` +
        `preserveAspectRatio="xMidYMid slice" ` +
        `href="data:image/jpeg;base64,${base64}"/>`,
    );
    // The year, on a plate in the corner: over the photograph it is unreadable
    // against a bright sky, and beneath it costs a row of grid.
    const label = String(item.photo.year);
    const plateWidth = width("small", label) + 20;
    parts.push(rect(x, y + cellHeight - 34, plateWidth, 34, GROUND));
    parts.push(text(x + 10, y + cellHeight - 10, "small", label, INK));
  });

  return document(parts.join(""));
}

function headline(today: Date): string {
  const day = today.getUTCDate();
  const month = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ][today.getUTCMonth()]!;
  return `${day} ${month}, in other years`;
}

function document(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    rect(0, 0, WIDTH, HEIGHT, GROUND) +
    body +
    "</svg>"
  );
}
