/**
 * The things the Kubernetes API cannot answer.
 *
 * Node certificates and disk headroom are not in the API at all, and an alert
 * that already resolved exists nowhere else.
 */

const TIMEOUT_MS = 10_000;
/** k3s renews well before this; a warning here means nothing renewed it. */
export const K3S_CERT_WARN_DAYS = 30;
/** Alerts that exist to prove the pipeline works, not to be read. */
const ALERT_EXCLUDE = new Set(["Watchdog", "InfoInhibitor"]);

export interface Series {
  readonly metric: Record<string, string>;
  readonly value?: [number, string];
}

/**
 * One Prometheus read. Anything but an explicit success is an error.
 *
 * A query that half-worked must not read as "nothing found" — that is the
 * difference between a quiet morning and an unnoticed blind spot, and a
 * briefing reports the two differently.
 */
export async function promQuery(
  base: string,
  path: string,
  params: Record<string, string>,
): Promise<Series[]> {
  const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`prometheus returned ${response.status}`);
  const payload = (await response.json()) as {
    status?: string;
    error?: string;
    data?: { result?: Series[] };
  };
  if (payload.status !== "success") {
    throw new Error(payload.error ?? "prometheus rejected the query");
  }
  return payload.data?.result ?? [];
}

/**
 * k3s's own certificates, which cert-manager knows nothing about.
 *
 * The metric is scraped continuously, unlike the expiry events, which are kept
 * about an hour — so a once-a-day job would usually run when none exist and
 * report all clear.
 *
 * Aggregated per node because all thirteen certificates on a node share one
 * expiry; without the min() a single stale node fills the whole message.
 */
export async function checkNodeCerts(base: string): Promise<string[]> {
  const series = await promQuery(base, "/api/v1/query", {
    query:
      `min by (instance) (k3s_certificate_expiration_seconds) < ${K3S_CERT_WARN_DAYS * 86400}`,
  });
  const problems = series.map((one) => {
    const node = (one.metric["instance"] ?? "?").split(":")[0];
    const days = Number(one.value?.[1] ?? 0) / 86400;
    return `k3s certificates on ${node}: ${days.toFixed(0)}d left`;
  });
  // One node reports on two ports; the certificates behind them are the same.
  return [...new Set(problems)].sort();
}

/** Longhorn disks past the point where a replica rebuild still fits. */
export async function checkDiskHeadroom(base: string, warnPercent: number): Promise<string[]> {
  const series = await promQuery(base, "/api/v1/query", {
    query: `100 * longhorn_disk_usage_bytes / longhorn_disk_capacity_bytes > ${warnPercent}`,
  });
  return series.map((one) => {
    const node = one.metric["node"] ?? "?";
    const used = Number(one.value?.[1] ?? 0);
    return `Longhorn disk on ${node}: ${used.toFixed(0)}% used, past ${warnPercent.toFixed(0)}%`;
  });
}

/**
 * Alert names that were firing at any point in the window.
 *
 * Alertmanager keeps no history worth reading and a chat room cannot be read
 * back, but ALERTS is an ordinary series, so a range query answers "what fired
 * overnight" without holding any state.
 *
 * Deliberately reports names and not much else. An alert still firing is
 * already in the checks above; the value here is the one that fired at 03:00
 * and resolved itself, which is invisible everywhere else.
 */
export async function checkOvernightAlerts(
  base: string,
  windowHours: number,
  now: Date,
): Promise<string[]> {
  const series = await promQuery(base, "/api/v1/query_range", {
    query: 'ALERTS{alertstate="firing"}',
    start: iso(new Date(now.getTime() - windowHours * 3_600_000)),
    end: iso(now),
    // Coarse on purpose: this asks which alerts existed, not when.
    step: "5m",
  });

  const counts = new Map<string, number>();
  for (const one of series) {
    const name = one.metric["alertname"];
    if (!name || ALERT_EXCLUDE.has(name)) continue;
    // The same alert on twenty pods is one line, not twenty.
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, count]) => (count > 1 ? `${name} (×${count})` : name));
}

function iso(when: Date): string {
  return `${when.toISOString().slice(0, 19)}Z`;
}
