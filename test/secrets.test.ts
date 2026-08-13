/**
 * The secret-reference check.
 *
 * The two cases worth pinning are the two that have actually happened: a
 * reference to a Secret that is not there, and a copy that stopped matching its
 * source. Everything else here exists to make sure neither is reported when it
 * has not happened — a briefing that cries wolf is one you stop reading, which
 * is the failure this whole beat is built to avoid.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPARED_KEYS,
  SOURCE_NAMESPACE,
  digest,
  drifted,
  missingRefs,
  secretRefs,
} from "../src/copy/cluster/secrets.js";

const workload = (name: string, spec: object) => ({
  kind: "Deployment",
  item: { metadata: { name, namespace: "app" }, spec: { template: { spec } } },
});

test("collects every shape of secret reference a pod spec can hold", () => {
  const refs = secretRefs({
    containers: [
      { env: [{ valueFrom: { secretKeyRef: { name: "from-env" } } }] },
      { envFrom: [{ secretRef: { name: "from-envfrom" } }] },
    ],
    initContainers: [{ env: [{ valueFrom: { secretKeyRef: { name: "from-init" } } }] }],
    volumes: [{ secret: { secretName: "from-volume" } }],
  });
  assert.deepEqual([...refs].sort(), ["from-env", "from-envfrom", "from-init", "from-volume"]);
});

test("skips optional references, which the workload runs without by design", () => {
  const refs = secretRefs({
    containers: [
      {
        env: [{ valueFrom: { secretKeyRef: { name: "tls", optional: true } } }],
        envFrom: [{ secretRef: { name: "extra", optional: true } }],
      },
    ],
    volumes: [{ secret: { secretName: "certs", optional: true } }],
  });
  assert.equal(refs.size, 0);
});

test("a reference with no name is not a reference", () => {
  assert.equal(secretRefs({ containers: [{ env: [{ valueFrom: {} }] }] }).size, 0);
});

test("reports a reference to a Secret that does not exist", () => {
  const problems = missingRefs(
    [workload("immich", { containers: [{ envFrom: [{ secretRef: { name: "db" } }] }] })],
    new Set(["other/db"]),
  );
  assert.deepEqual(problems, [
    "Secret app/db: referenced by Deployment immich, does not exist",
  ]);
});

test("a Secret in the same namespace satisfies the reference", () => {
  const problems = missingRefs(
    [workload("immich", { containers: [{ envFrom: [{ secretRef: { name: "db" } }] }] })],
    new Set(["app/db"]),
  );
  assert.deepEqual(problems, []);
});

test("a workload with no namespace is judged against default", () => {
  const problems = missingRefs(
    [
      {
        kind: "DaemonSet",
        item: {
          metadata: { name: "agent" },
          spec: { template: { spec: { volumes: [{ secret: { secretName: "tls" } }] } } },
        },
      },
    ],
    new Set(["default/tls"]),
  );
  assert.deepEqual(problems, []);
});

const secret = (namespace: string, name: string, password: string) => ({
  metadata: { namespace, name },
  data: { password: Buffer.from(password).toString("base64") },
});

test("reports a copy whose credential no longer matches its source", () => {
  const problems = drifted(
    secret(SOURCE_NAMESPACE, "immich-app", "new"),
    secret("immich", "immich-app", "old"),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /^Secret immich\/immich-app: password is [0-9a-f]{10} but database\/immich-app is [0-9a-f]{10}$/);
});

test("a drift report carries digests, never the credential", () => {
  const problems = drifted(
    secret(SOURCE_NAMESPACE, "immich-app", "hunter2"),
    secret("immich", "immich-app", "correct-horse"),
  );
  const line = problems[0]!;
  assert.ok(!line.includes("hunter2"), line);
  assert.ok(!line.includes("correct-horse"), line);
  // Nor the base64 that a careless template would interpolate instead.
  assert.ok(!line.includes(Buffer.from("hunter2").toString("base64")), line);
});

test("identical credentials say nothing", () => {
  assert.deepEqual(
    drifted(secret(SOURCE_NAMESPACE, "immich-app", "same"), secret("immich", "immich-app", "same")),
    [],
  );
});

test("a copy that carries none of the compared keys is not drift", () => {
  const problems = drifted(secret(SOURCE_NAMESPACE, "immich-app", "p"), {
    metadata: { namespace: "immich", name: "immich-app" },
    data: { username: "aW1taWNo" },
  });
  assert.deepEqual(problems, []);
});

test("distinct values get distinct digests, and equal values equal ones", () => {
  const a = Buffer.from("one").toString("base64");
  const b = Buffer.from("two").toString("base64");
  assert.notEqual(digest(a), digest(b));
  assert.equal(digest(a), digest(a));
  assert.equal(digest(a).length, 10);
});

test("password is the key drift is judged on", () => {
  assert.deepEqual([...COMPARED_KEYS], ["password"]);
});
