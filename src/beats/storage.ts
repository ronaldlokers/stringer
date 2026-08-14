/**
 * The storage beat: what is growing, and how long the disks have left.
 *
 * The briefing can say a volume is nearly full. It cannot say a volume will be
 * full in March, because that needs history rather than a reading — which is
 * what the 400-day Prometheus is for, and the reason Longhorn's series were
 * added to it.
 *
 * Env:
 *   PROMETHEUS_URL  the long-term instance, not the default one
 *   STORAGE_WINDOW  how far back to fit the line, default 60d
 */

import { escape } from "../copy/alerts/render.js";
import { perWeek, windowDays, type Disk, type Samples, type Volume } from "../copy/storage/forecast.js";
import { pressing, renderStorage, type Report } from "../copy/storage/digest.js";
import { needsAttention } from "../copy/mention.js";
import { describe, warmUp, withRetry } from "../retry.js";
import type { Round } from "../rounds.js";

const TIMEOUT_MS = 30_000;
/** Six-hourly samples: enough to fit a line, few enough to keep the query cheap. */
const STEP_SECONDS = 21_600;

export async function storage(round: Round, environment = process.env): Promise<void> {
  const base =
    environment.PROMETHEUS_URL?.trim() ||
    "http://prometheus-speedtest.monitoring.svc.cluster.local:9090";
  const window = environment.STORAGE_WINDOW?.trim() || "60d";

  await warmUp(new URL("/-/ready", base).toString());

  let report: Report;
  try {
    report = await withRetry(() => measure(base, window), { what: "prometheus" });
  } catch (error) {
    await round.say(
      "<div><strong>💾 could not read the storage history</strong></div>" +
        `<pre>${escape(describe(error))}</pre>`,
    );
    return;
  }

  if (!report.disks.length) {
    process.stdout.write("no disks reported, saying nothing\n");
    return;
  }

  process.stdout.write(
    `${report.disks.length} disks, ${report.volumes.length} volumes, ` +
      `${report.days.toFixed(0)} days of history\n`,
  );

  const html = renderStorage(report);
  // A disk filling inside three months is worth interrupting for; the weekly
  // record is not.
  await round.say(
    pressing(report) ? needsAttention(html, environment.CAMPFIRE_MENTION_SGID) : html,
  );
}

async function measure(base: string, window: string): Promise<Report> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - parseWindow(window);

  const [used, capacity, volumes] = await Promise.all([
    range(base, "sum by (node) (longhorn_disk_usage_bytes)", start, end, (m) => m.node ?? "?"),
    range(base, "sum by (node) (longhorn_disk_capacity_bytes)", start, end, (m) => m.node ?? "?"),
    range(
      base,
      "max by (pvc, pvc_namespace) (longhorn_volume_actual_size_bytes)",
      start,
      end,
      (m) => `${m.pvc_namespace ?? "?"}/${m.pvc ?? "?"}`,
    ),
  ]);

  const disks: Disk[] = [];
  for (const [node, samples] of used.entries()) {
    // Keyed by the node's name rather than by the metric object: two queries
    // return two different objects for the same series, so a Map keyed on the
    // object matches nothing and every disk vanishes silently.
    const size = capacity.get(node);
    if (!size?.length || !samples.length) continue;
    disks.push({
      node,
      used: samples[samples.length - 1]![1],
      capacity: size[size.length - 1]![1],
      perWeek: perWeek(samples),
    });
  }

  const grown: Volume[] = [];
  for (const [key, samples] of volumes.entries()) {
    if (!samples.length) continue;
    const [namespace = "?", name = "?"] = key.split("/");
    grown.push({
      namespace,
      name,
      bytes: samples[samples.length - 1]![1],
      perWeek: perWeek(samples),
    });
  }

  const longest = [...used.values(), ...volumes.values()].reduce<Samples>(
    (best, samples) => (windowDays(samples) > windowDays(best) ? samples : best),
    [],
  );

  return { disks, volumes: grown, days: windowDays(longest) };
}

function parseWindow(window: string): number {
  const match = /^(\d+)([dhw])$/.exec(window);
  if (!match) return 60 * 86_400;
  const size = Number(match[1]);
  const unit = { h: 3_600, d: 86_400, w: 604_800 }[match[2]!]!;
  return size * unit;
}

/** Each series as samples, under a key the caller derives from its labels. */
async function range(
  base: string,
  query: string,
  start: number,
  end: number,
  keyOf: (metric: Record<string, string>) => string,
): Promise<Map<string, Samples>> {
  const url = new URL("/api/v1/query_range", base);
  url.searchParams.set("query", query);
  url.searchParams.set("start", String(start));
  url.searchParams.set("end", String(end));
  url.searchParams.set("step", String(STEP_SECONDS));

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`prometheus answered ${response.status} for ${query}`);
  const body = (await response.json()) as {
    data?: { result?: { metric?: Record<string, string>; values?: [number, string][] }[] };
  };

  const out = new Map<string, Samples>();
  for (const series of body.data?.result ?? []) {
    const samples = (series.values ?? [])
      .map(([at, value]) => [at, Number(value)] as const)
      .filter(([, value]) => Number.isFinite(value));
    out.set(keyOf(series.metric ?? {}), samples);
  }
  return out;
}
