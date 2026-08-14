/** The message, when there is one at all. */

import { escape } from "../alerts/render.js";
import { bullets, heading } from "../cluster/briefing.js";
import { notable, phrase, type Event } from "./events.js";

export function renderSecurity(events: readonly Event[]): string | null {
  const worth = notable(events);
  if (!worth.length) return null;

  const lines = worth.map((event) => {
    const when = new Date(event.at).toISOString().slice(11, 16);
    const where = event.from ? ` from ${escape(event.from)}` : "";
    return `${when} · ${phrase(event.action)} · ${escape(event.who || "unknown")}${where}`;
  });

  return heading(`🔐 ${worth.length === 1 ? "something" : `${worth.length} things`} in authentik`) + bullets(lines);
}
