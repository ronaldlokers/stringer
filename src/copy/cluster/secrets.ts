/**
 * Secrets a workload needs but does not have, and copies that have drifted.
 *
 * Two failures this cluster has actually had, neither of which any other check
 * reports:
 *
 * 1. A workload references a Secret that does not exist in its namespace. The
 *    pod sits in CreateContainerConfigError while the Deployment is applied and
 *    the Kustomization is Ready — so Flux says fine, and only the pod knows.
 *    Five apps went down at once that way, pointed at mirrors nobody had
 *    authorised.
 *
 * 2. A copy of a credential drifts from its source. CloudNativePG regenerates
 *    the app password when a Cluster is created, and a namespace-local copy is
 *    not derived from it, so a recreate desynchronises them silently. Immich
 *    returned 500 for four hours before anyone connected the two.
 *
 * Neither is visible from the outside until something is already broken, which
 * is exactly the shape of thing a morning briefing is for.
 *
 * ## On reading Secrets at all
 *
 * This is the first check that needs the verb, so it is worth being explicit
 * about what it does with it.
 *
 * The existence half asks for metadata only — see `Kube.METADATA_ONLY` — so the
 * common case, a list of every Secret in the cluster, never carries a single
 * value. Only names that match a source credential are fetched in full, one at
 * a time, and only one key of each is looked at.
 *
 * Nothing read here is ever rendered. A drift report prints a ten-character
 * SHA-256 prefix of each side, which is enough to tell two values apart and not
 * enough to be one. That is a deliberate property of the output, not an
 * accident of formatting: this text goes to a chat room.
 */

import { createHash } from "node:crypto";

import { Kube } from "./kube.js";
import type { Deadline, Meta } from "./kube.js";

/**
 * Where credentials originate. A Secret here is authoritative; a Secret of the
 * same name anywhere else is a copy, and is compared against it.
 */
export const SOURCE_NAMESPACE = "database";

/**
 * Keys worth comparing. Whole-Secret comparison is noise — a mirror carries
 * extra keys legitimately — so drift is judged on the credential itself.
 */
export const COMPARED_KEYS = ["password"] as const;

const WORKLOADS: readonly [string, string][] = [
  ["/apis/apps/v1/deployments", "Deployment"],
  ["/apis/apps/v1/statefulsets", "StatefulSet"],
  ["/apis/apps/v1/daemonsets", "DaemonSet"],
];

interface SecretKeyRef {
  readonly name?: string;
  readonly optional?: boolean;
}

interface Container {
  readonly env?: readonly { valueFrom?: { secretKeyRef?: SecretKeyRef } }[];
  readonly envFrom?: readonly { secretRef?: SecretKeyRef }[];
}

export interface PodSpec {
  readonly containers?: readonly Container[];
  readonly initContainers?: readonly Container[];
  readonly volumes?: readonly { secret?: { secretName?: string; optional?: boolean } }[];
}

interface Workload {
  readonly metadata: Meta;
  readonly spec?: { template?: { spec?: PodSpec } };
}

interface SecretMeta {
  readonly metadata: Meta;
}

interface Secret extends SecretMeta {
  readonly data?: Record<string, string>;
}

/**
 * Every Secret a pod spec requires.
 *
 * `optional: true` is skipped: the workload is designed to start without it, so
 * reporting it is noise. longhorn-manager references longhorn-grpc-tls that way
 * and runs fine.
 */
export function secretRefs(spec: PodSpec): Set<string> {
  const refs = new Set<string>();
  const wanted = (ref: SecretKeyRef | undefined) => {
    if (ref?.name && !ref.optional) refs.add(ref.name);
  };
  for (const container of [...(spec.containers ?? []), ...(spec.initContainers ?? [])]) {
    for (const entry of container.env ?? []) wanted(entry.valueFrom?.secretKeyRef);
    for (const entry of container.envFrom ?? []) wanted(entry.secretRef);
  }
  for (const volume of spec.volumes ?? []) {
    if (volume.secret?.secretName && !volume.secret.optional) refs.add(volume.secret.secretName);
  }
  return refs;
}

/** Enough of a value to tell it from another value, and no more. */
export function digest(base64: string): string {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex").slice(0, 10);
}

export function missingRefs(
  workloads: readonly { kind: string; item: Workload }[],
  existing: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const { kind, item } of workloads) {
    const namespace = item.metadata.namespace ?? "default";
    for (const name of secretRefs(item.spec?.template?.spec ?? {})) {
      if (existing.has(`${namespace}/${name}`)) continue;
      problems.push(
        `Secret ${namespace}/${name}: referenced by ${kind} ${item.metadata.name}, does not exist`,
      );
    }
  }
  return problems;
}

export function drifted(source: Secret, copy: Secret): string[] {
  const problems: string[] = [];
  const here = copy.data ?? {};
  const there = source.data ?? {};
  for (const key of COMPARED_KEYS) {
    if (!(key in here) || !(key in there)) continue;
    if (here[key] === there[key]) continue;
    problems.push(
      `Secret ${copy.metadata.namespace}/${copy.metadata.name}: ${key} is ` +
        `${digest(here[key]!)} but ${SOURCE_NAMESPACE}/${source.metadata.name} is ` +
        `${digest(there[key]!)}`,
    );
  }
  return problems;
}

export async function checkSecretRefs(kube: Kube, deadline: Deadline): Promise<string[]> {
  // Names only. Every Secret in the cluster, and not one value among them.
  const all = await kube.list<SecretMeta>("/api/v1/secrets", deadline, Kube.METADATA_ONLY);
  const existing = new Set(all.map((s) => `${s.metadata.namespace}/${s.metadata.name}`));

  const workloads: { kind: string; item: Workload }[] = [];
  for (const [path, kind] of WORKLOADS) {
    for (const item of await kube.list<Workload>(path, deadline)) workloads.push({ kind, item });
  }
  const problems = missingRefs(workloads, existing);

  // Now, and only now, values — for the handful of names that exist both in the
  // source namespace and somewhere else.
  const sources = new Set(
    all.filter((s) => s.metadata.namespace === SOURCE_NAMESPACE).map((s) => s.metadata.name),
  );
  const copies = all.filter(
    (s) => s.metadata.namespace !== SOURCE_NAMESPACE && sources.has(s.metadata.name),
  );

  const read = (namespace: string, name: string) =>
    kube.object<Secret>(`/api/v1/namespaces/${namespace}/secrets/${name}`, deadline);

  // One read per source however many copies point at it: five apps mirroring
  // the same credential is the normal case, not the exception.
  const fetched = new Map<string, Promise<Secret>>();
  const source = (name: string) => {
    const known = fetched.get(name);
    if (known) return known;
    const reading = read(SOURCE_NAMESPACE, name);
    fetched.set(name, reading);
    return reading;
  };

  for (const copy of copies) {
    const name = copy.metadata.name;
    const [original, mirror] = await Promise.all([
      source(name),
      read(copy.metadata.namespace!, name),
    ]);
    problems.push(...drifted(original, mirror));
  }
  return problems;
}
