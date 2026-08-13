/**
 * The dependency beat: what Renovate has left open, and what is not routine.
 *
 * Renovate runs hourly and opens pull requests; nothing summarises them, so the
 * backlog is only visible to someone who goes looking.
 */

import { collect, render, type PullRequest } from "../copy/renovate/digest.js";
import type { Round } from "../rounds.js";

const API = "https://api.github.com";

export async function renovate(round: Round, environment = process.env): Promise<void> {
  const token = environment.GITHUB_TOKEN?.trim();
  const repository = environment.GITHUB_REPO?.trim() || "ronaldlokers/homelab";
  if (!token) throw new Error("GITHUB_TOKEN is unset");

  const response = await fetch(
    `${API}/repos/${repository}/pulls?state=open&per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "stringer-renovate",
      },
    },
  );
  if (!response.ok) {
    // Loudly. A digest that silently stops is indistinguishable from a week
    // with no dependency updates, which is the wrong thing to believe.
    throw new Error(`github returned ${response.status} ${response.statusText}`);
  }

  const pulls = (await response.json()) as {
    number: number;
    title: string;
    html_url: string;
    created_at: string;
    body: string | null;
    head: { ref: string };
  }[];

  const rows = collect(
    pulls.map<PullRequest>((pull) => ({
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      branch: pull.head.ref,
      createdAt: pull.created_at,
      body: pull.body,
    })),
    new Date(),
  );

  const flagged = rows.filter((row) => row.flagged.length).length;
  process.stdout.write(`${rows.length} open Renovate PR(s), ${flagged} flagged\n`);
  await round.say(render(rows));
}
