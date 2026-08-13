/**
 * Which message an alert group belongs to, and whether to amend or post again.
 *
 * The rule is about notification, not tidiness. Where the transport can amend
 * quietly — Campfire can — an amendment reaches nobody's phone. So anything
 * *new* has to be a new message, and only resolutions may be folded into the
 * one already there.
 *
 *   * a fingerprint that was not firing before  -> post, so it pushes
 *   * only resolutions since last time          -> amend, silently
 *   * the whole group resolved                  -> amend, then forget it, so
 *                                                  a re-fire pushes again
 *
 * On a transport that cannot amend, every one of those becomes a post. The
 * room turns into a log rather than a state, and resolutions notify. That is
 * the honest degradation, and it is why Campfire is still the one this is
 * pointed at.
 */

export interface Tracked {
  readonly id: string;
  readonly firing: ReadonlySet<string>;
}

/** Bounded rather than unbounded: a group that never resolves would otherwise
 *  sit here forever. Oldest first — Map keeps insertion order. */
const MAX_TRACKED = 200;

export class Groups {
  private readonly seen = new Map<string, Tracked>();

  get(groupKey: string | undefined): Tracked | undefined {
    return groupKey ? this.seen.get(groupKey) : undefined;
  }

  remember(groupKey: string | undefined, id: string, firing: ReadonlySet<string>): void {
    if (!groupKey) return;
    this.seen.set(groupKey, { id, firing });
    while (this.seen.size > MAX_TRACKED) {
      this.seen.delete(this.seen.keys().next().value!);
    }
  }

  forget(groupKey: string | undefined): void {
    if (groupKey) this.seen.delete(groupKey);
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * Has this group gained anything since the message was written?
 *
 * Not a subset test in the other direction: a group that *lost* alerts has
 * only resolutions to report, and those are what amending is for.
 */
export function hasEscalated(known: Tracked | undefined, firing: ReadonlySet<string>): boolean {
  if (!known) return false;
  for (const fingerprint of firing) {
    if (!known.firing.has(fingerprint)) return true;
  }
  return false;
}
