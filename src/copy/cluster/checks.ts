/**
 * What is wrong with the cluster, in sentences.
 *
 * Each check returns problems worth putting in front of someone. A check that
 * cannot run says so rather than returning nothing — an unknown reported as
 * healthy is the one failure mode that makes a briefing worse than having none.
 */

import {
  type Condition,
  type Deadline,
  type Kube,
  type Resource,
  hoursSince,
  minutesSince,
  parseTime,
  readyCondition,
} from "./kube.js";

/** Flux settles or it does not; ten minutes is longer than a reconcile takes. */
export const PROGRESSING_GRACE_MINUTES = 10;
/** A day plus the slack a nightly job needs. */
export const BACKUP_MAX_AGE_HOURS = 26;

const FLUX_KINDS: readonly [string, string][] = [
  ["/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations", "Kustomization"],
  ["/apis/helm.toolkit.fluxcd.io/v2/helmreleases", "HelmRelease"],
];
const CERTIFICATES = "/apis/cert-manager.io/v1/certificates";
const VOLUMES = "/apis/longhorn.io/v1beta2/volumes";

function named(meta: { namespace?: string; name: string }): string {
  return meta.namespace ? `${meta.namespace}/${meta.name}` : meta.name;
}

/**
 * Kustomizations and HelmReleases failing, or stuck not settling.
 *
 * Ready=False is a definite failure and is reported however fresh it is.
 * Ready=Unknown (Flux's Progressing) and a missing condition both mean "not
 * settled yet", which is only worth saying once it has gone on longer than a
 * reconcile plausibly takes.
 */
export async function checkFlux(kube: Kube, deadline: Deadline, now: Date): Promise<string[]> {
  const problems: string[] = [];
  for (const [path, kind] of FLUX_KINDS) {
    for (const item of await kube.list<Resource>(path, deadline)) {
      const condition = readyCondition(item);
      const status = condition?.status;
      if (status === "True") continue;

      let detail = "";
      if (status !== "False") {
        const since = condition?.lastTransitionTime ?? item.metadata.creationTimestamp;
        if (!since) continue;
        const minutes = minutesSince(since, now);
        if (minutes <= PROGRESSING_GRACE_MINUTES) continue; // busy, not broken
        // Say how long. "Reconciliation in progress" on its own reads as
        // routine; the duration is the whole point of reporting it.
        detail = ` (unchanged for ${minutes.toFixed(0)}m)`;
      }
      const reason = condition?.message || condition?.reason || "no Ready condition";
      problems.push(`${kind} ${named(item.metadata)}: ${reason}${detail}`);
    }
  }
  return problems;
}

interface Pod extends Resource {
  readonly status?: {
    phase?: string;
    conditions?: readonly Condition[];
    containerStatuses?: readonly {
      name: string;
      ready?: boolean;
      state?: { waiting?: { reason?: string } };
    }[];
  };
}

/**
 * Why a Pending pod is Pending, and for how long.
 *
 * "Pod x/y: Pending" reads like a pod that is starting. A pod the scheduler has
 * refused for six hours is a different problem with the same word on it, and
 * the reason is what separates them — usually Insufficient cpu/memory, which no
 * other check reports.
 */
export function pendingDetail(pod: Pod, phase: string | undefined, now: Date): string {
  if (phase !== "Pending") return "";
  const parts: string[] = [];
  for (const condition of pod.status?.conditions ?? []) {
    if (condition.type === "PodScheduled" && condition.status !== "True") {
      parts.push(condition.message || condition.reason || "unschedulable");
      break;
    }
  }
  const created = pod.metadata.creationTimestamp;
  if (created) {
    const minutes = minutesSince(created, now);
    parts.push(minutes >= 90 ? `${(minutes / 60).toFixed(0)}h` : `${minutes.toFixed(0)}m`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/**
 * Pods neither running-and-ready nor finished.
 *
 * Every pod, unfiltered: a field selector on status.phase would shrink the
 * response but would also hide CrashLoopBackOff, which sits in Running with a
 * container flapping and is the state most worth seeing.
 */
export async function checkPods(kube: Kube, deadline: Deadline, now: Date): Promise<string[]> {
  const problems: string[] = [];
  for (const pod of await kube.list<Pod>("/api/v1/pods", deadline)) {
    const phase = pod.status?.phase;
    if (phase === "Succeeded") continue; // a finished Job pod, not a fault
    const name = named(pod.metadata);
    if (phase !== "Running") {
      problems.push(`Pod ${name}: ${phase ?? "unknown"}${pendingDetail(pod, phase, now)}`);
      continue;
    }
    for (const container of pod.status?.containerStatuses ?? []) {
      if (container.ready) continue;
      const reason = container.state?.waiting?.reason;
      problems.push(`Pod ${name}: ${container.name} not ready${reason ? ` (${reason})` : ""}`);
    }
  }
  return problems;
}

/**
 * Newest successful backup per PostgreSQL cluster.
 *
 * Reads `Cluster.status.lastSuccessfulBackup` rather than listing Backup
 * objects: one small list instead of every backup ever taken.
 */
export async function checkBackups(
  kube: Kube,
  deadline: Deadline,
  now: Date,
): Promise<{ fresh: string[]; problems: string[] }> {
  const fresh: string[] = [];
  const problems: string[] = [];
  type Cluster = Resource & { status?: { lastSuccessfulBackup?: string } };
  for (const cluster of await kube.list<Cluster>(
    "/apis/postgresql.cnpg.io/v1/clusters",
    deadline,
  )) {
    const name = named(cluster.metadata);
    const stamp = cluster.status?.lastSuccessfulBackup;
    if (!stamp) {
      problems.push(`Backup ${name}: none recorded`);
      continue;
    }
    const age = hoursSince(stamp, now);
    if (age > BACKUP_MAX_AGE_HOURS) {
      problems.push(
        `Backup ${name}: ${age.toFixed(1)}h old, past the ${BACKUP_MAX_AGE_HOURS}h window`,
      );
    } else {
      fresh.push(`${name}: ${age.toFixed(1)}h ago`);
    }
  }
  return { fresh, problems };
}

/**
 * Certificate expiry, and renewals that are overdue.
 *
 * Overdue means past `status.renewalTime` and still not renewed, which is the
 * honest signal: cert-manager renews 30 days out, so a fixed "expires within N
 * days" threshold either fires for a month at a time or is tuned so tight it
 * warns too late. Two certificates once served four months expired — long past
 * renewalTime, and invisible to an expiry threshold nobody had set.
 */
export async function checkCerts(
  kube: Kube,
  deadline: Deadline,
  now: Date,
): Promise<{ listing: string[]; problems: string[] }> {
  const listing: string[] = [];
  const problems: string[] = [];
  type Cert = Resource & { status?: { notAfter?: string; renewalTime?: string } };
  for (const cert of await kube.list<Cert>(CERTIFICATES, deadline)) {
    const name = named(cert.metadata);
    const ready = readyCondition(cert);
    if (!ready || ready.status !== "True") {
      problems.push(`Certificate ${name}: ${ready?.message || "not ready"}`);
    } else if (cert.status?.renewalTime && parseTime(cert.status.renewalTime) < now) {
      const overdue = hoursSince(cert.status.renewalTime, now);
      problems.push(`Certificate ${name}: renewal overdue by ${overdue.toFixed(0)}h`);
    }

    const notAfter = cert.status?.notAfter;
    listing.push(
      notAfter
        ? `${name}: ${(-hoursSince(notAfter, now) / 24).toFixed(0)}d left`
        : `${name}: no expiry recorded`,
    );
  }
  return { listing, problems };
}

/**
 * Longhorn volume health: replica robustness and attach state.
 *
 * Backup freshness is deliberately absent. This check has no view of
 * PersistentVolumeClaims, so it cannot tell a volume whose claim is gone from
 * one nobody is protecting — the backups beat reads the claims and owns that
 * judgment instead.
 */
export async function checkVolumes(
  kube: Kube,
  deadline: Deadline,
): Promise<{ health: string[]; problems: string[] }> {
  const health: string[] = [];
  const problems: string[] = [];
  type Volume = Resource & {
    status?: {
      robustness?: string;
      state?: string;
      lastBackupAt?: string;
      kubernetesStatus?: { namespace?: string; pvcName?: string };
    };
  };
  for (const volume of await kube.list<Volume>(VOLUMES, deadline)) {
    const bound = volume.status?.kubernetesStatus;
    // Fall back to the Longhorn name for a volume with no PVC bound.
    const name = bound?.pvcName ? `${bound.namespace}/${bound.pvcName}` : volume.metadata.name;

    const robustness = volume.status?.robustness ?? "unknown";
    health.push(`${name}: ${robustness}, ${volume.status?.state ?? "unknown"}`);
    if (robustness !== "healthy" && robustness !== "unknown") {
      problems.push(`Volume ${name}: ${robustness}`);
    }

    // Backups are not checked here. This function cannot tell a volume whose claim
    // is gone from a volume nobody is protecting, and reported the restore drill's
    // abandoned scratch volumes as unprotected data every morning for a fortnight.
    // The backups beat reads the claims, so it can tell the difference.
  }
  return { health, problems };
}
