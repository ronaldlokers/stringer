/**
 * The status beat: `@Houston status` and its siblings.
 *
 * Every verb but one is deterministic and free: status, certs, backups and
 * longhorn read the API and format what they find. `why` puts a model behind
 * the same loop with read-only tools, and is the only part that costs money or
 * can be prompt-injected — so it answers to one identity and posts
 * asynchronously, because inference is far past the desk's budget.
 *
 * `reconcile` and `restart` change the cluster and this process does not
 * perform them. It holds no write RBAC at all: it checks who asked and
 * forwards to the actor, which reads no logs and calls no model. That split is
 * the point.
 */

import { heading } from "../copy/cluster/briefing.js";
import { escape } from "../copy/alerts/render.js";
import { Kube } from "../copy/cluster/kube.js";
import { anthropic, renderWhy, triage } from "../copy/cluster/triage.js";
import { HELP, renderStatus, renderVerb } from "../copy/cluster/verbs.js";
import { CampfireDesk } from "../desks/campfire.js";
import type { Question } from "../desks/desk.js";
import type { Round } from "../rounds.js";

const ACTOR_TIMEOUT_MS = 10_000;

export async function status(_unused: Round, environment = process.env): Promise<void> {
  const kube = new Kube(environment.KUBE_API?.trim() || "https://kubernetes.default.svc");
  const desk = new CampfireDesk(
    Number(environment.LISTEN_PORT ?? "8080"),
    environment.CAMPFIRE_BASE?.trim() || "http://campfire.campfire.svc.cluster.local",
  );
  const operator = String(environment.TRIAGE_USER_ID ?? "1");
  const apiKey = environment.ANTHROPIC_API_KEY?.trim() ?? "";
  const model = environment.ANTHROPIC_MODEL?.trim() || "claude-opus-5";
  const actor =
    environment.KUBE_ACTOR_URL?.trim() ||
    "http://campfire-kube-actor.campfire.svc.cluster.local";

  const serving = await desk.serve(async (question) => {
    const verb = question.words[0] ?? "";
    const rest = question.words.slice(1);

    if (verb === "why") return startWhy(question, rest.join(" "), { kube, apiKey, model, operator });
    if (verb === "reconcile" || verb === "restart") {
      return act(actor, verb, rest, question.asker, operator);
    }
    if (verb === "" || verb === "status" || verb === "certs" || verb === "backups" || verb === "longhorn") {
      try {
        return await renderVerb(verb, kube);
      } catch (error) {
        // Nothing may escape to the desk: on Campfire a non-200 that carries a
        // Content-Type is uploaded into the room as an attachment.
        return heading("⚠️ could not read the cluster") + `<pre>${escape(String(error))}</pre>`;
      }
    }
    return HELP;
  });

  process.stdout.write(`listening on :${serving.port}\n`);
  await new Promise<void>((resolve) => {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => void serving.close().then(resolve));
    }
  });
}

interface WhyDeps {
  readonly kube: Kube;
  readonly apiKey: string;
  readonly model: string;
  readonly operator: string;
}

/**
 * Acknowledge now; the model answers minutes later.
 *
 * The immediate reply is what stops Campfire posting its own timeout notice
 * over the top of the real answer.
 */
function startWhy(question: Question, asked: string, deps: WhyDeps): string {
  if (!deps.apiKey) {
    return (
      heading("why is not configured") +
      "<div>Set ANTHROPIC_API_KEY on the deployment.</div>"
    );
  }

  // The payload is the authority on who asked; the room is not. Anyone can
  // type the words, so the id is what gates the spend and the logs.
  if (question.asker.id !== deps.operator) {
    process.stdout.write(`why refused for user ${question.asker.id} (${question.asker.name})\n`);
    return (
      heading("🔒 why is operator-only") +
      "<div>The read-only verbs are open to everyone: <code>status</code>, " +
      "<code>certs</code>, <code>backups</code>, <code>longhorn</code>.</div>"
    );
  }

  if (!question.later) {
    return (
      heading("⚠️ nowhere to answer") +
      "<div>This desk offers no way back, and why cannot answer in time.</div>"
    );
  }

  void answerWhy(question.later, asked, deps);
  return heading("🔍 looking…") + "<div>The answer follows in a minute or two.</div>";
}

async function answerWhy(round: Round, asked: string, deps: WhyDeps): Promise<void> {
  let body: string;
  try {
    const context = await renderStatus(deps.kube);
    body = renderWhy(await triage(anthropic(deps.apiKey, deps.model), deps.kube, context, asked));
  } catch (error) {
    body = heading("⚠️ why could not finish") + `<pre>${escape(String(error))}</pre>`;
  }
  try {
    await round.say(body);
    process.stdout.write("why: posted\n");
  } catch (error) {
    // Broad on purpose. This runs detached, so anything escaping here dies
    // silently with the answer already paid for.
    process.stdout.write(`why: could not post: ${String(error)}\n`);
  }
}

/** Checks who asked, then forwards. This process holds no write RBAC. */
async function act(
  actor: string,
  verb: string,
  rest: readonly string[],
  asker: { id: string; name: string },
  operator: string,
): Promise<string> {
  if (asker.id !== operator) {
    process.stdout.write(`${verb} refused for user ${asker.id} (${asker.name})\n`);
    return heading(`🔒 ${verb} is operator-only`) + "<div>Read-only verbs are open to everyone.</div>";
  }
  const target = rest.join(" ").trim();
  if (!target) return heading(`${verb} needs a target`) + `<div>Say <code>${verb} &lt;name&gt;</code>.</div>`;

  try {
    const response = await fetch(`${actor}/${verb}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      signal: AbortSignal.timeout(ACTOR_TIMEOUT_MS),
    });
    const text = await response.text();
    return response.ok
      ? heading(`✅ ${verb} ${escape(target)}`) + `<pre>${escape(text)}</pre>`
      : heading(`⚠️ ${verb} failed`) + `<pre>${escape(text)}</pre>`;
  } catch (error) {
    return heading(`⚠️ ${verb} failed`) + `<pre>${escape(String(error))}</pre>`;
  }
}
