/**
 * The deterministic verbs: what is wrong, and the listings behind it.
 *
 * Every one of these reads the API and formats what it finds. None costs
 * money, none can be prompt-injected, and all of them are open to anyone in
 * the room.
 */

import { bullets, heading } from "./briefing.js";
import { checkBackups, checkCerts, checkFlux, checkPods, checkVolumes } from "./checks.js";
import { budget, type Kube } from "./kube.js";

/** Finish well inside Campfire's seven seconds: a partial answer beats a
 *  timeout notice posted over the top of it. */
export const DEADLINE_MS = 5_000;

export const HELP =
  heading("commands") +
  "<ul>" +
  "<li><code>status</code> — anything currently wrong, across every check</li>" +
  "<li><code>certs</code> — certificate expiry per Ingress</li>" +
  "<li><code>backups</code> — Postgres cluster backup recency</li>" +
  "<li><code>longhorn</code> — volume health and replica state (backup recency moved to the <code>backups</code> beat)</li>" +
  "<li><code>why</code> — ask a model to explain a failure (operator only)</li>" +
  "<li><code>reconcile &lt;kustomization&gt;</code> — ask Flux to sync now (operator only)</li>" +
  "<li><code>restart &lt;namespace&gt;/&lt;deployment&gt;</code> — roll a workload (operator only)</li>" +
  "<li><code>help</code> — this</li>" +
  "</ul>";

/**
 * Anything currently wrong, across every check.
 *
 * Never claims green over a section that was never fetched. A check that could
 * not run is an unknown, and an unknown reported as healthy is the one failure
 * mode that makes this worse than having no bot.
 */
export async function renderStatus(kube: Kube, now = new Date()): Promise<string> {
  const deadline = budget(DEADLINE_MS);
  const problems: string[] = [];
  const skipped: string[] = [];
  let fresh: string[] = [];

  const attempt = async (label: string, run: () => Promise<string[]>) => {
    try {
      problems.push(...(await run()));
    } catch (error) {
      skipped.push(`${label}: ${String(error)}`);
    }
  };

  await attempt("flux", () => checkFlux(kube, deadline, now));
  await attempt("pods", () => checkPods(kube, deadline, now));
  try {
    const backups = await checkBackups(kube, deadline, now);
    fresh = backups.fresh;
    problems.push(...backups.problems);
  } catch (error) {
    skipped.push(`postgres backups: ${String(error)}`);
  }
  // The certificate and volume listings belong to their own verbs; status
  // takes only what is wrong, so it stays short enough to read at a glance.
  await attempt("certs", async () => (await checkCerts(kube, deadline, now)).problems);
  await attempt("volumes", async () => (await checkVolumes(kube, deadline)).problems);

  const parts: string[] = [];
  if (problems.length) {
    parts.push(
      heading(`⚠️ ${problems.length} problem${problems.length === 1 ? "" : "s"}`),
      bullets(problems),
    );
  } else if (skipped.length) {
    parts.push(heading("❓ nothing failing in what could be read"));
  } else {
    parts.push(heading("✅ all green"));
  }

  if (fresh.length) parts.push(heading("postgres backups") + bullets(fresh));
  if (skipped.length) parts.push(heading("not checked") + bullets(skipped));
  return parts.join("");
}

export async function renderCerts(kube: Kube, now = new Date()): Promise<string> {
  const { listing, problems } = await checkCerts(kube, budget(DEADLINE_MS), now);
  return (
    (problems.length ? heading(`⚠️ ${problems.length}`) + bullets(problems) : "") +
    heading("certificates") +
    bullets(listing)
  );
}

/**
 * Postgres cluster backup recency.
 *
 * Longhorn backup ages used to live here too, read straight off
 * `lastBackupAt` with no view of PersistentVolumeClaims — the blind spot that
 * had `checkVolumes` reporting the restore drill's abandoned scratch volumes
 * as unprotected data. That reporting now belongs to the backups beat, which
 * reads the claims and can tell the difference; ask it, not this verb.
 */
export async function renderBackups(kube: Kube, now = new Date()): Promise<string> {
  const postgres = await checkBackups(kube, budget(DEADLINE_MS), now);
  return heading("postgres clusters") + bullets([...postgres.fresh, ...postgres.problems]);
}

export async function renderLonghorn(kube: Kube): Promise<string> {
  const { health, problems } = await checkVolumes(kube, budget(DEADLINE_MS));
  return (
    (problems.length ? heading(`⚠️ ${problems.length}`) + bullets(problems) : "") +
    heading("volumes") +
    bullets(health)
  );
}

export async function renderVerb(verb: string, kube: Kube, now = new Date()): Promise<string> {
  switch (verb) {
    case "certs":
      return renderCerts(kube, now);
    case "backups":
      return renderBackups(kube, now);
    case "longhorn":
      return renderLonghorn(kube);
    default:
      return renderStatus(kube, now);
  }
}
