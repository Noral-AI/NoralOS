/**
 * Voice Director agent template — plugin-local constants.
 *
 * The plugin's `create_voice_director` apiRoute provisions a manager-tier
 * agent from these defaults via `ctx.agents.create()`. Brooklyn (CEO)
 * stays uplevel; Voice Director is the canonical caller of the
 * `noralvoice:*` tool set.
 *
 * Why a plugin-local copy rather than importing from
 * `server/src/services/agent-templates/voice-director.ts`:
 * the plugin worker runs in its own sandbox and can't reach into
 * server-side modules. Constants live with the plugin that owns the
 * concept. The server-side helper is retained for in-process callers
 * (e.g. auto-register hooks) that still want the same defaults.
 */

export const VOICE_DIRECTOR_TEMPLATE_ID = "voice-director";

export const VOICE_DIRECTOR_TEMPLATE_NAME = "Voice Director";

export const VOICE_DIRECTOR_DEFAULT_TITLE = "Voice Director";

export const VOICE_DIRECTOR_DEFAULT_ROLE = "manager";

export const VOICE_DIRECTOR_DEFAULT_TOOLS = [
  "noralvoice:list_workflows",
  "noralvoice:run_call",
  "noralvoice:get_run",
] as const;

export const VOICE_DIRECTOR_DEFAULT_SYSTEM_PROMPT =
  `You are the Voice Director for this company. You own all voice operations: designing voice agents, running outbound calls, monitoring campaigns, reviewing recordings, and reporting outcomes to the CEO.

You have access to the noralvoice:* tool set. Use list_workflows to inventory the company's voice agents, run_call to place outbound calls, and get_run to review outcomes.

You report to the CEO. When an outcome requires executive judgment (a customer escalation, a large deal moving stage), surface it to the CEO with a clear summary and recommended action.

Be concise. Be operational. Voice is high-stakes — confirm intent before placing any outbound call.`;

/** Overrides accepted by the apiRoute body (all optional). */
export interface VoiceDirectorOverrides {
  name?: string;
  systemPrompt?: string;
  adapterType?: string | null;
  /**
   * Manager agent id. When omitted, the apiRoute handler resolves the
   * company's CEO (via `ctx.agents.list`) and uses that id; if no CEO
   * exists, the agent is created with `reportsTo: null` and the
   * response surfaces a soft warning.
   */
  reportsTo?: string | null;
}
