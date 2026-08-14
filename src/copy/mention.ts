/**
 * Making a message notify a person, when it is worth it.
 *
 * Campfire's rooms can be set to notify on mentions only, which is the setting
 * that makes a busy alerts room bearable — and it turns every unmentioned
 * message into something you find later rather than something you are told.
 * These are the messages that should still reach a phone.
 *
 * A mention is **not text**. Writing "@ronald" in a bot message achieves
 * nothing: `Message#mentionees` is `body.body.attachables.grep(User)`, so a
 * mention is an ActionText attachment carrying a signed global id, and the
 * signature can only be made by Campfire itself. The id is obtained once —
 * `User#attachable_sgid` — and stored; Rails mints it without an expiry, so it
 * keeps working until SECRET_KEY_BASE is rotated, which is also the thing that
 * would silently break every one of these.
 *
 * The bot posts its body to a rich-text attribute, so the attachment is parsed
 * and resolved exactly as it would be from a person's browser. Verified against
 * a real message: `mentionees: ["Ronald Lokers"]`.
 */

/**
 * The attachment, or nothing when no id is configured.
 *
 * Nothing is the right answer for an unconfigured deployment: a beat that
 * cannot mention should still post, because the message is the point and the
 * notification is the courtesy.
 */
export function mention(sgid: string | undefined): string {
  const trimmed = sgid?.trim();
  if (!trimmed) return "";
  return (
    `<action-text-attachment sgid="${escapeAttribute(trimmed)}" ` +
    `content-type="application/octet-stream"></action-text-attachment>`
  );
}

/**
 * A message that should reach a phone.
 *
 * The mention goes last. First it reads as an address — "Ronald, here is a
 * problem" — which is not what this is; the message is about the cluster and
 * the mention is the reason it arrived now rather than whenever you next looked.
 */
export function needsAttention(html: string, sgid: string | undefined): string {
  const attachment = mention(sgid);
  return attachment ? `${html}<div>${attachment}</div>` : html;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
