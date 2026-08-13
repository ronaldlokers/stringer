/**
 * The morning briefing: what the cluster wants you to know, or silence.
 *
 * Deliberately quiet. It runs the same checks the interactive verbs do, once,
 * and posts only when there is something worth waking up to.
 *
 * Env:
 *   KUBE_API               API base, default https://kubernetes.default.svc
 *   PROMETHEUS_URL         where to ask what fired overnight
 *   BRIEFING_WINDOW_HOURS  default 24
 *   DISK_WARN_PERCENT      default 80
 *   BRIEFING_BRIDGE_URL    file through a bridge instead of posting directly
 *   CLUSTER                which cluster this is, when filing through a bridge
 */

import {
  renderBriefing,
  type Briefing,
} from "../copy/cluster/briefing.js";
import { checkBackups, checkCerts, checkFlux, checkPods, checkVolumes } from "../copy/cluster/checks.js";
import { budget, Kube } from "../copy/cluster/kube.js";
import { checkSecretRefs } from "../copy/cluster/secrets.js";
import {
  checkDiskHeadroom,
  checkNodeCerts,
  checkOvernightAlerts,
} from "../copy/cluster/prometheus.js";
import type { Round } from "../rounds.js";

/**
 * Filing from a cluster that has no room of its own.
 *
 * Staging has no Campfire. It could be given a bot key and post directly, and
 * that is precisely what the Flux alerts deliberately do not do: they POST to
 * the bridge in the other cluster, which holds the key and does the posting. So
 * no credential crosses the boundary and there is no second copy to drift.
 *
 * What crosses is the briefing itself — the arrays, not the markup. The bridge's
 * only authentication is that its ingress is LAN-only, so a path taking rendered
 * HTML would let anything on that network post arbitrary markup into a room.
 * Sending data and letting the bridge render it is the same shape as /alerts and
 * /flux, and closes that by construction rather than by validation.
 */
async function fileThroughBridge(url: string, state: Briefing): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`bridge returned ${response.status}`);
}

/**
 * The whole gathering budget.
 *
 * Not the interactive one. `verbs.ts` has five seconds because Campfire hangs
 * up at seven and posts a failure notice over the answer; nothing waits on a
 * CronJob at half past six, so the same number here only bought a briefing that
 * reported checks as unrunnable whenever the API server was slow. That is the
 * one failure mode this beat is built to avoid.
 */
const DEADLINE_MS = 30_000;

export async function briefing(round: Round, environment = process.env): Promise<void> {
  const kube = new Kube(environment.KUBE_API?.trim() || "https://kubernetes.default.svc");
  const prometheus =
    environment.PROMETHEUS_URL?.trim() ||
    "http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090";
  const windowHours = Number(environment.BRIEFING_WINDOW_HOURS ?? "24");
  const diskWarn = Number(environment.DISK_WARN_PERCENT ?? "80");

  const now = new Date();
  const deadline = budget(DEADLINE_MS);
  const problems: string[] = [];
  const skipped: string[] = [];

  /** A check that cannot run says so; it never counts as all clear. */
  const attempt = async (label: string, run: () => Promise<string[]>) => {
    try {
      problems.push(...(await run()));
    } catch (error) {
      skipped.push(`${label}: ${String(error)}`);
    }
  };

  await attempt("flux", () => checkFlux(kube, deadline, now));
  await attempt("pods", () => checkPods(kube, deadline, now));
  await attempt("postgres backups", async () => (await checkBackups(kube, deadline, now)).problems);
  await attempt("certs", async () => (await checkCerts(kube, deadline, now)).problems);
  await attempt("volumes", async () => (await checkVolumes(kube, deadline, now)).problems);
  await attempt("secret references", () => checkSecretRefs(kube, deadline));
  await attempt("node certificates", () => checkNodeCerts(prometheus));
  await attempt("disk headroom", () => checkDiskHeadroom(prometheus, diskWarn));

  let overnight: string[] = [];
  try {
    overnight = await checkOvernightAlerts(prometheus, windowHours, now);
  } catch (error) {
    skipped.push(`overnight alerts: ${String(error)}`);
  }

  const cluster = environment.CLUSTER?.trim();
  const state: Briefing = {
    problems,
    overnight,
    skipped,
    windowHours,
    ...(cluster ? { cluster } : {}),
  };

  // Rendered here even when the bridge will render it again, because silence is
  // the design and that decision belongs to the cluster with the facts. A
  // briefing that arrives every morning saying everything is fine is one you
  // stop opening.
  const body = renderBriefing(state);
  if (body === null) {
    process.stdout.write("briefing: nothing to report, saying nothing\n");
    return;
  }
  process.stdout.write(
    `briefing: ${problems.length} problem(s), ${overnight.length} overnight, ` +
      `${skipped.length} not checked\n`,
  );

  const bridge = environment.BRIEFING_BRIDGE_URL?.trim();
  if (bridge) {
    await fileThroughBridge(bridge, state);
    process.stdout.write("filed through the bridge\n");
    return;
  }
  await round.say(body);
}
