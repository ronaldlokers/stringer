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
