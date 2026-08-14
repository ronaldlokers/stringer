/**
 * Photographs taken on this date in earlier years, and which of them to show.
 *
 * The only beat here that exists to be enjoyed rather than to be useful. It
 * reports nothing, measures nothing, and on a day with no photographs it says
 * nothing at all — an occasion that arrives every morning stops being one.
 */

export interface Photo {
  readonly id: string;
  /** The year it was taken, as the sheet prints it. */
  readonly year: number;
  /** Epoch milliseconds, for ordering within a year. */
  readonly at: number;
}

/** How many fit a grid that still shows faces at Campfire's attachment size. */
export const SHOWN = 6;

/**
 * Up to six, spread across the years rather than taken from the best one.
 *
 * A round-robin, because six photographs from one afternoon in 2019 is a worse
 * morning than one from each of six years. Within a year they arrive in the
 * order they were taken, so a day reads as a day.
 */
export function choose(photos: readonly Photo[], limit = SHOWN): Photo[] {
  const byYear = new Map<number, Photo[]>();
  for (const photo of [...photos].sort((a, b) => a.at - b.at)) {
    const year = byYear.get(photo.year) ?? [];
    year.push(photo);
    byYear.set(photo.year, year);
  }

  // Newest year first: the most recent memory is the one most likely to be
  // recognised, and it earns the first cell.
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const out: Photo[] = [];
  for (let round = 0; out.length < limit; round += 1) {
    let took = false;
    for (const year of years) {
      const photo = byYear.get(year)![round];
      if (!photo) continue;
      out.push(photo);
      took = true;
      if (out.length === limit) break;
    }
    if (!took) break;
  }
  return out;
}

export function yearsOf(photos: readonly Photo[]): number[] {
  return [...new Set(photos.map((photo) => photo.year))].sort((a, b) => b - a);
}

/**
 * How many were taken that day, for the log rather than the sheet.
 *
 * The sheet used to carry it — "26 photographs, from 6 years" — and it read as
 * an inventory of something that is not an inventory. Every photograph already
 * wears its year, so the line was saying the same thing twice and in the duller
 * of the two ways.
 */
export function summarise(total: number, years: readonly number[]): string {
  return `${total} photograph${total === 1 ? "" : "s"} across ${years.length} year${years.length === 1 ? "" : "s"}`;
}
