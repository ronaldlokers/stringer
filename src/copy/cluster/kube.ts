/**
 * Reading the Kubernetes API, against a budget.
 *
 * Every read is served from the API server's watch cache rather than etcd:
 * `resourceVersion=0` is what a controller's informer does on first list, and
 * it is the difference between a quorum read of every pod in the cluster and a
 * copy out of memory.
 *
 * Without it, six unfiltered cluster-wide lists in a five-second burst tripped
 * API Priority and Fairness, and two invocations in three came back with parts
 * of the answer replaced by a 429. Degrading honestly is the point of that
 * branch, but a summary that is degraded half the time is one you stop reading.
 *
 * The cost is that a read may be very slightly stale. For a summary that
 * already reports backup ages in hours, that is not a cost.
 */

import { readFile } from "node:fs/promises";

const TOKEN_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/token";

/**
 * The cluster CA is trusted through NODE_EXTRA_CA_CERTS, set by the image's
 * entrypoint rather than here: Node reads that variable once at startup, so a
 * program cannot arrange its own trust after the fact.
 *
 * Worth knowing because the failure gives you nothing. An untrusted API server
 * surfaces as a bare `TypeError: fetch failed`, with no mention of a
 * certificate anywhere, and every check reports itself unavailable while
 * Prometheus — plain HTTP — keeps working.
 */
export const CA_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

/** Per-request ceiling, well inside the overall budget. */
const PER_REQUEST_MS = 1_500;

export interface Deadline {
  /** Milliseconds remaining, from a monotonic clock. */
  readonly remaining: () => number;
}

export function budget(milliseconds: number): Deadline {
  const started = performance.now();
  return { remaining: () => milliseconds - (performance.now() - started) };
}

export interface KubeList<T> {
  readonly items?: readonly T[];
}

export class Kube {
  constructor(private readonly base: string) {}

  /** A raw read, for the tools `why` uses. Unbounded by the verb deadline:
   *  it runs on the asynchronous path, where nothing is waiting. */
  async text(path: string): Promise<string> {
    const headers: Record<string, string> = {};
    const token = await readFile(TOKEN_FILE, "utf8").catch(() => null);
    if (token) headers["Authorization"] = `Bearer ${token.trim()}`;
    const response = await fetch(`${this.base}${path}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    return response.text();
  }

  /**
   * Ask the API server for metadata and nothing else.
   *
   * A list of Secrets normally arrives with every value in it. This header is
   * how a controller says it only wants names — the API server drops the rest
   * server-side, so the values never cross the wire and are never in this
   * process's memory to be logged by accident.
   *
   * RBAC cannot express the same restriction: `list` on secrets is `list` on
   * secrets. This is a narrower request under the same grant, which is worth
   * doing anyway.
   */
  static readonly METADATA_ONLY = "application/json;as=PartialObjectMetadataList;v=v1;g=meta.k8s.io";

  /** One object rather than a collection. */
  async object<T>(path: string, deadline: Deadline): Promise<T> {
    return (await this.json(path, deadline)) as T;
  }

  async list<T>(
    path: string,
    deadline: Deadline,
    accept = "application/json",
  ): Promise<readonly T[]> {
    const payload = (await this.json(path, deadline, accept)) as KubeList<T>;
    return payload.items ?? [];
  }

  private async json(
    path: string,
    deadline: Deadline,
    accept = "application/json",
  ): Promise<unknown> {
    const remaining = deadline.remaining();
    if (remaining <= 0) throw new Error(`budget spent before ${path}`);

    const headers: Record<string, string> = { Accept: accept };
    // Re-read per call. The projected token is short-lived and rotated in
    // place, so a value cached at startup stops working within the hour.
    const token = await readFile(TOKEN_FILE, "utf8").catch(() => null);
    if (token) headers["Authorization"] = `Bearer ${token.trim()}`;

    const separator = path.includes("?") ? "&" : "?";
    const response = await fetch(`${this.base}${path}${separator}resourceVersion=0`, {
      headers,
      signal: AbortSignal.timeout(Math.min(PER_REQUEST_MS, remaining)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    return response.json();
  }
}

export interface Condition {
  readonly type?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly lastTransitionTime?: string;
}

export interface Meta {
  readonly name: string;
  readonly namespace?: string;
  readonly creationTimestamp?: string;
}

export interface Resource {
  readonly metadata: Meta;
  readonly status?: { conditions?: readonly Condition[] } & Record<string, unknown>;
}

export function readyCondition(object: Resource): Condition | null {
  return object.status?.conditions?.find((c) => c.type === "Ready") ?? null;
}

export function parseTime(stamp: string): Date {
  return new Date(stamp);
}

export function hoursSince(stamp: string, now: Date): number {
  return (now.getTime() - parseTime(stamp).getTime()) / 3_600_000;
}

export function minutesSince(stamp: string, now: Date): number {
  return (now.getTime() - parseTime(stamp).getTime()) / 60_000;
}
