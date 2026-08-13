/**
 * Everything a tool returns is redacted before the model sees it, and again
 * before anything is posted.
 *
 * Pod logs and resource specs are the two places a credential most plausibly
 * turns up in plain text, and both are exactly what `why` reads.
 *
 * This is defence in depth, not the boundary. The boundary is RBAC: the
 * ServiceAccount cannot read Secrets, cannot exec and cannot write, so the
 * worst an injected instruction achieves is disclosing something already
 * visible to anyone who can read a pod log.
 */

const REDACTIONS: readonly [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "sk-ant-<redacted>"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "gh_<redacted>"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_<redacted>"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA<redacted>"],
  [/AGE-SECRET-KEY-[A-Z0-9]+/g, "AGE-SECRET-KEY-<redacted>"],
  // JWTs — three base64url segments.
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt redacted>"],
  // Credentials embedded in a URL: postgres://user:pass@host
  [/(:\/\/[^/\s:@]+:)[^@\s]+(@)/g, "$1<redacted>$2"],
  // Campfire bot keys, which are id-token and appear in any URL the bot logs.
  [/\b\d+-[A-Za-z0-9]{12}\b/g, "<bot key redacted>"],
  // key=value and key: value for anything that names itself a secret.
  [
    /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|bearer)\b(\s*[:=]\s*|\s+)("?)([^\s"',]{6,})\3/gi,
    "$1$2$3<redacted>$3",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}
