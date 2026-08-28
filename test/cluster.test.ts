/**
 * The checks, and the rule that a briefing may say nothing.
 *
 * These run against fixed API payloads rather than a cluster: what matters is
 * which sentences come out, and when nothing does.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderBriefing } from "../src/copy/cluster/briefing.js";
import {
  BACKUP_MAX_AGE_HOURS,
  PROGRESSING_GRACE_MINUTES,
  checkBackups,
  checkCerts,
  checkFlux,
  checkPods,
  checkVolumes,
} from "../src/copy/cluster/checks.js";
import { budget, type Deadline, type Kube } from "../src/copy/cluster/kube.js";

const NOW = new Date("2026-08-13T07:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

/** A Kube that answers from a table rather than a cluster. */
function fakeKube(byPath: Record<string, unknown[]>): Kube {
  return {
    async list(path: string) {
      const key = Object.keys(byPath).find((candidate) => path.startsWith(candidate));
      return (key ? byPath[key]! : []) as never[];
    },
  } as unknown as Kube;
}

const DEADLINE: Deadline = { remaining: () => 5_000 };

describe("flux", () => {
  it("reports Ready=False however fresh it is", async () => {
    const kube = fakeKube({
      "/apis/kustomize": [
        {
          metadata: { namespace: "flux-system", name: "apps", creationTimestamp: ago(0.01) },
          status: { conditions: [{ type: "Ready", status: "False", message: "build failed" }] },
        },
      ],
    });
    const problems = await checkFlux(kube, DEADLINE, NOW);
    assert.deepEqual(problems, ["Kustomization flux-system/apps: build failed"]);
  });

  it("leaves something still settling alone", async () => {
    const kube = fakeKube({
      "/apis/kustomize": [
        {
          metadata: { namespace: "flux-system", name: "apps" },
          status: {
            conditions: [
              { type: "Ready", status: "Unknown", lastTransitionTime: ago(0.05) },
            ],
          },
        },
      ],
    });
    assert.deepEqual(await checkFlux(kube, DEADLINE, NOW), []);
  });

  it("says how long once it has stopped being routine", async () => {
    const minutes = PROGRESSING_GRACE_MINUTES + 50;
    const kube = fakeKube({
      "/apis/kustomize": [
        {
          metadata: { namespace: "flux-system", name: "apps" },
          status: {
            conditions: [
              {
                type: "Ready",
                status: "Unknown",
                reason: "Progressing",
                lastTransitionTime: ago(minutes / 60),
              },
            ],
          },
        },
      ],
    });
    const [problem] = await checkFlux(kube, DEADLINE, NOW);
    assert.match(problem!, /unchanged for 60m/);
  });
});

describe("pods", () => {
  const pod = (over: Record<string, unknown>) => ({
    metadata: { namespace: "app", name: "web", creationTimestamp: ago(3) },
    ...over,
  });

  it("ignores a finished job pod", async () => {
    const kube = fakeKube({ "/api/v1/pods": [pod({ status: { phase: "Succeeded" } })] });
    assert.deepEqual(await checkPods(kube, DEADLINE, NOW), []);
  });

  it("catches a container flapping inside a Running pod", async () => {
    const kube = fakeKube({
      "/api/v1/pods": [
        pod({
          status: {
            phase: "Running",
            containerStatuses: [
              { name: "web", ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } },
            ],
          },
        }),
      ],
    });
    const [problem] = await checkPods(kube, DEADLINE, NOW);
    assert.equal(problem, "Pod app/web: web not ready (CrashLoopBackOff)");
  });

  it("separates a pod that is starting from one the scheduler refused", async () => {
    const kube = fakeKube({
      "/api/v1/pods": [
        pod({
          status: {
            phase: "Pending",
            conditions: [
              { type: "PodScheduled", status: "False", message: "Insufficient cpu" },
            ],
          },
        }),
      ],
    });
    const [problem] = await checkPods(kube, DEADLINE, NOW);
    assert.equal(problem, "Pod app/web: Pending (Insufficient cpu, 3h)");
  });
});

describe("backups", () => {
  it("passes one inside the window and flags one past it", async () => {
    const kube = fakeKube({
      "/apis/postgresql": [
        {
          metadata: { namespace: "database", name: "fresh" },
          status: { lastSuccessfulBackup: ago(2) },
        },
        {
          metadata: { namespace: "database", name: "stale" },
          status: { lastSuccessfulBackup: ago(BACKUP_MAX_AGE_HOURS + 5) },
        },
        { metadata: { namespace: "database", name: "never" }, status: {} },
      ],
    });
    const { fresh, problems } = await checkBackups(kube, DEADLINE, NOW);
    assert.deepEqual(fresh, ["database/fresh: 2.0h ago"]);
    assert.equal(problems.length, 2);
    assert.match(problems[0]!, /past the 26h window/);
    assert.match(problems[1]!, /none recorded/);
  });
});

describe("certificates", () => {
  it("flags a renewal that is overdue rather than guessing at expiry", async () => {
    const kube = fakeKube({
      "/apis/cert-manager": [
        {
          metadata: { namespace: "web", name: "site" },
          status: {
            conditions: [{ type: "Ready", status: "True" }],
            renewalTime: ago(50),
            notAfter: new Date(NOW.getTime() + 40 * 86_400_000).toISOString(),
          },
        },
      ],
    });
    const { listing, problems } = await checkCerts(kube, DEADLINE, NOW);
    assert.deepEqual(problems, ["Certificate web/site: renewal overdue by 50h"]);
    assert.deepEqual(listing, ["web/site: 40d left"]);
  });
});

describe("volumes", () => {
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
});

describe("the briefing", () => {
  const empty = { problems: [], overnight: [], skipped: [], windowHours: 24 };

  it("says nothing about a clean cluster", () => {
    assert.equal(renderBriefing(empty), null);
  });

  it("speaks up when a check could not run, because that is not silence", () => {
    const body = renderBriefing({ ...empty, skipped: ["pods: HTTP 429"] });
    assert.ok(body);
    assert.match(body, /not checked/);
  });

  it("counts problems, and folds a long list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Pod app/p${i}: Pending`);
    const body = renderBriefing({ ...empty, problems: many })!;
    assert.match(body, /20 problems/);
    assert.match(body, /… and 5 more/);
  });

  it("escapes what it puts in the room", () => {
    const body = renderBriefing({ ...empty, problems: ["<script>x</script>"] })!;
    assert.ok(!body.includes("<script>"));
  });
});

describe("the budget", () => {
  it("counts down", async () => {
    const deadline = budget(50);
    assert.ok(deadline.remaining() <= 50);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(deadline.remaining() < 0);
  });
});
