/**
 * Alertmanager and Flux payloads, as a room can read them.
 *
 * HTML rather than text, because Campfire stores rich text and ignores newline
 * characters — a plain-text alert arrives as one run-on line. Everything used
 * here (strong, em, code, pre, ul, li, a, hr) survives server-side tag
 * filtering.
 */

/** Labels worth showing, in the order they read best. */
const LABELS = [
  "namespace",
  "cluster",
  "pod",
  "instance",
  "node",
  "volume",
  "persistentvolumeclaim",
] as const;

/**
 * alertname alone silences the rule everywhere; adding namespace keeps it to
 * the app that is actually broken. Anything narrower (pod, instance) would be
 * outlived by the next restart, and the matchers are editable on the page.
 */
const SILENCE_MATCHERS = ["alertname", "namespace"] as const;

export interface Alert {
  readonly status?: string;
  readonly labels?: Record<string, string>;
  readonly annotations?: Record<string, string>;
  readonly generatorURL?: string;
  readonly fingerprint?: string;
}

export interface AlertPayload {
  readonly status?: string;
  readonly groupKey?: string;
  readonly alerts?: readonly Alert[];
}

export interface Silencing {
  /**
   * Silencing goes through Grafana, not Alertmanager: Alertmanager is ClusterIP
   * with no Ingress, so a link to its own UI would be dead from a phone — which
   * is the only place these are read.
   */
  readonly grafanaBase: string;
  /**
   * kube-prometheus-stack provisions an Alertmanager datasource named
   * "Alertmanager". Point this at anything else and it resolves to Grafana's
   * *built-in* Alertmanager, where a silence would look like it worked while
   * silencing nothing.
   */
  readonly datasource: string;
}

export function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function emoji(status: string, severity: string): string {
  if (status === "resolved") return "✅";
  return severity === "critical" ? "🚨" : "⚠️";
}

export function silenceUrl(labels: Record<string, string>, silencing: Silencing): string {
  const params = new URLSearchParams([["alertmanager", silencing.datasource]]);
  for (const key of SILENCE_MATCHERS) {
    if (labels[key]) params.append("matcher", `${key}=${labels[key]}`);
  }
  return `${silencing.grafanaBase}/alerting/silence/new?${params}`;
}

/** One alert as an HTML fragment. */
export function renderAlert(alert: Alert, silencing: Silencing): string {
  const labels = alert.labels ?? {};
  const annotations = alert.annotations ?? {};
  const name = labels["alertname"] ?? "alert";
  const severity = labels["severity"] ?? "";
  const status = alert.status ?? "firing";

  let head = `<strong>${emoji(status, severity)} ${escape(name)}</strong>`;
  if (severity) head += ` · <em>${escape(severity)}</em>`;
  const parts = [head];

  const summary = (annotations["summary"] ?? "").trim();
  if (summary) parts.push(`<div>${escape(summary)}</div>`);

  const items = LABELS.filter((key) => labels[key]).map(
    (key) => `<li>${escape(key)}: <code>${escape(String(labels[key]))}</code></li>`,
  );
  if (items.length) parts.push(`<ul>${items.join("")}</ul>`);

  // <pre> keeps error strings, paths and lock names readable. Descriptions in
  // this repository are long and often contain a literal command or metric.
  const description = (annotations["description"] ?? "").trim();
  if (description) parts.push(`<pre>${escape(description)}</pre>`);

  const links: [string, string][] = [];
  if (alert.generatorURL) links.push(["source", alert.generatorURL]);
  const runbook = (annotations["runbook_url"] ?? "").trim();
  if (runbook) links.push(["runbook", runbook]);
  // Only while firing. A resolved alert has nothing left to silence.
  if (status !== "resolved") links.push(["silence", silenceUrl(labels, silencing)]);
  if (links.length) {
    parts.push(
      links.map(([text, url]) => `<a href="${escape(url)}">${text}</a>`).join(" · "),
    );
  }

  return parts.join("");
}

/**
 * A whole webhook payload as one message.
 *
 * One message per payload rather than per alert: Alertmanager already groups,
 * so honouring the grouping is what keeps the room readable instead of
 * reproducing the stream this exists to avoid.
 */
export function render(payload: AlertPayload, silencing: Silencing): string | null {
  const alerts = payload.alerts ?? [];
  if (!alerts.length) return null;
  if (alerts.length === 1) return renderAlert(alerts[0]!, silencing);

  const verb = payload.status === "resolved" ? "resolved" : "firing";
  const head = `<strong>${alerts.length} alerts ${verb}</strong>`;
  return head + "<hr>" + alerts.map((alert) => renderAlert(alert, silencing)).join("<hr>");
}

export interface FluxPayload {
  readonly involvedObject?: { kind?: string; name?: string; namespace?: string };
  readonly severity?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly metadata?: Record<string, string> | null;
}

/**
 * A Flux notification-controller event.
 *
 * Flux posts its Event JSON to a `generic` Provider and offers no body
 * templating, which is why these come through here.
 */
export function renderFlux(payload: FluxPayload): string {
  const object = payload.involvedObject ?? {};
  const severity = payload.severity ?? "info";
  const kind = object.kind ?? "object";
  const name = object.name ?? "?";
  const namespace = object.namespace ?? "";
  const reason = payload.reason ?? "";
  const message = (payload.message ?? "").trim();

  // Both clusters post into the same room, so which one sent this has to be
  // the first thing visible. Set per cluster via the Alert's eventMetadata.
  const cluster = payload.metadata?.["cluster"] ?? "";

  const mark = severity === "error" ? "🚨" : "ℹ️";
  let head = `<strong>${mark} ${escape(kind)}/${escape(name)}</strong>`;
  if (cluster) head = `<strong>[${escape(cluster)}]</strong> ${head}`;
  if (severity) head += ` · <em>${escape(severity)}</em>`;
  const parts = [head];

  const items: string[] = [];
  if (namespace) items.push(`<li>namespace: <code>${escape(namespace)}</code></li>`);
  if (reason) items.push(`<li>reason: <code>${escape(reason)}</code></li>`);
  if (items.length) parts.push(`<ul>${items.join("")}</ul>`);

  if (message) parts.push(`<pre>${escape(message)}</pre>`);
  return parts.join("");
}

export function firingFingerprints(payload: AlertPayload): Set<string> {
  return new Set(
    (payload.alerts ?? [])
      .filter((alert) => alert.status !== "resolved" && alert.fingerprint)
      .map((alert) => alert.fingerprint!),
  );
}
