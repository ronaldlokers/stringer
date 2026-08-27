/**
 * One model of what is backed up, from five lists that each know part of it.
 *
 * The join is the whole point. A Longhorn volume knows its own last backup and
 * the claim it was bound to; only the claim list knows whether that claim still
 * exists. Without both, a volume with no backup is indistinguishable from a
 * volume nobody is protecting — which is the mistake the briefing has been
 * making every morning, reporting the restore drill's abandoned scratch volumes
 * as unprotected data.
 *
 * Nothing here judges. Ages, thresholds and words live in findings.ts, so this
 * file can be read against the API's shapes and that one against the rules.
 */

export interface RawMeta {
  readonly name: string;
  readonly namespace?: string;
  readonly creationTimestamp?: string;
  readonly labels?: Record<string, string>;
  readonly annotations?: Record<string, string>;
}

export interface RawVolume {
  readonly metadata: RawMeta;
  readonly status?: {
    readonly state?: string;
    readonly lastBackupAt?: string;
    readonly kubernetesStatus?: { readonly namespace?: string; readonly pvcName?: string };
  };
}

export interface RawBackupVolume {
  readonly metadata: RawMeta;
  readonly status?: { readonly dataStored?: string; readonly lastBackupAt?: string };
}

export interface RawBackup {
  readonly metadata: RawMeta;
  readonly status?: { readonly state?: string; readonly error?: string; readonly volumeName?: string };
}

export interface RawTarget {
  readonly metadata: RawMeta;
  readonly status?: {
    readonly available?: boolean;
    readonly conditions?: readonly { type?: string; status?: string; message?: string }[];
  };
}

export interface RawClaim {
  readonly metadata: RawMeta;
  readonly spec?: { readonly volumeName?: string };
}

export interface VolumeEntry {
  /** The Longhorn name, `pvc-<uuid>` — what you delete it by. */
  readonly volume: string;
  /** `namespace/claim`, or the Longhorn name when it was never bound. */
  readonly name: string;
  readonly namespace?: string | undefined;
  readonly pvc?: string | undefined;
  /** Its claim still exists and still points at this volume. */
  readonly live: boolean;
  /**
   * `| undefined` throughout, not merely `?`. `exactOptionalPropertyTypes` is
   * on, so a test that builds a volume with no backup by writing
   * `{ lastBackupAt: undefined }` is a type error without it — and writing
   * those cases out is most of this module's test suite.
   */
  readonly lastBackupAt?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly groups: readonly string[];
  /** The reason on the claim's `backup.stringer/none` annotation. */
  readonly exemption?: string | undefined;
  readonly detached: boolean;
}

export interface OrphanSet {
  readonly volume: string;
  readonly storedBytes: number;
  readonly lastBackupAt?: string | undefined;
}

export interface Failure {
  readonly name: string;
  readonly message: string;
}

export interface Target {
  readonly available: boolean;
  readonly message?: string | undefined;
}

export interface Inventory {
  readonly volumes: readonly VolumeEntry[];
  readonly orphans: readonly OrphanSet[];
  readonly failures: readonly Failure[];
  readonly target: Target;
}

const EXEMPTION = "backup.stringer/none";
const GROUP_PREFIX = "recurring-job-group.longhorn.io/";
const JOB_PREFIX = "recurring-job.longhorn.io/";

export function inventoryFrom(
  volumes: readonly RawVolume[],
  backupVolumes: readonly RawBackupVolume[],
  backups: readonly RawBackup[],
  targets: readonly RawTarget[],
  claims: readonly RawClaim[],
): Inventory {
  // Keyed by the volume a claim is bound to, so a claim recreated under the
  // same name does not vouch for the volume it replaced.
  const claimByVolume = new Map<string, RawClaim>();
  for (const claim of claims) {
    const bound = claim.spec?.volumeName;
    if (bound) claimByVolume.set(bound, claim);
  }

  const entries: VolumeEntry[] = [];
  const byName = new Map<string, VolumeEntry>();
  for (const volume of volumes) {
    const bound = volume.status?.kubernetesStatus;
    const claim = claimByVolume.get(volume.metadata.name);
    const labels = volume.metadata.labels ?? {};
    const groups = Object.entries(labels)
      .filter(([key, value]) => key.startsWith(GROUP_PREFIX) && value === "enabled")
      .map(([key]) => key.slice(GROUP_PREFIX.length));
    const jobs = Object.entries(labels)
      .filter(([key, value]) => key.startsWith(JOB_PREFIX) && value === "enabled")
      .map(([key]) => key.slice(JOB_PREFIX.length));
    const entry: VolumeEntry = {
      volume: volume.metadata.name,
      name: bound?.pvcName ? `${bound.namespace}/${bound.pvcName}` : volume.metadata.name,
      ...(bound?.namespace ? { namespace: bound.namespace } : {}),
      ...(bound?.pvcName ? { pvc: bound.pvcName } : {}),
      live: claim !== undefined,
      ...(volume.status?.lastBackupAt?.trim()
        ? { lastBackupAt: volume.status.lastBackupAt.trim() }
        : {}),
      ...(volume.metadata.creationTimestamp
        ? { createdAt: volume.metadata.creationTimestamp }
        : {}),
      groups: [...groups, ...jobs],
      ...(claim?.metadata.annotations?.[EXEMPTION]
        ? { exemption: claim.metadata.annotations[EXEMPTION] }
        : {}),
      detached: (volume.status?.state ?? "") !== "attached",
    };
    entries.push(entry);
    byName.set(entry.volume, entry);
  }

  const orphans: OrphanSet[] = [];
  for (const set of backupVolumes) {
    const entry = byName.get(set.metadata.name);
    if (entry?.live) continue;
    orphans.push({
      volume: set.metadata.name,
      storedBytes: Number(set.status?.dataStored ?? "0") || 0,
      ...(set.status?.lastBackupAt ? { lastBackupAt: set.status.lastBackupAt } : {}),
    });
  }

  const failures: Failure[] = [];
  for (const backup of backups) {
    if (backup.status?.state !== "Error") continue;
    // Longhorn puts the volume on a label and sometimes on the status; the
    // label is the one that is always there.
    const volumeName =
      backup.status?.volumeName ?? backup.metadata.labels?.["longhornvolume"] ?? "";
    const entry = byName.get(volumeName);
    // An errored backup for a volume nobody owns any more is orphan noise, and
    // is already counted as such.
    if (!entry?.live) continue;
    failures.push({ name: entry.name, message: backup.status?.error ?? "no reason given" });
  }

  const target = targets[0];
  const unavailable = target?.status?.conditions?.find(
    (condition) => condition.type === "Unavailable" && condition.status === "True",
  );
  const available = target !== undefined && target.status?.available === true;

  return {
    volumes: entries,
    orphans,
    failures,
    target: {
      available,
      ...(unavailable?.message ? { message: unavailable.message } : {}),
    },
  };
}
