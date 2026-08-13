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
import {
  firingFingerprints,
  render,
  renderFlux,
  type AlertPayload,
  type FluxPayload,
  type Silencing,
} from "../copy/alerts/render.js";
import { roundFrom, type Round } from "../rounds.js";

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
  ]);
  const silencing: Silencing = {
    grafanaBase: environment.GRAFANA_BASE?.trim() || "https://grafana.ronaldlokers.nl",
    datasource: environment.SILENCE_DATASOURCE?.trim() || "Alertmanager",
  };
  const groups = new Groups();

  for (const [path, round] of destinations) {
    if (!round) {
      process.stdout.write(
        `no destination configured for ${path}; /healthz serves 503 until there is\n`,
      );
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response, destinations, groups, silencing);
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
  silencing: Silencing,
): Promise<void> {
  const path = (request.url ?? "").split("?")[0]!;

  if (request.method === "GET") {
    // Probes. Report unhealthy when a destination is unconfigured rather than
    // accepting events and dropping them.
    const missing = [...destinations].filter(([, round]) => !round).map(([name]) => name);
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

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
