/**
 * Reading a Renovate pull request body, and deciding what is worth flagging.
 *
 * The point of the digest is not the list — it is surfacing the hazard that a
 * pull request left open long enough stops being a safe single step.
 */

/** How many minor releases may be skipped before it stops being routine. */
export const MINOR_SKIP_LIMIT = 1;

export interface Update {
  readonly package: string;
  readonly kind: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Leading numeric components of a version, ignoring any suffix.
 *
 * Handles the shapes Renovate actually produces here: `2.2.15`, `v1.46.0`,
 * `3.13-alpine`, `2026.4.1`. Returns [] for anything without a leading number —
 * a digest is not the place to be clever about exotic versions.
 */
export function numericParts(version: string): number[] {
  const parts: number[] = [];
  for (const chunk of version.replace(/^v/, "").split(".")) {
    const match = /^\d+/.exec(chunk);
    if (!match) break;
    parts.push(Number(match[0]));
  }
  return parts;
}

/** How many minor releases this jump crosses, or null if unknowable. */
export function minorsSkipped(before: string, after: string): number | null {
  const a = numericParts(before);
  const b = numericParts(after);
  if (a.length < 2 || b.length < 2 || a[0] !== b[0]) return null;
  return b[1]! - a[1]!;
}

const CHANGE = /`([^`]+)`\s*(?:→|->)\s*`([^`]+)`/;
const LINK = /\[([^\]]+)\]/;

/**
 * Every package row in a Renovate body.
 *
 * The column count is not fixed. A Helm release gives three columns:
 *
 *     | [reloader](url)              | patch  | `2.2.15` → `2.2.16` |
 *
 * while a GitHub Action inserts a Type column:
 *
 *     | [home-operations/flate](url) | action | minor | `v0.4.14` → `v0.5.0` |
 *
 * So the row is located by its change cell rather than by position, and the
 * kind is whatever cell precedes it. A positional pattern silently skipped
 * every action update. Header and separator rows fall out for free: neither
 * contains a change cell.
 */
export function updatesIn(body: string | null | undefined): Update[] {
  const updates: Update[] = [];
  for (const line of (body ?? "").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    let index = -1;
    let match: RegExpExecArray | null = null;
    for (let i = 0; i < cells.length; i += 1) {
      const found = CHANGE.exec(cells[i]!);
      if (found) {
        index = i;
        match = found;
        break;
      }
    }
    if (!match || index <= 0) continue;
    const link = LINK.exec(cells[0]!);
    updates.push({
      package: link ? link[1]! : cells[0]!,
      kind: cells[index - 1]!,
      from: match[1]!,
      to: match[2]!,
    });
  }
  return updates;
}

/**
 * Why this row is worth flagging, or null if it is routine.
 *
 * The skip check is the one worth the code. Renovate's own Update column says
 * "minor" whether that is one minor or five, because it describes the *kind*
 * of change rather than its size. A chart pull request that has sat open
 * across several releases lands as one jump, and some of those are invalid as
 * a single step — that is how a ServiceMonitor gets silently broken. The
 * distance has to be computed from the versions; the column will not tell you.
 */
export function concerns(update: Update): string | null {
  const kind = update.kind.toLowerCase();
  if (kind === "major") return "major";
  const skipped = minorsSkipped(update.from, update.to);
  if (kind === "minor" && skipped !== null && skipped > MINOR_SKIP_LIMIT) {
    return `skips ${skipped} minors`;
  }
  return null;
}
