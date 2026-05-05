// Pre-TTS exfiltration scan.
//
// Patterns ported from Noral-OS/src/exfiltration-guard.ts (regex only;
// no Telegram, channel, or transport code carried forward). Pure regex
// analysis with zero dependencies. The host plugin runtime forbids
// dynamic require, so we keep this self-contained.
//
// Block-on-match behavior: if scanForSecrets returns any match, the
// caller MUST refuse to send the text to a TTS provider and MUST log
// the event for security audit.

export interface SecretMatch {
  type: SecretType;
  position: number;
  length: number;
  /** First 4 chars of the matched value, followed by an ellipsis. Never log full secrets. */
  preview: string;
}

export type SecretType =
  | "anthropic_key"
  | "generic_sk_key"
  | "slack_token"
  | "github_token"
  | "aws_key"
  | "long_hex";

const PATTERNS: Array<{ type: SecretType; regex: RegExp }> = [
  // Anthropic API keys: sk-ant- followed by 20+ alphanumeric chars.
  { type: "anthropic_key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },

  // Generic SK keys: sk- followed by 20+ chars (must not start with sk-ant-).
  { type: "generic_sk_key", regex: /sk-(?!ant-)[A-Za-z0-9_-]{20,}/g },

  // Slack bot/user tokens.
  { type: "slack_token", regex: /xox[bp]-[A-Za-z0-9-]+/g },

  // GitHub personal access tokens.
  { type: "github_token", regex: /gh[po]_[A-Za-z0-9]{20,}/g },

  // AWS access key IDs: AKIA + 16 alphanumeric.
  { type: "aws_key", regex: /AKIA[A-Za-z0-9]{16}/g },

  // Long hex strings (41+ chars, with adjacent-non-alphanumeric guards).
  // Catches API keys whose format we don't have a more specific pattern for.
  { type: "long_hex", regex: /(?<![A-Za-z0-9])[0-9a-fA-F]{41,}(?![A-Za-z0-9])/g },
];

export function scanForSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { type, regex } of PATTERNS) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      const matchText = m[0];
      const position = m.index ?? 0;
      matches.push({
        type,
        position,
        length: matchText.length,
        preview: matchText.slice(0, 4) + "…",
      });
    }
  }
  return matches;
}
