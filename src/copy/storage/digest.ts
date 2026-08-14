/**
 * The Sunday message about disks.
 *
 * Always posted, like the speedtest sheet and unlike the briefing: the figure
 * that makes it worth reading — how much room is left and how fast it is going
 * — changes every week whether or not anything is wrong. Silence would only be
 * informative if nothing ever grew.
 */

import { escape } from "../alerts/render.js";
import { bullets, heading } from "../cluster/briefing.js";
import { fixed } from "../../numbers.js";
import { gigabytes, growing, weeksLeft, type Disk, type Volume } from "./forecast.js";

/**
 * Below this, the runway is the news rather than a footnote — and it is what
 * makes the message worth a notification.
 *
 * Twelve weeks is three months: long enough to order a disk, short enough that
 * ignoring it is a decision.
 */
export const SOON_WEEKS = 12;

export interface Report {
  readonly disks: readonly Disk[];
  readonly volumes: readonly Volume[];
  /** How many days of history the rates were computed from. */
  readonly days: number;
}

/** True when at least one node runs out inside the horizon. */
export function pressing(report: Report): boolean {
  return report.disks.some((disk) => {
    const left = weeksLeft(disk);
    return left !== null && left <= SOON_WEEKS;
  });
}

export function renderStorage(report: Report): string {
  const lines: string[] = [];

  for (const disk of [...report.disks].sort((a, b) => b.used / b.capacity - a.used / a.capacity)) {
    const share = (disk.used / disk.capacity) * 100;
    const left = weeksLeft(disk);
    const runway =
      left === null
        ? "not growing"
        : left <= SOON_WEEKS
          ? `full in about ${fixed(left, 0)} weeks`
          : `about ${fixed(left / 4.35, 0)} months of room`;
    lines.push(
      `${escape(disk.node)} · ${fixed(gigabytes(disk.used), 0)} of ` +
        `${fixed(gigabytes(disk.capacity), 0)} GB (${fixed(share, 0)}%) · ` +
        `${growth(disk.perWeek)} · ${runway}`,
    );
  }

  const climbers = growing(report.volumes);
  for (const volume of climbers) {
    lines.push(
      `${escape(volume.namespace)}/${escape(volume.name)} · ` +
        `${fixed(gigabytes(volume.bytes), 1)} GB · ${growth(volume.perWeek)}`,
    );
  }
  if (!climbers.length) {
    lines.push("nothing is growing fast enough to name");
  }

  // How much history this rests on. A runway from four days and one from four
  // months are different claims, and only one of them is worth acting on.
  const from =
    report.days >= 60
      ? `${fixed(report.days / 30, 0)} months of history`
      : `${fixed(report.days, 0)} days of history`;

  return heading("💾 storage · longhorn") + bullets(lines) + `<div>from ${from}</div>`;
}

function growth(perWeek: number): string {
  const gb = gigabytes(perWeek);
  if (Math.abs(gb) < 0.05) return "flat";
  return `${gb > 0 ? "+" : ""}${fixed(gb, 1)} GB a week`;
}
