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

/**
 * The whole gathering budget. Nothing waits on a CronJob at half past seven,
 * and a run that has been told to wait by the API server needs room to do it.
 */
const DEADLINE_MS = 90_000;
/**
 * Four rather than three, because the wait between attempts is now the server's
 * own Retry-After rather than a fixed 750ms — the extra attempt costs a second
 * on a bad morning and nothing at all on a good one.
 */
const ATTEMPTS = 4;
/**
 * A breath between reads.
 *
 * The five lists are one flow as far as API Priority and Fairness is
 * concerned, and the third of them asks for 649 Backup objects. Fired back to
 * back during a Flux reconcile they were refused with 429; spaced, they are
 * not. This is politeness rather than correctness — the retry above is what
 * makes it correct — but a beat that never trips the limiter never has to.
 */
const SPACING_MS = 250;
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
    // They run in turn rather than together, spaced by SPACING_MS, and share
    // the one budget above; each request is capped at 1.5s by Kube.
    inventory = await withRetry(
      async () =>
        inventoryFrom(
          await spaced(kube.list<RawVolume>(VOLUMES, deadline)),
          await spaced(kube.list<RawBackupVolume>(BACKUP_VOLUMES, deadline)),
          await spaced(kube.list<RawBackup>(BACKUPS, deadline)),
          await spaced(kube.list<RawTarget>(TARGETS, deadline)),
          await kube.list<RawClaim>(CLAIMS, deadline),
        ),
      { what: "longhorn", attempts: ATTEMPTS },
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

/** A read, then a pause before the next one. The last read needs no pause. */
async function spaced<T>(reading: Promise<T>): Promise<T> {
  const value = await reading;
  await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  return value;
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
