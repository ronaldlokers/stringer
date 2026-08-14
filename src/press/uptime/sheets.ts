/**
 * The monthly sheet, as SVG.
 *
 * Seventeen rows of thirty marks. A row is a service, a mark is a day, and the
 * length of the green run is how long that service went without failing a
 * check — which is the number the reader actually wants and the one no
 * dashboard ever states.
 *
 * Read down a column instead and it answers the other question: a vertical
 * stripe of amber is the day the cluster wobbled, and it is visibly a *column*
 * rather than seventeen separate misfortunes. That is the finding the
 * per-endpoint percentages hide, and getting it for free from the arrangement
 * is why this is a grid and not seventeen bars.
 *
 * Bars from 0 to 100% were considered and refused for the reason DESIGN.md
 * already records against the speedtest sheet's first version: everything sits
 * within a few percent of the top, so it is a solid block of colour where the
 * eye estimates shading.
 */

import { percent } from "../../numbers.js";
import { findings, type Finding } from "../../copy/uptime/findings.js";
import {
  bandOf,
  byUptime,
  datesIn,
  dayOn,
  longest,
  minutesOf,
  overall,
  spell,
  uptimeOf,
  type Endpoint,
  type Outage,
} from "../../copy/uptime/month.js";
import { GROUND, HEIGHT, INK, MARGIN, MUTED, RULE, WIDTH } from "../tokens.js";
import { rect, text, width, wrap } from "../svg.js";
import { LAYOUT, MARKS_LEFT, MARKS_WIDTH } from "./layout.js";
import { BAND_COLOUR, FIELD_FILL } from "./palette.js";

const MEASURE = WIDTH - 2 * MARGIN;

export function monthSource(days: number): string {
  return `uptime, ${days} days  ·  gatus`;
}

export function monthSheet(
  endpoints: readonly Endpoint[],
  outages: readonly Outage[],
  zone: string,
): string {
  const found = findings(endpoints, outages, zone);
  const dates = datesIn(endpoints);
  const head = masthead(monthSource(dates.length), found);
  const parts: string[] = [head.svg];

  // Both ends are computed sentences, so the grid is given what is left rather
  // than a fixed band. The first version fixed the grid and let the finding
  // fall where it may; a three-line headline pushed the rows down, the finding
  // ran into the foot, and the overrun rule dropped it — a sheet quietly
  // missing the one line that explains the picture.
  const top = Math.max(LAYOUT.gridTop, head.bottom + 52);
  const block = findingBlock(found.slice(1, 2));
  parts.push(theGrid(endpoints, dates, top, block.top - LAYOUT.axisRoom));
  parts.push(block.svg);
  parts.push(foot(endpoints, outages, dates.length));
  return document(parts.join(""));
}

// --- pieces ----------------------------------------------------------------

/** The finding leads, over as many lines as it needs. */
function masthead(source: string, found: readonly Finding[]): { svg: string; bottom: number } {
  const [key, sentence] = found[0]!;
  const lines = wrap("headline", `${key} ${sentence}`, MEASURE).slice(0, 3);
  const svg =
    text(MARGIN, LAYOUT.sourceBaseline, "small", source, MUTED) +
    rect(MARGIN, LAYOUT.ruleTop, MEASURE, 2, INK) +
    lines
      .map((line, index) =>
        text(MARGIN, LAYOUT.headlineBaseline + index * LAYOUT.headlineStep, "headline", line, INK),
      )
      .join("");
  return { svg, bottom: LAYOUT.headlineBaseline + (lines.length - 1) * LAYOUT.headlineStep };
}

/**
 * The month, counted.
 *
 * Worst service at the top, because the sheet is read from the top and the
 * worst row is the news. Every row covers the same dates in the same columns —
 * a service added mid-month draws grey where it did not yet exist rather than
 * shifting its marks left, which would put two different days in one column and
 * destroy the only thing the vertical reading is good for.
 */
function theGrid(
  endpoints: readonly Endpoint[],
  dates: readonly string[],
  top: number,
  bottom: number,
): string {
  const out: string[] = [];
  const rows = byUptime(endpoints);
  if (!rows.length || !dates.length) return "";

  // No lower clamp on the pitch. A minimum that seventeen rows could not honour
  // is how the date labels were pushed off the sheet: the rows have to fit the
  // room there is, and if a future cluster watches forty things the marks get
  // thinner rather than the axis getting lost.
  const pitch = Math.min(LAYOUT.maxRow, (bottom - top) / rows.length);
  const cell = MARKS_WIDTH / dates.length;
  // A hairline of ground between marks, so thirty of them read as thirty
  // rather than as a bar. At a narrow pitch the gap goes before the mark does.
  const gap = cell > 14 ? 2 : 1;
  const markHeight = Math.max(6, pitch - 8);

  out.push(rect(MARKS_LEFT - 8, top - 6, MARKS_WIDTH + 16, rows.length * pitch + 12, FIELD_FILL));

  rows.forEach((endpoint, index) => {
    const y = top + index * pitch;
    const baseline = y + markHeight - Math.max(0, (markHeight - 20) / 2);

    out.push(text(MARGIN, baseline, "small", endpoint.name, INK));
    dates.forEach((date, column) => {
      const day = dayOn(endpoint, date);
      out.push(
        rect(
          MARKS_LEFT + column * cell,
          y,
          Math.max(1, cell - gap),
          markHeight,
          BAND_COLOUR[bandOf(day)],
        ),
      );
    });
    out.push(
      text(WIDTH - MARGIN, baseline, "figure", `${percent(uptimeOf(endpoint), 1)}%`, MUTED, {
        anchor: "end",
      }),
    );
  });

  // The ends of the window, named once under the marks. Every column is a day
  // and there is no room to label thirty of them; what the reader needs is
  // which end is which. Room for this is reserved before the grid is sized, so
  // it cannot be squeezed out by a long headline.
  const axis = top + rows.length * pitch + 30;
  out.push(text(MARKS_LEFT, axis, "small", shortDate(dates[0]!), MUTED));
  out.push(
    text(WIDTH - MARGIN - LAYOUT.figureWidth, axis, "small", shortDate(dates[dates.length - 1]!), MUTED, {
      anchor: "end",
    }),
  );
  return out.join("");
}

/**
 * The finding, sat directly above the foot however many lines it takes.
 *
 * The other sheets start their findings at a fixed height and drop any that
 * would reach the figures. Here the block is measured first and the grid takes
 * what is left, so a three-line finding costs the rows a little height instead
 * of costing the sheet the finding. `top` is where it begins, which is what the
 * grid needs to know.
 */
function findingBlock(items: readonly Finding[]): { svg: string; top: number } {
  const wrapped = items.map(
    ([key, sentence]) => [key, wrap("body", sentence, WIDTH - MARGIN - 250)] as const,
  );
  const lines = wrapped.reduce((total, [, body]) => total + body.length, 0);
  if (!lines) return { svg: "", top: LAYOUT.foot };

  const height = wrapped.length * LAYOUT.findingStep + (lines - wrapped.length) * 34;
  const start = LAYOUT.foot - height;

  const out: string[] = [];
  let top = start;
  for (const [key, body] of wrapped) {
    out.push(rect(MARGIN, top, MEASURE, 1, RULE));
    out.push(text(MARGIN, top + 40, "body", key, BAND_COLOUR.perfect));
    body.forEach((line, index) => {
      out.push(text(250, top + 40 + index * 34, "body", line, INK));
    });
    top += LAYOUT.findingStep + (body.length - 1) * 34;
  }
  return { svg: out.join(""), top: start };
}

function foot(
  endpoints: readonly Endpoint[],
  outages: readonly Outage[],
  days: number,
): string {
  const worstOutage = longest(outages);
  const cells: [string, string][] = [
    ["uptime", endpoints.length ? `${percent(overall(endpoints), 2)}%` : "—"],
    ["longest outage", worstOutage ? spell(minutesOf(worstOutage)) : "—"],
    ["watched", String(endpoints.length)],
    ["days", String(days)],
  ];
  const out = [rect(MARGIN, LAYOUT.foot, MEASURE, 2, INK)];
  cells.forEach(([label, value], index) => {
    const x = MARGIN + index * (MEASURE / 4);
    out.push(text(x, LAYOUT.foot + 40, "small", label, MUTED));
    out.push(text(x, LAYOUT.foot + 92, "stat", value, INK));
  });
  return out.join("");
}

/** "27 jul" — enough to place the end of the window without a year nobody doubts. */
function shortDate(date: string): string {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const [, month, day] = date.split("-") as [string, string, string];
  return `${Number(day)} ${months[Number(month) - 1] ?? month}`;
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

export { width };
