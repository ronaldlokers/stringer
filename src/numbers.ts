/**
 * Arithmetic and formatting every beat shares.
 *
 * The rounding is here rather than with any one beat because every beat prints
 * numbers, and the difference it corrects is a language difference rather than
 * a subject one.
 */

export function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Population standard deviation, matching Python's `statistics.pstdev`. */
export function pstdev(values: readonly number[]): number {
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Fixed-point formatting that rounds halves to even, the way Python does.
 *
 * `toFixed` rounds halves away from zero, so the two disagree whenever a value
 * lands exactly on a half. That is not hypothetical: 36 of 288 readings is
 * exactly 12.5%, which Python prints as "12" and JavaScript as "13". One digit,
 * in a sentence about someone's health, from a language difference nobody would
 * think to look for.
 *
 * Values that are not exact halves are left to `toFixed`, which rounds them the
 * same way Python does.
 */
export function fixed(value: number, digits: number): string {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const remainder = scaled - floor;
  if (remainder !== 0.5) {
    return value.toFixed(digits);
  }
  const nearest = floor % 2 === 0 ? floor : floor + 1;
  return (nearest / scale).toFixed(digits);
}

/** A percentage, as the sentences write it. */
export function percent(share: number, digits = 0): string {
  return fixed(share * 100, digits);
}
