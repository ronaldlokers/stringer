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

  const state: Briefing = { problems, overnight, skipped, windowHours };
  const body = renderBriefing(state);
  if (body === null) {
    process.stdout.write("briefing: nothing to report, saying nothing\n");
    return;
  }
  process.stdout.write(
    `briefing: ${problems.length} problem(s), ${overnight.length} overnight, ` +
      `${skipped.length} not checked\n`,
  );
  await round.say(body);
}
