/**
 * Central registry for tool metadata that crosses the worker
 * boundary — primarily the per-tool tier-gate minimum.
 *
 * Phase 1B inlined the tier-gate mapping in `constants.ts`. Phase 3
 * adds three more tools and would have inflated the constants file
 * with executable-by-importance metadata; the cleaner shape is a
 * dedicated tool registry that both the worker (for the gate) and
 * tests (for assertions) read from.
 *
 * Keep this module side-effect-free: no imports of the tool handler
 * modules themselves, so `manifest.test.ts` can read tier metadata
 * without pulling in the SDK runtime.
 */

import type { AgentTier } from "../constants.js";
import {
  GET_RUN_TOOL_NAME,
  LIST_WORKFLOWS_TOOL_NAME,
  RUN_CALL_TOOL_NAME,
} from "../constants.js";

export const LIST_VOICES_TOOL_NAME = "list_voices";
export const SET_AGENT_VOICE_TOOL_NAME = "set_agent_voice";
export const PROVISION_VOICE_AGENT_TOOL_NAME = "provision_voice_agent";

export const ALL_TOOL_NAMES = [
  LIST_WORKFLOWS_TOOL_NAME,
  RUN_CALL_TOOL_NAME,
  GET_RUN_TOOL_NAME,
  LIST_VOICES_TOOL_NAME,
  SET_AGENT_VOICE_TOOL_NAME,
  PROVISION_VOICE_AGENT_TOOL_NAME,
] as const;

/**
 * Per-tool minimum tier. Read-only tools admit any tier (`worker`);
 * tools that mutate state in NoralVoice or the agents table require
 * `manager` or above. The Voice Director template (`manager` tier) is
 * the canonical caller for the write tools.
 *
 * Keep this exhaustive — the worker's tier gate looks the tool up
 * here at dispatch time. A missing entry defaults to `worker` in
 * `worker.ts`, which is the safe failure mode (admit, never overgate)
 * but means new write tools must be explicitly added or they slip
 * past the gate.
 */
export const TOOL_MIN_TIER_V3: Record<string, AgentTier> = {
  // Phase 1B
  [LIST_WORKFLOWS_TOOL_NAME]: "worker",
  [GET_RUN_TOOL_NAME]: "worker",
  [RUN_CALL_TOOL_NAME]: "manager",
  // Phase 3
  [LIST_VOICES_TOOL_NAME]: "worker",
  [SET_AGENT_VOICE_TOOL_NAME]: "manager",
  [PROVISION_VOICE_AGENT_TOOL_NAME]: "manager",
};
