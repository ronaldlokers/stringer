/**
 * Six rules, and the words for them.
 *
 * Ordered by what a reader needs first. An unreachable target makes every age
 * below it meaningless — the backups are not late, they are impossible — so it
 * is reported alone.
 *
 * The split by day is what keeps the beat readable. A leaked volume is true
 * every morning until someone deletes it, and a bot that repeats itself daily
 * is a bot the room mutes. Nothing here keeps state between runs, so Sunday
 * does the work memory would otherwise have to.
 */

import { escape } from "../alerts/render.js";
import { gigabytes } from "../storage/forecast.js";
import { fixed } from "../../numbers.js";
import type { Inventory, VolumeEntry } from "./inventory.js";

export type Kind = "target" | "failed" | "stale" | "leaked" | "orphaned" | "uncovered";

export interface Finding {
  readonly kind: Kind;
  readonly text: string;
}

export interface Thresholds {
  readonly staleHours: number;
  readonly leakHours: number;
}

function hoursBetween(stamp: string, now: Date): number {
  return (now.getTime() - Date.parse(stamp)) / 3_600_000;
}

export function findingsFrom(
  inventory: Inventory,
  now: Date,
  thresholds: Thresholds,
  weekly: boolean,
): Finding[] {
  if (!inventory.target.available) {
    const why = inventory.target.message ?? "no reason given";
    return [{ kind: "target", text: `the backup target is unreachable: ${why}` }];
  }

  const found: Finding[] = [];

  for (const failure of inventory.failures) {
    found.push({ kind: "failed", text: `${failure.name}: backup failed — ${failure.message}` });
  }

  for (const volume of inventory.volumes) {
    if (!volume.live) continue;
    if (volume.lastBackupAt) {
      const age = hoursBetween(volume.lastBackupAt, now);
      if (age > thresholds.staleHours) {
        // Floored, not rounded: rounding 33.5 up to "34h" would say more time
        // has passed than the record actually shows.
        found.push({
          kind: "stale",
          text: `${volume.name}: ${Math.floor(age)}h since the last backup`,
        });
      }
      continue;
    }
    // Never backed up is only a finding once the volume has existed long enough
    // to have had a window; without this every new claim reports one for a day.
    const created = volume.createdAt;
    if (created && hoursBetween(created, now) > thresholds.staleHours) {
      found.push({ kind: "stale", text: `${volume.name}: never backed up` });
    }
  }

  if (!weekly) return found;

  const leaked = new Map<string, { count: number }>();
  for (const volume of inventory.volumes) {
    if (volume.live || !volume.detached) continue;
    const created = volume.createdAt;
    if (!created || hoursBetween(created, now) <= thresholds.leakHours) continue;
    const seen = leaked.get(volume.name) ?? { count: 0 };
    seen.count += 1;
    leaked.set(volume.name, seen);
  }
  for (const [name, { count }] of leaked) {
    found.push({
      kind: "leaked",
      text:
        count === 1
          ? `${name}: a volume whose claim is gone, still holding space`
          : `${count} × ${name}: volumes whose claim is gone, still holding space`,
    });
  }

  for (const volume of inventory.volumes) {
    if (!volume.live || volume.groups.length || volume.exemption) continue;
    found.push({ kind: "uncovered", text: `${volume.name}: in no recurring backup job` });
  }

  if (inventory.orphans.length) {
    const stored = inventory.orphans.reduce((sum, one) => sum + one.storedBytes, 0);
    found.push({
      kind: "orphaned",
      text: `${inventory.orphans.length} backup sets with no volume, holding ${fixed(gigabytes(stored), 1)} GB`,
    });
  }

  return found;
}

export function renderBackups(found: readonly Finding[]): string | null {
  if (!found.length) return null;
  const items = found.map((one) => `<li>${escape(one.text)}</li>`).join("");
  return `<div><strong>🗄️ backups</strong></div><ul>${items}</ul>`;
}
