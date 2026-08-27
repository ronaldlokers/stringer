# The backups beat

Longhorn backs up every volume in the cluster every night and tells nobody
whether it worked. This is the design for the beat that says so.

## What already reports, and what does not

Postgres is covered twice. `recovery-source-check` proves that a cluster's
`bootstrap.recovery` pointer resolves to a prefix holding a recent base backup,
and files what it finds to the bridge's `/check`. `restore-drill` goes further
every Sunday: it restores each cluster into a throwaway cluster, once to the
latest WAL and once to a point in time an hour back, and posts the measured RTO
and RPO to the room itself. Between them, the database half of the backup story
is both tested and reported.

The volume half is neither. Campfire's SQLite database and every attachment,
squirrel's photographs, linkding, commafeed, tandoor, fizzy, the Loki and
Prometheus volumes — all of it is backed up by Longhorn recurring jobs to MinIO
on TrueNAS, and the only signal that any of it happened is a page in the
Longhorn UI that nobody opens. A recurring job that stops firing, a backup
target that stops accepting connections, and a volume that was never in a
backup group all look identical from outside: silence.

## What production actually looks like

Read on 28 August 2026, which is where the finding list below comes from rather
than from what the documentation says:

- 51 Longhorn volumes. Every one carries
  `recurring-job-group.longhorn.io/default=enabled`, so coverage is by group
  rather than by the per-volume labels the stack documentation describes.
- Four recurring jobs, all in the `default` group: `backup-daily` at 02:00
  retaining 7, `backup-weekly` on Saturdays at 22:00 retaining 4,
  `backup-monthly` on the 1st at 04:00 retaining 3, and `snapshot-daily` at
  01:00 retaining 2.
- The `default` backup target reports `available: true`, last synced
  2026-08-27T22:20Z.
- Every live volume was backed up on 2026-08-27. Nothing is stale.
- **23 volumes are leaked.** `database/drill-nightscout-1`, `drill-immich-1`
  and `drill-postgres-1` are detached, have never been backed up, and no PVC of
  that name exists in the `database` namespace. They are the restore drill's
  scratch volumes: the drill deletes its scratch clusters and their Longhorn
  volumes stay behind, one set per week. `drill-nightscout-1` is there ten
  times.
- **45 of 53 BackupVolumes have no live volume.** Backup chains held in MinIO
  for PVCs that no longer exist, including `campfire-restore-test` and
  `campfire-restore-test2` from an older drill.

Two consequences for the design. First, a volume with no backup is usually not
an unprotected volume — it is a leaked one, and the fix is deletion rather than
a backup, so the beat must say which it means. Second, the interesting failure
on any given morning is staleness and reachability, while leaks and orphans are
standing conditions that would otherwise be repeated every day until someone
acted.

## What the beat reports

Six findings, in the order a reader needs them.

1. **Target unreachable.** `backuptargets.longhorn.io/default` with
   `status.available` other than true, quoting the `Unavailable` condition's
   message. Nothing below this line means anything while it holds: every
   volume's last backup ages at the same rate whether the target is broken or
   the jobs are.
2. **Stale.** A live volume whose `status.lastBackupAt` is more than 26 hours
   old — the 02:00 daily job plus two hours of grace, so a slow queue on a busy
   night is not a finding. Reported as the PVC's namespace and name, never the
   `pvc-<uuid>` volume name, with the age and the last backup's timestamp.
3. **Failed.** A `backups.longhorn.io` in state `Error` whose volume is still
   live, with the error message. An Error backup belonging to a volume that no
   longer exists is orphan noise rather than a failure, and is counted with the
   orphans instead.
4. **Uncovered.** A live volume in no recurring-job group and carrying no
   opt-out label. Today this is empty, and it is the rule that matters for the
   next PVC created outside the group.
5. **Leaked.** A Longhorn volume whose `kubernetesStatus.pvcName` matches no
   live PVC, detached, and older than 24 hours. Grouped by PVC name with a
   count and the space held, so ten weeks of `drill-nightscout-1` is one line
   saying ten, not ten lines.
6. **Orphaned.** BackupVolumes with no live volume, as a single line with the
   count and total `dataStored`. Deleting them is a MinIO-side decision the
   beat does not make and cannot see the consequences of; what it can do is
   stop the number growing unnoticed.

### Opting out

A volume can be exempt from finding 4 by a label on its PVC:

```yaml
metadata:
  labels:
    backup.stringer/none: "a cache, rebuilt on start"
```

The value is the reason and the beat quotes it back on the Sunday the volume
first appears, so an exemption nobody can justify reads as one. The reason
lives beside the volume in the manifest rather than in an environment variable
on the beat, which is the difference between a decision and a list that drifts.

## Cadence, and the noise it prevents

Findings 5 and 6 are true every morning until somebody acts on them, and a bot
that repeats itself daily is a bot the room mutes. No beat here keeps state
between runs, and adding one for this would be the largest thing in the design.
The rule is cadence instead:

- **Every morning**: target unreachable, stale, failed. Conditions that are
  wrong now and get worse while nobody looks.
- **Sundays only**: leaked, orphaned, uncovered. Standing conditions worth a
  weekly nudge and never a daily one.

Silence when there is nothing in the day's categories, which on most mornings
is the whole behaviour. A Sunday with a failure carries both sets in one post.

`DIGEST_DAY` forces the Sunday set for a dry run, the way `DIGEST_SHEET` does
for glucose.

## Where it reads from

The Kubernetes API, through the client the briefing already uses in
`src/copy/cluster/kube.ts`. Five lists, all namespaced to `longhorn-system`
except the last:

| Resource | For |
|---|---|
| `volumes.longhorn.io` | the inventory: PVC mapping, state, `lastBackupAt`, group labels |
| `backupvolumes.longhorn.io` | orphan detection, `dataStored` |
| `backups.longhorn.io` | failures |
| `backuptargets.longhorn.io` | reachability |
| `persistentvolumeclaims` (all namespaces) | which volumes are live, and the opt-out label |

Prometheus was the alternative and was rejected: neither target availability
nor a volume that belongs to no recurring-job group is a metric, and both are
the findings with teeth. The size history Prometheus would add belongs to the
`storage` beat, which already draws it.

## Layout

```
src/beats/backups.ts          the beat: read, decide the day's categories, file
src/copy/backups/inventory.ts the join — volumes, PVCs and backup volumes into one model
src/copy/backups/findings.ts  the six rules, and the words for each
```

Words only. Six findings are a list; a sheet would be a picture of a list.
`press/` is untouched.

`inventory.ts` takes the four Longhorn lists and the PVC list and returns a
plain model — one entry per volume with its PVC identity, its last backup, its
groups and its exemption, plus the backup volumes that matched nothing. It does
no judging. `findings.ts` takes that model, a clock and the thresholds, and
returns findings. The beat does the reading, the cadence decision and the
posting, and holds no arithmetic of its own.

## Environment

| Variable | Meaning |
|---|---|
| `ROOM_URL` | as every beat |
| `LONGHORN_NAMESPACE` | default `longhorn-system` |
| `BACKUP_STALE_HOURS` | default 26 |
| `BACKUP_LEAK_HOURS` | how long a PVC-less volume must have existed before it is a leak; default 24 |
| `DIGEST_TIMEZONE` | which day it is; default `Europe/Amsterdam` |
| `DIGEST_DAY` | force `weekly` or `daily` |

## When the cluster cannot be read

The same contract as every other beat: `warmUp` on the API server, `withRetry`
around the reads, and a failure posted to the room as "could not read Longhorn"
with the cause unwrapped by `describe`. A beat that stops arriving is
indistinguishable from a morning with nothing to say, which is precisely the
failure this beat exists to end.

A partial read is not a report. If any of the five lists fails, the beat says
so and files nothing else: an inventory missing its PVC list would report every
volume in the cluster as leaked.

## Homelab side

Not this repository's to merge, but the beat is unusable without it: a
`backups` ServiceAccount with a ClusterRole granting `get`/`list` on the four
`longhorn.io` resources and on `persistentvolumeclaims`, and a CronJob running
`stringer backups` daily at 07:30 — after the 02:00 backup window and before
the morning briefing, so a stale backup is in the room before the day starts.

## Testing

A fake Kubernetes API on 127.0.0.1 serving the five list endpoints, in the
shape `glucose` uses for Nightscout, with hand-written fixtures rather than a
production dump. What gets pinned:

- the join: a volume is named by its PVC, and a volume whose PVC is gone is
  never named `pvc-<uuid>` in a finding;
- the 26-hour boundary from both sides;
- a drill volume 20 minutes old is not a leak, and the same volume 25 hours old
  is;
- an `Error` backup for a live volume is a failure, and the same backup for a
  deleted volume is counted as an orphan instead;
- ten scratch volumes of one name are one line saying ten;
- the cadence split: a healthy Tuesday says nothing, a Tuesday with leaks says
  nothing, a Sunday with leaks says so;
- a target that is unavailable is the whole post;
- a failed list is reported and stops the run.

Every test is proved by mutation before it is kept: the rule it covers is
reverted in the source, the assertion failure is observed and recorded, and
only then is the test committed.

## Out of scope

- Fixing the drill leak. The beat exists to make it visible; the drill is
  homelab's.
- Postgres backups, which `restore-drill` and `recovery-source-check` already
  cover.
- Deleting orphaned backup sets from MinIO.
- Any sheet.
