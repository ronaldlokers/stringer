/**
 * What is growing, and how long the disks have left.
 *
 * The briefing can say a volume is nearly full; it cannot say a volume will be
 * full in March, because that needs history rather than a reading. The 400-day
 * Prometheus has the history, so this is the question it was really built for.
 *
 * A forecast is a straight line through the past, which is wrong in the way all
 * forecasts are wrong: it assumes next month resembles last month. It earns its
 * place anyway, because the alternative — noticing at 95% — is worse, and
 * because the sentence it produces is falsifiable. When the line says fourteen
 * weeks and the disk fills in six, the line was wrong and you can see that it
 * was.
 */

/** A series of (epoch seconds, bytes) samples, oldest first. */
export type Samples = readonly (readonly [number, number])[];

export interface Volume {
  readonly namespace: string;
  readonly name: string;
  readonly bytes: number;
  /** Bytes per week, from a least-squares line through the window. */
  readonly perWeek: number;
}

export interface Disk {
  readonly node: string;
  readonly used: number;
  readonly capacity: number;
  readonly perWeek: number;
}

/**
 * Longhorn wants room to work: rebuilding a replica needs space for a second
 * copy, and a node at 100% cannot do it. So "full" for a forecast is 85%, not
 * every last byte.
 */
export const USABLE = 0.85;

const WEEK_SECONDS = 604_800;

/**
 * The slope of a least-squares line, in units per week.
 *
 * Least squares rather than last-minus-first: a volume that was compacted on
 * Tuesday would otherwise report a negative rate forever, and one that spiked
 * for an hour would report a rate nothing could sustain.
 */
export function perWeek(samples: Samples): number {
  if (samples.length < 3) return 0;
  const n = samples.length;
  const meanX = samples.reduce((total, [at]) => total + at, 0) / n;
  const meanY = samples.reduce((total, [, value]) => total + value, 0) / n;
  let top = 0;
  let bottom = 0;
  for (const [at, value] of samples) {
    top += (at - meanX) * (value - meanY);
    bottom += (at - meanX) ** 2;
  }
  if (bottom === 0) return 0;
  return (top / bottom) * WEEK_SECONDS;
}

/**
 * Weeks until a disk reaches the usable ceiling, or null when it is not going
 * to — a volume that is shrinking or flat has no runway to report, and saying
 * "full in 4,000 weeks" is a number pretending to be an answer.
 */
export function weeksLeft(disk: Disk): number | null {
  if (disk.perWeek <= 0) return null;
  const ceiling = disk.capacity * USABLE;
  const left = (ceiling - disk.used) / disk.perWeek;
  if (!Number.isFinite(left)) return null;
  return Math.max(0, left);
}

export function gigabytes(bytes: number): number {
  return bytes / 1_000_000_000;
}

/** Biggest growers first; anything shrinking or flat is not news. */
export function growing(volumes: readonly Volume[], limit = 3): Volume[] {
  return [...volumes]
    .filter((volume) => volume.perWeek > 50_000_000)
    .sort((a, b) => b.perWeek - a.perWeek)
    .slice(0, limit);
}

/**
 * How long a window the samples actually cover, in days.
 *
 * Printed with the forecast, because a runway computed from four days of
 * history and one computed from four months are different claims wearing the
 * same words.
 */
export function windowDays(samples: Samples): number {
  if (samples.length < 2) return 0;
  return (samples[samples.length - 1]![0] - samples[0]![0]) / 86_400;
}
