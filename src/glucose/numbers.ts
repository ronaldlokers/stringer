/**
 * Arithmetic that has to agree with the Python it replaces, digit for digit.
 *
 * The findings are sentences with numbers in them, and the golden fixtures
 * compare those sentences as strings. So the rounding has to match, not merely
 * be correct — and Python and JavaScript disagree about exactly one case.
 */

/** mg/dL per mmol/L. */
export const MMOL = 18.0182;

export function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Population standard deviation, matching `statistics.pstdev`. */
export function pstdev(values: readonly number[]): number {
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Python's fixed-point formatting, which rounds halves to even.
 *
 * `toFixed` rounds halves away from zero, so the two disagree whenever a value
 * lands exactly on a half. That is not hypothetical here: 36 of 288 readings
 * is exactly 12.5%, which Python prints as "12" and JavaScript as "13". One
 * digit, in a sentence about someone's health, from a language difference
 * nobody would think to look for.
 *
 * Values that are not exact halves are left to `toFixed`, which rounds them
 * the same way Python does.
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

/** Minutes past local midnight, as `HH:MM`. */
export function clock(minute: number): string {
  const whole = Math.trunc(minute);
  const hour = Math.floor(whole / 60);
  return `${String(hour).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
