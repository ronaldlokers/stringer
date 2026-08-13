/**
 * The alerts beat: Alertmanager and Flux, turned into something readable.
 *
 * Alertmanager can only POST its own JSON to a static URL, and a chat bot
 * endpoint treats the whole request body as the message — so pointing one at
 * the other puts raw JSON in the room. This sits between them.
 *
 * Unlike every other beat this one is long-running: it listens rather than
 * being woken by a schedule, and it keeps a little state so that an alert group
 * can be amended as its members resolve.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { Groups, hasEscalated } from "../copy/alerts/groups.js";
import { renderBriefing, type Briefing } from "../copy/cluster/briefing.js";
import { Reported, renderCheck, renderClear, type Check } from "../copy/cluster/check.js";
import {
  firingFingerprints,
  render,
  renderFlux,
  type AlertPayload,
  type FluxPayload,
  type Silencing,
} from "../copy/alerts/render.js";
import { roundFrom, type Round } from "../rounds.js";

/**
 * Paths whose absence has to be reported here, because nothing else would.
 */
const REQUIRED = new Set(["/alerts", "/flux"]);

export interface Bridge {
  readonly close: () => Promise<void>;
  readonly port: number;
}

/**
 * Run the bridge. Resolves when the server is listening; the returned handle
 * closes it, which is what the tests use.
 */
export async function alerts(_unused: Round, environment = process.env): Promise<void> {
  const bridge = await listen(environment);
  process.stdout.write(`listening on :${bridge.port}\n`);
  // A beat normally files and exits. This one stays up, so hold the process
  // until something stops it.
  await new Promise<void>((resolve) => {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        void bridge.close().then(resolve);
      });
    }
  });
}

export async function listen(environment: NodeJS.ProcessEnv): Promise<Bridge> {
  // One destination per source, each its own room. Gatus is absent on purpose:
  // its `custom` alerting provider templates its own body, so it posts directly
  // and needs nothing here.
  const destinations = new Map<string, Round | null>([
    ["/alerts", roundFor(environment.CAMPFIRE_URL ?? environment.ALERTS_ROOM_URL)],
    ["/flux", roundFor(environment.CAMPFIRE_FLUX_URL ?? environment.FLUX_ROOM_URL)],
    // Where a cluster with no Campfire of its own files its morning briefing.
    // The same room this cluster's briefing posts to directly — one room, two
    // clusters, each labelled.
    ["/briefing", roundFor(environment.CAMPFIRE_BRIEFING_URL)],
    // Where the scheduled checks file what they found. The briefing's room by
    // default, because a check's finding is the same news as the briefing's and
    // belongs beside it — and because a second URL here would be a second copy
    // of one credential, which is the drift this bridge exists to avoid. Its
    // own only if it is ever given one.
    ["/check", roundFor(environment.CAMPFIRE_CHECK_URL ?? environment.CAMPFIRE_BRIEFING_URL)],
  ]);
  const silencing: Silencing = {
    grafanaBase: environment.GRAFANA_BASE?.trim() || "https://grafana.ronaldlokers.nl",
    datasource: environment.SILENCE_DATASOURCE?.trim() || "Alertmanager",
  };
  const groups = new Groups();
  const reported = new Reported();

  for (const [path, round] of destinations) {
    if (!round && REQUIRED.has(path)) {
      process.stdout.write(
        `no destination configured for ${path}; /healthz serves 503 until there is\n`,
      );
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response, destinations, groups, reported, silencing);
  });

  const port = Number(environment.LISTEN_PORT ?? "8080");
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const bound = (server.address() as { port: number }).port;
  return {
    port: bound,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function roundFor(url: string | undefined): Round | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return roundFrom({ ROOM_URL: trimmed.includes("+") ? trimmed : `campfire+${trimmed}` });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  destinations: Map<string, Round | null>,
  groups: Groups,
  reported: Reported,
  silencing: Silencing,
): Promise<void> {
  const path = (request.url ?? "").split("?")[0]!;

  if (request.method === "GET") {
    // Probes. Report unhealthy when a destination is unconfigured rather than
    // accepting events and dropping them — but only for the paths whose senders
    // cannot report the problem themselves. Alertmanager and Flux retry a 404
    // in silence, so an unconfigured room there is invisible unless this says
    // so. A briefing is filed by a Job, which fails visibly in the cluster that
    // sent it, so requiring that room here would only mean a bridge with no
    // second cluster reports itself broken forever.
    const missing = [...destinations]
      .filter(([name, round]) => !round && REQUIRED.has(name))
      .map(([name]) => name);
    const ok = path === "/healthz" && missing.length === 0;
    response.writeHead(ok ? 200 : 503);
    response.end(ok ? "ok" : `unconfigured: ${missing.join(", ")}`);
    return;
  }

  const round = destinations.get(path);
  if (!round) {
    process.stdout.write(`no destination for ${path}\n`);
    response.writeHead(404);
    response.end();
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await body(request));
  } catch (error) {
    process.stdout.write(`bad payload: ${String(error)}\n`);
    response.writeHead(400);
    response.end();
    return;
  }

  try {
    if (path === "/alerts") {
      // Alerts have a life beyond one message: the same group is amended as
      // its members resolve. Flux events are one-shot.
      const what = await deliverAlerts(round, groups, payload as AlertPayload, silencing);
      const count = (payload as AlertPayload).alerts?.length ?? 0;
      process.stdout.write(`/alerts: ${count} alert(s), ${what}\n`);
    } else if (path === "/briefing") {
      // Data in, markup out. The sender ships what it found and this renders
      // it, same as the other two paths — which is what keeps a LAN-only
      // ingress from also being a way to post arbitrary HTML into a room.
      const html = renderBriefing(asBriefing(payload));
      if (html === null) {
        // A briefing with nothing in it is not an error; it is the state this
        // whole beat exists to produce. Accept it and say nothing.
        process.stdout.write("/briefing: nothing to report, saying nothing\n");
      } else {
        await round.say(html);
        process.stdout.write("/briefing: published\n");
      }
    } else if (path === "/check") {
      // A check files what it found on every run, including nothing, and the
      // bridge decides whether that is worth saying. Deciding here rather than
      // in each check keeps the state in one process instead of two scripts,
      // and keeps a check to the one thing it is good at.
      const report = asCheck(payload);
      const what = await deliverCheck(round, reported, report);
      process.stdout.write(`/check: ${report.check}: ${what}\n`);
    } else {
      await round.say(renderFlux(payload as FluxPayload));
      process.stdout.write("/flux: published 1 event(s)\n");
    }
    response.writeHead(200);
  } catch (error) {
    // 5xx so the sender retries: a chat message nobody sent is
    // indistinguishable from an event that never happened.
    process.stdout.write(`${path}: publish failed: ${String(error)}\n`);
    response.writeHead(500);
  }
  response.end();
}

export async function deliverAlerts(
  round: Round,
  groups: Groups,
  payload: AlertPayload,
  silencing: Silencing,
): Promise<string> {
  const html = render(payload, silencing);
  if (html === null) return "nothing to say";

  const groupKey = payload.groupKey;
  const firing = firingFingerprints(payload);
  const resolved = payload.status === "resolved";

  const known = groups.get(groupKey);
  if (known && !hasEscalated(known, firing)) {
    const posted = await round.amend(known.id, html);
    if (resolved) {
      groups.forget(groupKey);
    } else if (posted.id) {
      // The handle may be new: a transport that cannot amend posted instead,
      // and the next amendment has to aim at what it actually said.
      groups.remember(groupKey, posted.id, firing);
    }
    return `amended message ${known.id}`;
  }

  const posted = await round.say(html);
  if (posted.id && !resolved) groups.remember(groupKey, posted.id, firing);
  return `posted message ${posted.id ?? "?"}`;
}

/**
 * A check's findings, said or not said.
 *
 * The record is written after the post, never before: a failed post answers
 * 500 and the sender retries, and a report already remembered would make that
 * retry silent — the finding lost to the machinery meant to carry it.
 */
export async function deliverCheck(
  round: Round,
  reported: Reported,
  report: Check,
): Promise<string> {
  const verdict = reported.decide(report);
  if (verdict === "post") {
    await round.say(renderCheck(report)!);
    reported.remember(report);
    return `${report.findings.length} finding(s) posted`;
  }
  if (verdict === "clear") {
    await round.say(renderClear(report));
    reported.forget(report);
    return "clear";
  }
  return "nothing new, saying nothing";
}

/**
 * A posted briefing, taken at arm's length.
 *
 * The sender is another cluster, so the payload is input rather than a value
 * this process constructed. Everything is coerced to the shape the renderer
 * expects: a missing array becomes an empty one and a non-string item is
 * dropped, so a malformed payload produces a shorter briefing rather than a
 * crash or a rendered `[object Object]`.
 *
 * Escaping is the renderer's job and it already does it; this is about shape.
 */
export function asBriefing(payload: unknown): Briefing {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const lines = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const cluster = typeof raw["cluster"] === "string" ? raw["cluster"].trim() : "";
  const windowHours = Number(raw["windowHours"]);
  return {
    problems: lines(raw["problems"]),
    overnight: lines(raw["overnight"]),
    skipped: lines(raw["skipped"]),
    windowHours: Number.isFinite(windowHours) ? windowHours : 24,
    ...(cluster ? { cluster } : {}),
  };
}

/**
 * A check's findings, taken at arm's length, on the same terms as a briefing:
 * the sender is a Job in some cluster, so this is input rather than a value
 * this process built.
 *
 * A report with no usable name still renders — as `check` — because a nameless
 * finding in the room beats a 400 nobody reads.
 */
export function asCheck(payload: unknown): Check {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const findings = Array.isArray(raw["findings"])
    ? raw["findings"].filter((item): item is string => typeof item === "string")
    : [];
  const cluster = text(raw["cluster"]);
  return {
    check: text(raw["check"]) || "check",
    findings,
    ...(cluster ? { cluster } : {}),
  };
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
