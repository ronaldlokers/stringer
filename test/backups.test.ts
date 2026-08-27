import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inventoryFrom } from "../src/copy/backups/inventory.js";
import { findingsFrom, renderBackups } from "../src/copy/backups/findings.js";
import type { Inventory, VolumeEntry } from "../src/copy/backups/inventory.js";

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

  it("drops an errored backup for a volume nobody claims any more", () => {
    // The volume is still there but has no live claim, so it's already
    // counted as an orphan; a failure for it too would be double-counted noise.
    const backup = {
      metadata: { name: "backup-abc", labels: { longhornvolume: "pvc-9" } },
      status: { state: "Error", error: "the target refused the connection" },
    };
    const model = inventoryFrom(
      [volume({ name: "pvc-9", pvc: "drill-immich-1", namespace: "database" })],
      [],
      [backup],
      [],
      [],
    );
    assert.deepEqual(model.failures, []);
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
    assert.match(found[0]!.text, /3\.2 GB/);
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
