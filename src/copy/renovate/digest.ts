/** The weekly summary, as the room reads it. */

import { concerns, updatesIn, type Update } from "./updates.js";

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly branch: string;
  readonly createdAt: string;
  readonly body: string | null;
}

export interface Row {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly age: number;
  readonly flagged: readonly (readonly [Update, string])[];
}

export function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ageDays(created: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(created).getTime()) / 86_400_000);
}

/**
 * Renovate's own pull requests, worst first.
 *
 * They are authored by a person here rather than `renovate[bot]`, because
 * Renovate runs as a CronJob with a personal token — author filtering finds
 * nothing, and the branch prefix is the reliable signal.
 */
export function collect(pulls: readonly PullRequest[], now: Date): Row[] {
  const rows: Row[] = [];
  for (const pull of pulls) {
    if (!pull.branch.startsWith("renovate/")) continue;
    const flagged: [Update, string][] = [];
    for (const update of updatesIn(pull.body)) {
      const reason = concerns(update);
      if (reason) flagged.push([update, reason]);
    }
    rows.push({
      number: pull.number,
      title: pull.title,
      url: pull.url,
      age: ageDays(pull.createdAt, now),
      flagged,
    });
  }
  rows.sort((a, b) => b.flagged.length - a.flagged.length || b.age - a.age);
  return rows;
}

export function render(rows: readonly Row[]): string {
  if (rows.length === 0) return "<div><strong>🌱 No open Renovate PRs</strong></div>";

  const parts = [
    `<div><strong>📦 ${rows.length} open Renovate PR${rows.length === 1 ? "" : "s"}</strong></div>`,
  ];

  const flagged = rows.filter((row) => row.flagged.length);
  if (flagged.length) {
    parts.push("<div><strong>⚠️ Read before merging</strong></div>");
    const items = flagged.map((row) => {
      const why = row.flagged
        .map(([update, reason]) => `${update.package} ${update.from} → ${update.to} (${reason})`)
        .join("; ");
      return (
        `<li><a href="${escape(row.url)}">#${row.number}</a> ` +
        `${escape(row.title)} — ${escape(why)}, open ${row.age}d</li>`
      );
    });
    parts.push(`<ul>${items.join("")}</ul>`);
  }

  const routine = rows.filter((row) => row.flagged.length === 0);
  if (routine.length) {
    parts.push("<div><strong>Routine</strong></div>");
    const items = routine.map(
      (row) =>
        `<li><a href="${escape(row.url)}">#${row.number}</a> ` +
        `${escape(row.title)} — open ${row.age}d</li>`,
    );
    parts.push(`<ul>${items.join("")}</ul>`);
  }

  return parts.join("");
}
