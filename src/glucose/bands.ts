/**
 * The consensus bands, and the arithmetic that sorts readings into them.
 *
 * Thresholds are the international consensus targets in the mg/dL that
 * Nightscout stores, whatever the display units say:
 *
 *   very low  < 3.0    low  3.0-3.8    in range  3.9-10.0
 *   high  10.1-13.9    very high  > 13.9      (mmol/L)
 */

export type BandName = "very low" | "low" | "in range" | "high" | "very high";

export interface Band {
  readonly name: BandName;
  readonly low: number;
  readonly high: number;
}

export const BANDS: readonly Band[] = [
  { name: "very low", low: 0, high: 53 },
  { name: "low", low: 54, high: 69 },
  { name: "in range", low: 70, high: 180 },
  { name: "high", low: 181, high: 250 },
  { name: "very high", low: 251, high: 10_000 },
];

/** A reading and how far into the day it was taken, in minutes. */
export type Reading = readonly [minute: number, mgdl: number];

export interface Day {
  readonly label: string;
  readonly readings: readonly Reading[];
}

/** 70% in range is the consensus target; the findings hang off it. */
export const TARGET = 0.7;

export function bandOf(value: number, bands: readonly Band[] = BANDS): BandName {
  for (const band of bands) {
    if (value >= band.low && value <= band.high) return band.name;
  }
  return "very high";
}

export function timeInRange(values: readonly number[]): number {
  return values.filter((value) => value >= 70 && value <= 180).length / values.length;
}

export function valuesOf(day: Day): number[] {
  return day.readings.map(([, value]) => value);
}

/**
 * Twenty-four hours, each labelled by the band it mostly sat in, or null where
 * the sensor sat out.
 *
 * Ties go to the band seen first, which is the order the readings arrived —
 * the same rule the Python `max(counts, key=counts.get)` follows, and worth
 * stating because it is invisible in both.
 */
export function hoursByBand(
  readings: readonly Reading[],
  bands: readonly Band[] = BANDS,
): (BandName | null)[] {
  const out: (BandName | null)[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const window = readings.filter(
      ([minute]) => minute >= hour * 60 && minute < (hour + 1) * 60,
    );
    if (window.length === 0) {
      out.push(null);
      continue;
    }
    const counts = new Map<BandName, number>();
    for (const [, value] of window) {
      const name = bandOf(value, bands);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let best: BandName | null = null;
    let seen = 0;
    for (const [name, count] of counts) {
      if (count > seen) {
        best = name;
        seen = count;
      }
    }
    out.push(best);
  }
  return out;
}

/** Mean mg/dL for each hour of a day, or null where the sensor sat out. */
export function hourMeans(readings: readonly Reading[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const window = readings
      .filter(([minute]) => minute >= hour * 60 && minute < (hour + 1) * 60)
      .map(([, value]) => value);
    out.push(
      window.length
        ? window.reduce((total, value) => total + value, 0) / window.length
        : null,
    );
  }
  return out;
}

export interface ModalSlot {
  readonly minute: number;
  readonly low: number;
  readonly median: number;
  readonly high: number;
}

/**
 * The median day and the middle half around it, across a set of days.
 *
 * What the body typically does at eight in the morning is a different question
 * from what it did yesterday, and only this can answer it.
 */
export function modalDay(days: readonly Day[], slots = 48): ModalSlot[] {
  const span = 1440 / slots;
  const out: ModalSlot[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const window: number[] = [];
    for (const day of days) {
      for (const [minute, value] of day.readings) {
        if (minute >= slot * span && minute < (slot + 1) * span) window.push(value);
      }
    }
    if (window.length === 0) continue;
    window.sort((a, b) => a - b);
    out.push({
      minute: (slot + 0.5) * span,
      low: window[Math.floor(window.length / 4)]!,
      median: window[Math.floor(window.length / 2)]!,
      high: window[Math.floor((3 * window.length) / 4)]!,
    });
  }
  return out;
}
