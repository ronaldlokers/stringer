/**
 * The backups beat: whether Longhorn is still writing to MinIO, and what is
 * left behind.
 *
 * Silent by design. Most mornings every volume was backed up overnight and the
 * beat says nothing at all; the post exists for the morning it did not happen.
 *
 * Sunday carries the standing conditions as well — volumes whose claim is gone,
 * backup sets whose volume is gone, volumes in no recurring job. Those are true
 * every day until someone acts, and reporting them every day is how a room
 * learns to stop reading.
 *
 * Env:
 *   KUBE_API             API base, default https://kubernetes.default.svc
 *   BACKUP_STALE_HOURS   past this a backup is late; default 26
 *   BACKUP_LEAK_HOURS    how long a claimless volume must persist; default 24
 *   DIGEST_TIMEZONE      which day it is; default Europe/Amsterdam
 *   DIGEST_DAY           force "weekly" or "daily"
 */

import { findingsFrom, renderBackups } from "../copy/backups/findings.js";
import {
  inventoryFrom,
  type RawBackup,
  type RawBackupVolume,
  type RawClaim,
  type RawTarget,
  type RawVolume,
} from "../copy/backups/inventory.js";
import { escape } from "../copy/alerts/render.js";
import { budget, Kube } from "../copy/cluster/kube.js";
import { describe, warmUp, withRetry } from "../retry.js";
import type { Round } from "../rounds.js";

const DEADLINE_MS = 30_000;
const VOLUMES = "/apis/longhorn.io/v1beta2/volumes";
const BACKUP_VOLUMES = "/apis/longhorn.io/v1beta2/backupvolumes";
const BACKUPS = "/apis/longhorn.io/v1beta2/backups";
const TARGETS = "/apis/longhorn.io/v1beta2/backuptargets";
const CLAIMS = "/api/v1/persistentvolumeclaims";

export async function backups(round: Round, environment = process.env): Promise<void> {
  const base = environment.KUBE_API?.trim() || "https://kubernetes.default.svc";
  const kube = new Kube(base);
  const zone = environment.DIGEST_TIMEZONE?.trim() || "Europe/Amsterdam";
  const staleHours = Number(environment.BACKUP_STALE_HOURS ?? "26") || 26;
  const leakHours = Number(environment.BACKUP_LEAK_HOURS ?? "24") || 24;
  const now = new Date();

  await warmUp(`${base}/version`);

  const deadline = budget(DEADLINE_MS);
  let inventory;
  try {
    // All five, or none. An inventory missing its claim list reports every
    // volume in the cluster as leaked, which is worse than reporting nothing.
    inventory = await withRetry(
      async () =>
        inventoryFrom(
          await kube.list<RawVolume>(VOLUMES, deadline),
          await kube.list<RawBackupVolume>(BACKUP_VOLUMES, deadline),
          await kube.list<RawBackup>(BACKUPS, deadline),
          await kube.list<RawTarget>(TARGETS, deadline),
          await kube.list<RawClaim>(CLAIMS, deadline),
        ),
      { what: "longhorn" },
    );
  } catch (error) {
    await round.say(
      "<div><strong>🗄️ could not read Longhorn</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  const weekly = wantsWeekly(now, zone, environment);
  const found = findingsFrom(inventory, now, { staleHours, leakHours }, weekly);
  process.stdout.write(
    `${inventory.volumes.length} volumes, ${inventory.orphans.length} orphan sets, ` +
      `${found.length} finding(s), ${weekly ? "weekly" : "daily"}\n`,
  );

  const body = renderBackups(found);
  if (body === null) {
    process.stdout.write("nothing to report, saying nothing\n");
    return;
  }
  await round.say(body);
}

/**
 * Sunday, in the zone the cluster lives in.
 *
 * Read from the formatter rather than `getUTCDay`, because 23:30 UTC on a
 * Saturday is already Sunday in Amsterdam and the run at 07:30 local would
 * otherwise be judged by a different day than the one it reports on.
 */
export function wantsWeekly(now: Date, zone: string, environment: NodeJS.ProcessEnv): boolean {
  const forced = environment.DIGEST_DAY?.trim().toLowerCase();
  if (forced === "weekly" || forced === "daily") return forced === "weekly";
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long" }).format(now);
  return weekday === "Sunday";
}
