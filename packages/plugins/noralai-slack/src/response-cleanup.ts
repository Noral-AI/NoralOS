/**
 * Helpers for cleaning agent-generated text before it reaches Slack.
 *
 * Lives in its own module so the worker can use it AND the unit tests
 * can hit it without instantiating the full plugin runtime.
 */

/**
 * Match a final-line `[token]` where `token` is a lowercase or hyphenated
 * model handle. Used to strip the trailing model attribution the Claude
 * Code CLI appends to its `--print` output (`[haiku]`, `[sonnet]`, etc).
 *
 * We deliberately:
 *   - require the token to start with a letter so plain `[3]` (markdown
 *     footnote / list marker) survives
 *   - anchor to end-of-string so inline `[brackets]` mid-message survive
 *   - match leading whitespace (including newlines) so a tag on its own
 *     trailing line is fully removed
 */
const TRAILING_MODEL_TAG_RE = /\s*\[[a-z][a-z0-9.\-_]*\]\s*$/i;

export function stripTrailingModelTag(text: string): string {
  return text.replace(TRAILING_MODEL_TAG_RE, "").trimEnd();
}
