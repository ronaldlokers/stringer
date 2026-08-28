# Backups Beat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily `backups` beat that reports Longhorn volume backup failures, and on Sundays the standing conditions — leaked volumes, orphaned backup sets, volumes nobody covers.

**Architecture:** Two pure modules and a thin beat. `copy/backups/inventory.ts` joins five Kubernetes list reads into one model and judges nothing. `copy/backups/findings.ts` turns that model plus a clock into findings and the words for them. `beats/backups.ts` reads, decides whether today is a Sunday, and files. The briefing gives up its backup checking in the same branch, because two things reporting one fact is how the wrong one survives.

**Tech Stack:** TypeScript on Node 22, `node:test`, the repository's own `Kube` client (`src/copy/cluster/kube.ts`) and `withRetry`/`warmUp`/`describe` (`src/retry.ts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-backups-beat-design.md`

## Global Constraints

- Node 22, ESM, `.js` extensions on every relative import — TypeScript source, compiled paths.
- Tests are `node:test` with `node:assert/strict`. No test framework, no mocking library, no stubbed `fetch`: a fake API server on `127.0.0.1`, as `test/glucose.test.ts` and `test/status.test.ts` do.
- **Every test is proved by mutation before it is committed.** Revert the rule in the source, run the test, record the assertion failure in the commit body, restore. A compile error is not proof.
- Silence is the default: no findings in today's categories means no post at all.
- Stale threshold 26 hours (`BACKUP_STALE_HOURS`), leak threshold 24 hours (`BACKUP_LEAK_HOURS`), timezone default `Europe/Amsterdam`.
- Opt-out is the PVC **annotation** `backup.stringer/none`, whose value is the reason.
- A volume is named `namespace/pvc-name` in every finding. `pvc-<uuid>` never appears in prose.
- Commit style: conventional, lowercase, imperative. Never commit to `main`.

## File structure

| File | Responsibility |
|---|---|
| `src/copy/backups/inventory.ts` | Raw Longhorn/PVC list types, and the join into one model. No judgement, no clock. |
| `src/copy/backups/findings.ts` | The six rules against a clock and thresholds, plus the HTML. |
| `src/beats/backups.ts` | Read the five lists, pick the day's categories, file or stay silent. |
| `src/index.ts` | One line: register the beat. |
| `src/copy/cluster/checks.ts` | `checkVolumes` loses its backup half. |
| `test/backups.test.ts` | Fake API server, fixtures, all of the above. |
| `test/cluster.test.ts` | Existing tests for the backup half of `checkVolumes` are removed with it. |
| `README.md` | Beat row and the four new variables. |

---

### Task 1: The inventory join

**Files:**
- Create: `src/copy/backups/inventory.ts`
- Test: `test/backups.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RawVolume`, `RawBackupVolume`, `RawBackup`, `RawTarget`, `RawClaim` — the shapes read from the API.
  - `interface VolumeEntry { volume: string; name: string; namespace?: string; pvc?: string; live: boolean; lastBackupAt?: string; createdAt?: string; groups: readonly string[]; exemption?: string; detached: boolean }`
  - `interface OrphanSet { volume: string; storedBytes: number; lastBackupAt?: string }`
  - `interface Failure { name: string; message: string }`
  - `interface Target { available: boolean; message?: string }`
  - `interface Inventory { volumes: readonly VolumeEntry[]; orphans: readonly OrphanSet[]; failures: readonly Failure[]; target: Target }`
  - `function inventoryFrom(volumes, backupVolumes, backups, targets, claims): Inventory`

- [ ] **Step 1: Write the failing test**

Add to `test/backups.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inventoryFrom } from "../src/copy/backups/inventory.js";

/** A Longhorn volume as the API returns it. */
function volume(over: Record<string, unknown> = {}) {
  const { name = "pvc-1", namespace = "campfire", pvc = "campfire-data", ...rest } = over as
    Record<string, any>;
  return {
    metadata: {
      name,
      creationTimestamp: "2026-08-01T00:00:00Z",
      labels: { "recurring-job-group.longhorn.io/default": "enabled" },
    },
    status: {
      state: "attached",
      lastBackupAt: "2026-08-27T00:00:00Z",
      kubernetesStatus: { namespace, pvcName: pvc },
      ...(rest.status as object ?? {}),
    },
    spec: {},
  };
}

/** A PVC, bound to the Longhorn volume of that name. */
function claim(namespace: string, name: string, volumeName: string, annotations = {}) {
  return { metadata: { name, namespace, annotations }, spec: { volumeName } };
}

describe("the inventory", () => {
  it("names a volume by its claim, never by its uuid", () => {
    const model = inventoryFrom(
      [volume()],
      [],
      [],
      [],
      [claim("campfire", "campfire-data", "pvc-1")],
    );
    assert.equal(model.volumes[0]!.name, "campfire/campfire-data");
    assert.equal(model.volumes[0]!.live, true);
  });

  it("calls a volume dead when its claim is gone, and keeps its own name to delete it by", () => {
    const model = inventoryFrom([volume({ name: "pvc-9", pvc: "drill-immich-1", namespace: "database" })], [], [], [], []);
    assert.equal(model.volumes[0]!.live, false);
    assert.equal(model.volumes[0]!.name, "database/drill-immich-1");
    assert.equal(model.volumes[0]!.volume, "pvc-9");
  });

  it("does not accept a claim of the same name bound to a different volume", () => {
    // A PVC deleted and recreated keeps its name and gets a new PV. The old
    // Longhorn volume is then leaked, and matching on name alone would hide it.
    const model = inventoryFrom(
      [volume({ name: "pvc-old" })],
      [],
      [],
      [],
      [claim("campfire", "campfire-data", "pvc-new")],
    );
    assert.equal(model.volumes[0]!.live, false);
  });

  it("reads the recurring-job groups a volume belongs to", () => {
    const model = inventoryFrom([volume()], [], [], [], []);
    assert.deepEqual(model.volumes[0]!.groups, ["default"]);
  });

  it("carries the claim's opt-out reason, not merely that it has one", () => {
    const model = inventoryFrom(
      [volume({ name: "pvc-2", namespace: "ntfy", pvc: "ntfy-cache" })],
      [],
      [],
      [],
      [claim("ntfy", "ntfy-cache", "pvc-2", { "backup.stringer/none": "a cache, rebuilt on start" })],
    );
    assert.equal(model.volumes[0]!.exemption, "a cache, rebuilt on start");
  });

  it("counts a backup set with no live volume as an orphan, with what it holds", () => {
    const backupVolume = {
      metadata: { name: "pvc-gone" },
      status: { dataStored: "1073741824", lastBackupAt: "2026-02-26T01:00:00Z" },
    };
    const model = inventoryFrom([volume()], [backupVolume], [], [], [claim("campfire", "campfire-data", "pvc-1")]);
    assert.equal(model.orphans.length, 1);
    assert.equal(model.orphans[0]!.storedBytes, 1073741824);
  });

  it("keeps a backup set whose volume is alive out of the orphans", () => {
    const backupVolume = { metadata: { name: "pvc-1" }, status: { dataStored: "10" } };
    const model = inventoryFrom([volume()], [backupVolume], [], [], [claim("campfire", "campfire-data", "pvc-1")]);
    assert.deepEqual(model.orphans, []);
  });

  it("reports an errored backup by the claim it belongs to", () => {
    const backup = {
      metadata: { name: "backup-abc", labels: { longhornvolume: "pvc-1" } },
      status: { state: "Error", error: "the target refused the connection" },
    };
    const model = inventoryFrom([volume()], [], [backup], [], [claim("campfire", "campfire-data", "pvc-1")]);
    assert.deepEqual(model.failures, [
      { name: "campfire/campfire-data", message: "the target refused the connection" },
    ]);
  });

  it("reads the target as unavailable from the condition, not from a missing field", () => {
    const target = {
      metadata: { name: "default" },
      status: {
        available: false,
        conditions: [{ type: "Unavailable", status: "True", message: "dial tcp: i/o timeout" }],
      },
    };
    const model = inventoryFrom([], [], [], [target], []);
    assert.equal(model.target.available, false);
    assert.equal(model.target.message, "dial tcp: i/o timeout");
  });

  it("treats a cluster with no backup target at all as unavailable", () => {
    assert.equal(inventoryFrom([], [], [], [], []).target.available, false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test 2>&1 | tail -20`
Expected: the build fails with `Cannot find module '../src/copy/backups/inventory.js'`. That is not proof of anything yet — it is the starting state.

- [ ] **Step 3: Write the module**

Create `src/copy/backups/inventory.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, and the total rises by 10.

- [ ] **Step 5: Prove each test by mutation**

For each mutation below: apply it to `src/copy/backups/inventory.ts`, run `npm test 2>&1 | grep -E "^✖|fail"`, record the failure, then restore the file.

| Mutation | Must fail |
|---|---|
| `live: true` always | the dead-volume test and the recreated-claim test |
| key `claimByVolume` by `${namespace}/${name}` instead of `spec.volumeName` | the recreated-claim test |
| drop the `entry?.live` guard when collecting orphans | the live-backup-set test |
| keep errored backups for dead volumes | none of the current tests — **add one** if this survives |
| `available: target !== undefined` | the unavailable-target test |

- [ ] **Step 6: Commit**

```bash
git add src/copy/backups/inventory.ts test/backups.test.ts
git commit -m "feat(backups): join the five lists into one inventory"
```

---

### Task 2: The rules

**Files:**
- Create: `src/copy/backups/findings.ts`
- Modify: `test/backups.test.ts`

**Interfaces:**
- Consumes: `Inventory`, `VolumeEntry` from Task 1.
- Produces:
  - `type Kind = "target" | "failed" | "stale" | "leaked" | "orphaned" | "uncovered"`
  - `interface Finding { kind: Kind; text: string }`
  - `interface Thresholds { staleHours: number; leakHours: number }`
  - `function findingsFrom(inventory: Inventory, now: Date, thresholds: Thresholds, weekly: boolean): Finding[]`
  - `function renderBackups(found: readonly Finding[]): string | null`

- [ ] **Step 1: Write the failing test**

Append to `test/backups.test.ts`:

```ts
import { findingsFrom, renderBackups } from "../src/copy/backups/findings.js";
import type { Inventory, VolumeEntry } from "../src/copy/backups/inventory.js";

const NOW = new Date("2026-08-28T07:30:00Z");
const LIMITS = { staleHours: 26, leakHours: 24 };

function entry(over: Partial<VolumeEntry> = {}): VolumeEntry {
  return {
    volume: "pvc-1",
    name: "campfire/campfire-data",
    namespace: "campfire",
    pvc: "campfire-data",
    live: true,
    lastBackupAt: "2026-08-28T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    groups: ["default"],
    detached: false,
    ...over,
  };
}

function model(over: Partial<Inventory> = {}): Inventory {
  return {
    volumes: [entry()],
    orphans: [],
    failures: [],
    target: { available: true },
    ...over,
  };
}

describe("the daily findings", () => {
  it("says nothing about a cluster where every backup is fresh", () => {
    assert.deepEqual(findingsFrom(model(), NOW, LIMITS, false), []);
  });

  it("reports a backup older than the window, in hours", () => {
    const old = entry({ lastBackupAt: "2026-08-26T22:00:00Z" });
    const found = findingsFrom(model({ volumes: [old] }), NOW, LIMITS, false);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.kind, "stale");
    assert.match(found[0]!.text, /campfire\/campfire-data/);
    assert.match(found[0]!.text, /33h/);
  });

  it("leaves a backup one hour inside the window alone", () => {
    const fresh = entry({ lastBackupAt: "2026-08-27T06:30:00Z" }); // 25 hours
    assert.deepEqual(findingsFrom(model({ volumes: [fresh] }), NOW, LIMITS, false), []);
  });

  it("counts a live volume that has never been backed up as stale, once it is old enough", () => {
    const never = entry({ lastBackupAt: undefined, createdAt: "2026-08-01T00:00:00Z" });
    const found = findingsFrom(model({ volumes: [never] }), NOW, LIMITS, false);
    assert.equal(found[0]!.kind, "stale");
    assert.match(found[0]!.text, /never backed up/);
  });

  it("gives a volume created this morning its first window before saying anything", () => {
    const young = entry({ lastBackupAt: undefined, createdAt: "2026-08-28T06:00:00Z" });
    assert.deepEqual(findingsFrom(model({ volumes: [young] }), NOW, LIMITS, false), []);
  });

  it("puts the target first and drops everything under it", () => {
    const stale = entry({ lastBackupAt: "2026-08-01T00:00:00Z" });
    const found = findingsFrom(
      model({ volumes: [stale], target: { available: false, message: "dial tcp: i/o timeout" } }),
      NOW,
      LIMITS,
      false,
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]!.kind, "target");
    assert.match(found[0]!.text, /dial tcp: i\/o timeout/);
  });

  it("reports a failed backup with the reason Longhorn gave", () => {
    const found = findingsFrom(
      model({ failures: [{ name: "campfire/campfire-data", message: "no space left on device" }] }),
      NOW,
      LIMITS,
      false,
    );
    assert.equal(found[0]!.kind, "failed");
    assert.match(found[0]!.text, /no space left on device/);
  });

  it("holds the standing conditions back on a weekday", () => {
    const leaked = entry({ live: false, detached: true, lastBackupAt: undefined });
    const found = findingsFrom(
      model({ volumes: [leaked], orphans: [{ volume: "pvc-gone", storedBytes: 1_000_000 }] }),
      NOW,
      LIMITS,
      false,
    );
    assert.deepEqual(found, []);
  });
});

describe("the Sunday findings", () => {
  it("counts leaked volumes of one name as one line", () => {
    const leaked = Array.from({ length: 10 }, (_, index) =>
      entry({
        volume: `pvc-drill-${index}`,
        name: "database/drill-nightscout-1",
        pvc: "drill-nightscout-1",
        namespace: "database",
        live: false,
        detached: true,
        lastBackupAt: undefined,
      }),
    );
    const found = findingsFrom(model({ volumes: leaked }), NOW, LIMITS, true);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.kind, "leaked");
    assert.match(found[0]!.text, /10 × database\/drill-nightscout-1/);
  });

  it("does not call a volume leaked while its drill may still be running", () => {
    const young = entry({
      live: false,
      detached: true,
      lastBackupAt: undefined,
      createdAt: "2026-08-28T07:10:00Z",
    });
    assert.deepEqual(findingsFrom(model({ volumes: [young] }), NOW, LIMITS, true), []);
  });

  it("calls the same volume leaked a day later", () => {
    const old = entry({
      live: false,
      detached: true,
      lastBackupAt: undefined,
      createdAt: "2026-08-27T06:00:00Z",
    });
    const found = findingsFrom(model({ volumes: [old] }), NOW, LIMITS, true);
    assert.equal(found[0]!.kind, "leaked");
  });

  it("never calls an attached volume leaked, whatever its claim says", () => {
    // A volume in use is a volume something is writing to. Deleting it because
    // a claim lookup failed is the one irreversible mistake available here.
    const attached = entry({ live: false, detached: false, createdAt: "2026-01-01T00:00:00Z" });
    const found = findingsFrom(model({ volumes: [attached] }), NOW, LIMITS, true);
    assert.equal(found.filter((one) => one.kind === "leaked").length, 0);
  });

  it("sums the orphaned backup sets into one line", () => {
    const found = findingsFrom(
      model({
        orphans: [
          { volume: "pvc-a", storedBytes: 1_073_741_824 },
          { volume: "pvc-b", storedBytes: 2_147_483_648 },
        ],
      }),
      NOW,
      LIMITS,
      true,
    );
    assert.equal(found[0]!.kind, "orphaned");
    assert.match(found[0]!.text, /2 backup sets/);
    assert.match(found[0]!.text, /3\.0 GB/);
  });

  it("reports a volume in no recurring job", () => {
    const found = findingsFrom(model({ volumes: [entry({ groups: [] })] }), NOW, LIMITS, true);
    assert.equal(found[0]!.kind, "uncovered");
    assert.match(found[0]!.text, /campfire\/campfire-data/);
  });

  it("quotes the reason an exempt volume gives, instead of reporting it", () => {
    const exempt = entry({ groups: [], exemption: "a cache, rebuilt on start" });
    const found = findingsFrom(model({ volumes: [exempt] }), NOW, LIMITS, true);
    assert.deepEqual(found, []);
  });
});

describe("the post", () => {
  it("is nothing at all when there is nothing to say", () => {
    assert.equal(renderBackups([]), null);
  });

  it("lists each finding under one heading", () => {
    const html = renderBackups([
      { kind: "stale", text: "campfire/campfire-data: 33h since the last backup" },
      { kind: "orphaned", text: "2 backup sets with no volume, holding 3.0 GB" },
    ])!;
    assert.match(html, /<strong>🗄️ backups<\/strong>/);
    assert.match(html, /<li>campfire\/campfire-data: 33h since the last backup<\/li>/);
    assert.match(html, /<li>2 backup sets with no volume, holding 3\.0 GB<\/li>/);
  });

  it("escapes what Longhorn said, because the message is not ours", () => {
    const html = renderBackups([{ kind: "failed", text: "a/b: <script>alert(1)</script>" }])!;
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test 2>&1 | tail -20`
Expected: build failure, `Cannot find module '../src/copy/backups/findings.js'`.

- [ ] **Step 3: Write the module**

Create `src/copy/backups/findings.ts`:

```ts
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

/** Gigabytes, to one decimal, which is the precision anyone acts on. */
function gigabytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
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
        found.push({
          kind: "stale",
          text: `${volume.name}: ${age.toFixed(0)}h since the last backup`,
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
      text: `${inventory.orphans.length} backup sets with no volume, holding ${gigabytes(stored)}`,
    });
  }

  return found;
}

export function renderBackups(found: readonly Finding[]): string | null {
  if (!found.length) return null;
  const items = found.map((one) => `<li>${escape(one.text)}</li>`).join("");
  return `<div><strong>🗄️ backups</strong></div><ul>${items}</ul>`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Prove each test by mutation**

| Mutation | Must fail |
|---|---|
| `age > staleHours` → `age > 0` | the one-hour-inside test |
| `age > staleHours` → `age > 1000` | the stale test and the never test |
| return findings even when the target is unavailable | the target-first test |
| drop the `!volume.detached` guard on leaks | the attached-volume test |
| drop the `leakHours` age guard | the drill-still-running test |
| leak grouping by `volume.volume` instead of `volume.name` | the ten-of-one-name test |
| ignore `volume.exemption` | the exemption test |
| return `weekly` findings on a weekday | the weekday test |
| `escape` removed from `renderBackups` | the escaping test |

- [ ] **Step 6: Commit**

```bash
git add src/copy/backups/findings.ts test/backups.test.ts
git commit -m "feat(backups): the six rules, and what each one says"
```

---

### Task 3: The beat

**Files:**
- Create: `src/beats/backups.ts`
- Modify: `src/index.ts`
- Modify: `test/backups.test.ts`

**Interfaces:**
- Consumes: `inventoryFrom`, `findingsFrom`, `renderBackups`, and `Kube`/`budget` from `src/copy/cluster/kube.js`.
- Produces: `export async function backups(round: Round, environment = process.env): Promise<void>`; `export function wantsWeekly(now: Date, zone: string, environment: NodeJS.ProcessEnv): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `test/backups.test.ts`. Note the round and the fake API server:

```ts
import { createServer, type Server } from "node:http";
import { after } from "node:test";

import { backups, wantsWeekly } from "../src/beats/backups.js";
import type { Posted, Round } from "../src/rounds.js";

class Recording implements Round {
  readonly said: string[] = [];
  async say(html: string): Promise<Posted> {
    this.said.push(html);
    return { id: String(this.said.length) };
  }
  async show(): Promise<Posted> {
    return { id: null };
  }
  async amend(_id: string, html: string): Promise<Posted> {
    return this.say(html);
  }
}

/** The Kubernetes API, as far as the beat can tell. */
async function apiServer() {
  const lists: Record<string, unknown[]> = {
    "/apis/longhorn.io/v1beta2/volumes": [],
    "/apis/longhorn.io/v1beta2/backupvolumes": [],
    "/apis/longhorn.io/v1beta2/backups": [],
    "/apis/longhorn.io/v1beta2/backuptargets": [],
    "/api/v1/persistentvolumeclaims": [],
  };
  const broken = new Set<string>();
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url!, "http://api.test").pathname;
    // warmUp asks for this first and ignores the answer; a 404 here would cost
    // every test in this suite four attempts and a second of sleeping.
    if (path === "/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    if (broken.has(path)) {
      response.writeHead(500).end("nope");
      return;
    }
    const items = lists[path];
    if (!items) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ items }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    lists,
    broken,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("the beat", async () => {
  const api = await apiServer();
  after(() => api.close());

  const environment = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    KUBE_API: api.base,
    DIGEST_TIMEZONE: "Europe/Amsterdam",
    // The beat reads the real clock, so the day is forced rather than dated:
    // without this the suite would report leaks to itself every Sunday.
    DIGEST_DAY: "daily",
    ...over,
  });

  it("says nothing on a morning with nothing wrong", async () => {
    api.lists["/apis/longhorn.io/v1beta2/backuptargets"] = [
      { metadata: { name: "default" }, status: { available: true } },
    ];
    api.lists["/apis/longhorn.io/v1beta2/volumes"] = [];
    const round = new Recording();
    await backups(round, environment());
    assert.deepEqual(round.said, []);
  });

  it("names a stale volume by its claim", async () => {
    api.lists["/apis/longhorn.io/v1beta2/volumes"] = [
      {
        metadata: { name: "pvc-1", creationTimestamp: "2026-01-01T00:00:00Z", labels: {} },
        status: {
          state: "attached",
          lastBackupAt: "2026-08-20T00:00:00Z",
          kubernetesStatus: { namespace: "campfire", pvcName: "campfire-data" },
        },
      },
    ];
    api.lists["/api/v1/persistentvolumeclaims"] = [
      { metadata: { name: "campfire-data", namespace: "campfire" }, spec: { volumeName: "pvc-1" } },
    ];
    const round = new Recording();
    await backups(round, environment());
    assert.equal(round.said.length, 1);
    assert.match(round.said[0]!, /campfire\/campfire-data/);
    assert.doesNotMatch(round.said[0]!, /pvc-1/);
  });

  it("says it could not read Longhorn rather than reporting a cluster it never read", async () => {
    api.broken.add("/apis/longhorn.io/v1beta2/volumes");
    const round = new Recording();
    try {
      await backups(round, environment());
    } finally {
      api.broken.delete("/apis/longhorn.io/v1beta2/volumes");
    }
    assert.equal(round.said.length, 1);
    assert.match(round.said[0]!, /could not read Longhorn/);
  });

  it("files nothing about volumes when the claim list is the one that failed", async () => {
    // Every volume would look leaked. A partial read is not a report.
    api.broken.add("/api/v1/persistentvolumeclaims");
    const round = new Recording();
    try {
      await backups(round, environment());
    } finally {
      api.broken.delete("/api/v1/persistentvolumeclaims");
    }
    assert.match(round.said[0]!, /could not read Longhorn/);
    assert.doesNotMatch(round.said[0]!, /leaked|never backed up/);
  });
});

describe("which day it is", () => {
  it("is weekly on a Sunday in the configured zone", () => {
    assert.equal(wantsWeekly(new Date("2026-08-30T05:30:00Z"), "Europe/Amsterdam", {}), true);
  });

  it("is not weekly on a Saturday", () => {
    assert.equal(wantsWeekly(new Date("2026-08-29T05:30:00Z"), "Europe/Amsterdam", {}), false);
  });

  it("reads the day in the zone, not in UTC", () => {
    // 23:30 UTC on Saturday is already Sunday in Amsterdam.
    assert.equal(wantsWeekly(new Date("2026-08-29T23:30:00Z"), "Europe/Amsterdam", {}), true);
  });

  it("obeys DIGEST_DAY over the calendar", () => {
    const saturday = new Date("2026-08-29T05:30:00Z");
    assert.equal(wantsWeekly(saturday, "Europe/Amsterdam", { DIGEST_DAY: "weekly" }), true);
    const sunday = new Date("2026-08-30T05:30:00Z");
    assert.equal(wantsWeekly(sunday, "Europe/Amsterdam", { DIGEST_DAY: "daily" }), false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test 2>&1 | tail -20`
Expected: build failure, `Cannot find module '../src/beats/backups.js'`.

- [ ] **Step 3: Write the beat**

Create `src/beats/backups.ts`:

```ts
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
```

Then register it in `src/index.ts` — one import beside the others and one entry in `BEATS`, both in alphabetical order:

```ts
import { backups } from "./beats/backups.js";
```

```ts
const BEATS: Record<string, (round: Round) => Promise<void>> = {
  alerts,
  backups,
  briefing,
  // ... the rest unchanged
};
```

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Prove each test by mutation**

| Mutation | Must fail |
|---|---|
| catch the read failure and carry on with an empty inventory | both failure tests |
| drop the claims read and pass `[]` | the claim-list test |
| `wantsWeekly` using `now.getUTCDay() === 0` | the zone test |
| `wantsWeekly` ignoring `DIGEST_DAY` | the override test |
| post `body ?? "nothing to report"` instead of returning | the silent-morning test |

- [ ] **Step 6: Commit**

```bash
git add src/beats/backups.ts src/index.ts test/backups.test.ts
git commit -m "feat(backups): the beat, silent unless the night went wrong"
```

---

### Task 4: The briefing gives up its backup half

**Files:**
- Modify: `src/copy/cluster/checks.ts` — `checkVolumes` at 213-260, and the constants at 23-25
- Modify: `src/beats/briefing.ts` — the `volumes` line
- Modify: `test/cluster.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `checkVolumes(kube, deadline)` returning `{ health: string[]; problems: string[] }` — no `now`, no `backups`.

- [ ] **Step 1: Find every caller and every test**

Run:

```bash
grep -rn "checkVolumes\|BACKUP_MAX_AGE_HOURS\|NEW_VOLUME_GRACE_HOURS" src test
```

Expected: `checks.ts` (definition and constants), `briefing.ts` (call), `cluster.test.ts` (tests), and `status.ts` or `verbs.ts` if the interactive verbs use it. Every hit is either updated in this task or deliberately left; there is no third option.

- [ ] **Step 2: Write the failing test**

In `test/cluster.test.ts`, replace the `checkVolumes` backup tests with these two, which pin the new contract:

```ts
it("reports replica robustness, which is health rather than backup", async () => {
  const kube = fakeKube({
    "/apis/longhorn.io/v1beta2/volumes": [
      {
        metadata: { name: "pvc-1" },
        status: {
          robustness: "degraded",
          state: "attached",
          lastBackupAt: "2020-01-01T00:00:00Z",
          kubernetesStatus: { namespace: "campfire", pvcName: "campfire-data" },
        },
      },
    ],
  });
  const result = await checkVolumes(kube, budget(5_000));
  assert.deepEqual(result.problems, ["Volume campfire/campfire-data: degraded"]);
});

it("says nothing about backups, however old they are — that is the backups beat's", async () => {
  const kube = fakeKube({
    "/apis/longhorn.io/v1beta2/volumes": [
      {
        metadata: { name: "pvc-2", creationTimestamp: "2020-01-01T00:00:00Z" },
        status: {
          robustness: "healthy",
          state: "detached",
          kubernetesStatus: { namespace: "database", pvcName: "drill-nightscout-1" },
        },
      },
    ],
  });
  const result = await checkVolumes(kube, budget(5_000));
  assert.deepEqual(result.problems, []);
  assert.equal("backups" in result, false);
});
```

`fakeKube` is already defined at `test/cluster.test.ts:27` and takes a map of
path to items; `budget` is already imported there. Nothing new is needed.

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test 2>&1 | grep -A5 "says nothing about backups"`
Expected: FAIL — the second test finds `Volume database/drill-nightscout-1: never backed up` in `problems`. That failure is the 23 lines the briefing posts every morning, reproduced in one assertion.

- [ ] **Step 4: Cut the backup half out**

In `src/copy/cluster/checks.ts`:
- Change the signature to `checkVolumes(kube: Kube, deadline: Deadline): Promise<{ health: string[]; problems: string[] }>`.
- Delete the `backups` array, the `lastBackupAt` branch and the never-backed-up branch, leaving the robustness check.
- Delete `NEW_VOLUME_GRACE_HOURS`. Keep `BACKUP_MAX_AGE_HOURS`: `checkBackups` still uses it for CloudNativePG.
- Add a comment where the branch was:

```ts
// Backups are not checked here. This function cannot tell a volume whose claim
// is gone from a volume nobody is protecting, and reported the restore drill's
// abandoned scratch volumes as unprotected data every morning for a fortnight.
// The backups beat reads the claims, so it can tell the difference.
```

In `src/beats/briefing.ts`, drop the `now` argument from the call:

```ts
await attempt("volumes", async () => (await checkVolumes(kube, deadline)).problems);
```

- [ ] **Step 5: Run everything**

Run: `npm test 2>&1 | tail -8` and `npm run typecheck`
Expected: PASS, no type errors. If `status.ts` or `verbs.ts` consumed `result.backups`, that is a compile error — remove the caller's use of it there too, and say so in the commit.

- [ ] **Step 6: Prove the removal by mutation**

Put the `lastBackupAt` branch back, run `npm test`, and confirm the "says nothing about backups" test fails. That is the proof the test pins the removal rather than merely passing beside it. Then remove it again.

- [ ] **Step 7: Commit**

```bash
git add src/copy/cluster/checks.ts src/beats/briefing.ts test/cluster.test.ts
git commit -m "refactor(briefing): stop reporting volume backups it cannot judge"
```

---

### Task 5: The documentation

**Files:**
- Modify: `README.md` — the variable table and the beat table

- [ ] **Step 1: Add the beat row**

In the beat table, after `uptime`:

```
| `backups` | Longhorn: what did not back up, and on Sundays what is left behind | shipped |
```

- [ ] **Step 2: Add the variables**

In the variable table:

```
| `KUBE_API` | API base for `briefing` and `backups`, default `https://kubernetes.default.svc` |
| `BACKUP_STALE_HOURS` | past this a volume backup is late; default 26 |
| `BACKUP_LEAK_HOURS` | how long a volume with no claim must persist before it is a leak; default 24 |
| `DIGEST_DAY` | force `backups` to file the `weekly` or `daily` set |
```

- [ ] **Step 3: Note the annotation**

Under the beat table, one paragraph:

```markdown
A volume that is deliberately not backed up says so on its claim:
`backup.stringer/none: "a cache, rebuilt on start"`, as an annotation rather
than a label — a label value cannot hold a sentence. The beat quotes the reason
back, so an exemption nobody can justify reads as one.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: the backups beat, and what it reads"
```

---

### Task 6: The pull request

- [ ] **Step 1: Run everything one more time**

Run: `npm test` and `npm run typecheck`
Expected: all pass. Record the test count.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/backups-beat
gh pr create --title "backups: what Longhorn did not do last night"
```

The body must carry: what the beat reports and what it stays quiet about, the production numbers that shaped it (23 leaked drill volumes, 45 orphan backup sets, nothing stale, target reachable), the briefing hand-off and why, the mutation table for every kept test, and the homelab side that is still needed — a read-only ServiceAccount for `longhorn.io` volumes/backupvolumes/backups/backuptargets plus `persistentvolumeclaims`, and a CronJob at 07:30.

Link the spec: `docs/superpowers/specs/2026-08-28-backups-beat-design.md`.

---

## Afterwards, not in this plan

- **Homelab**: the ServiceAccount, ClusterRole, ClusterRoleBinding and CronJob. Without them the beat runs nowhere; with them it reports on the first morning.
- **The drill leak itself**: `restore-drill` should delete the Longhorn volumes belonging to the scratch clusters it deletes. The beat will keep reporting them every Sunday until it does, which is the point.
- **The orphaned backup sets in MinIO**: 45 of them, and deleting a backup set is not something a reporting beat should do.
