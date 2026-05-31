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

// Phase 7 — agent read tools (promoted from board-only apiRoutes).
export const LIST_RUNS_TOOL_NAME = "list_runs";
export const LIST_CAMPAIGNS_TOOL_NAME = "list_campaigns";
export const GET_CAMPAIGN_TOOL_NAME = "get_campaign";
export const SEARCH_KB_TOOL_NAME = "search_kb";

// Phase 7 PR-J — telephony credential + phone-number management.
// Lets agents wire Twilio (and other providers) end-to-end without
// operator intervention. See tools/add_telephony_credential.ts etc. for
// the secret-handling contract.
export const ADD_TELEPHONY_CREDENTIAL_TOOL_NAME = "add_telephony_credential";
export const LIST_TELEPHONY_CREDENTIALS_TOOL_NAME = "list_telephony_credentials";
export const ASSIGN_PHONE_NUMBER_TOOL_NAME = "assign_phone_number_to_workflow";

// Phase 9C — Tier 1 write tools (manager) + Tier 2 read tools (worker).
// Together these give a Voice Director agent operator-parity: every
// action a human performs today in the NoralVoice UI is now callable
// by an agent without human intervention.
//
// Tier 1 — writes, manager-tier:
export const CREATE_WORKFLOW_TOOL_NAME = "create_workflow";
export const SAVE_WORKFLOW_TOOL_NAME = "save_workflow";
export const CREATE_CAMPAIGN_TOOL_NAME = "create_campaign";
export const START_CAMPAIGN_TOOL_NAME = "start_campaign";
export const UPLOAD_KB_DOCUMENT_TOOL_NAME = "upload_kb_document";
export const ADD_WORKFLOW_TOOL_TOOL_NAME = "add_workflow_tool";
export const UPDATE_WORKFLOW_TOOL_TOOL_NAME = "update_workflow_tool";
export const DELETE_WORKFLOW_TOOL_TOOL_NAME = "delete_workflow_tool";
//
// Tier 2 — reads, worker-tier:
export const GET_RUN_DETAIL_TOOL_NAME = "get_run_detail";
export const LIST_RECORDINGS_TOOL_NAME = "list_recordings";
export const GET_RECORDING_DOWNLOAD_URL_TOOL_NAME = "get_recording_download_url";
export const LIST_KB_DOCUMENTS_TOOL_NAME = "list_kb_documents";
export const GET_DAILY_REPORT_TOOL_NAME = "get_daily_report";

// Phase 9D — Tier 3 write tools (manager-tier).
// Final set: campaign lifecycle + embed-token secret refs.
export const PAUSE_CAMPAIGN_TOOL_NAME = "pause_campaign";
export const RESUME_CAMPAIGN_TOOL_NAME = "resume_campaign";
export const REDIAL_CAMPAIGN_TOOL_NAME = "redial_campaign";
export const CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME = "create_persistent_embed_token";
export const GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME = "get_persistent_embed_token";
export const REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME = "revoke_persistent_embed_token";

// Phase 10A — workflow lifecycle: validate (read) + publish (write).
// These close the agent-authoring loop: agents can self-check a draft
// they assembled with `create_workflow` / `save_workflow` before
// promoting it to executable. Without these, drafts created by an agent
// never reach the runtime — they stay editor-only.
export const VALIDATE_WORKFLOW_TOOL_NAME = "validate_workflow";
export const PUBLISH_WORKFLOW_TOOL_NAME = "publish_workflow";

// Phase 11 — seed-template builder. `apply_workflow_parameters` fills the
// named parameters a seed template exposes (see src/templates/) onto a
// provisioned workflow, so an agent customises a validated starter graph
// rather than authoring raw nodes/edges. Write tool → manager-tier.
export const APPLY_WORKFLOW_PARAMETERS_TOOL_NAME = "apply_workflow_parameters";

export const ALL_TOOL_NAMES = [
  LIST_WORKFLOWS_TOOL_NAME,
  RUN_CALL_TOOL_NAME,
  GET_RUN_TOOL_NAME,
  LIST_VOICES_TOOL_NAME,
  SET_AGENT_VOICE_TOOL_NAME,
  PROVISION_VOICE_AGENT_TOOL_NAME,
  LIST_RUNS_TOOL_NAME,
  LIST_CAMPAIGNS_TOOL_NAME,
  GET_CAMPAIGN_TOOL_NAME,
  SEARCH_KB_TOOL_NAME,
  ADD_TELEPHONY_CREDENTIAL_TOOL_NAME,
  LIST_TELEPHONY_CREDENTIALS_TOOL_NAME,
  ASSIGN_PHONE_NUMBER_TOOL_NAME,
  // Phase 9C
  CREATE_WORKFLOW_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  CREATE_CAMPAIGN_TOOL_NAME,
  START_CAMPAIGN_TOOL_NAME,
  UPLOAD_KB_DOCUMENT_TOOL_NAME,
  ADD_WORKFLOW_TOOL_TOOL_NAME,
  UPDATE_WORKFLOW_TOOL_TOOL_NAME,
  DELETE_WORKFLOW_TOOL_TOOL_NAME,
  GET_RUN_DETAIL_TOOL_NAME,
  LIST_RECORDINGS_TOOL_NAME,
  GET_RECORDING_DOWNLOAD_URL_TOOL_NAME,
  LIST_KB_DOCUMENTS_TOOL_NAME,
  GET_DAILY_REPORT_TOOL_NAME,
  // Phase 9D
  PAUSE_CAMPAIGN_TOOL_NAME,
  RESUME_CAMPAIGN_TOOL_NAME,
  REDIAL_CAMPAIGN_TOOL_NAME,
  CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME,
  // Phase 10A
  VALIDATE_WORKFLOW_TOOL_NAME,
  PUBLISH_WORKFLOW_TOOL_NAME,
  // Phase 11
  APPLY_WORKFLOW_PARAMETERS_TOOL_NAME,
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
  // Phase 7 — promoted from board-only apiRoutes (all read-only).
  [LIST_RUNS_TOOL_NAME]: "worker",
  [LIST_CAMPAIGNS_TOOL_NAME]: "worker",
  [GET_CAMPAIGN_TOOL_NAME]: "worker",
  [SEARCH_KB_TOOL_NAME]: "worker",
  // Phase 7 PR-J — telephony credentials are write/sensitive (creds in,
  // phone-number assignment mutates routing); listing is read-only.
  [ADD_TELEPHONY_CREDENTIAL_TOOL_NAME]: "manager",
  [LIST_TELEPHONY_CREDENTIALS_TOOL_NAME]: "worker",
  [ASSIGN_PHONE_NUMBER_TOOL_NAME]: "manager",
  // Phase 9C — Tier 1 writes (manager) + Tier 2 reads (worker).
  [CREATE_WORKFLOW_TOOL_NAME]: "manager",
  [SAVE_WORKFLOW_TOOL_NAME]: "manager",
  [CREATE_CAMPAIGN_TOOL_NAME]: "manager",
  [START_CAMPAIGN_TOOL_NAME]: "manager",
  [UPLOAD_KB_DOCUMENT_TOOL_NAME]: "manager",
  [ADD_WORKFLOW_TOOL_TOOL_NAME]: "manager",
  [UPDATE_WORKFLOW_TOOL_TOOL_NAME]: "manager",
  [DELETE_WORKFLOW_TOOL_TOOL_NAME]: "manager",
  [GET_RUN_DETAIL_TOOL_NAME]: "worker",
  [LIST_RECORDINGS_TOOL_NAME]: "worker",
  [GET_RECORDING_DOWNLOAD_URL_TOOL_NAME]: "worker",
  [LIST_KB_DOCUMENTS_TOOL_NAME]: "worker",
  [GET_DAILY_REPORT_TOOL_NAME]: "worker",
  // Phase 9D — Tier 3 writes (all manager-tier).
  [PAUSE_CAMPAIGN_TOOL_NAME]: "manager",
  [RESUME_CAMPAIGN_TOOL_NAME]: "manager",
  [REDIAL_CAMPAIGN_TOOL_NAME]: "manager",
  [CREATE_PERSISTENT_EMBED_TOKEN_TOOL_NAME]: "manager",
  [GET_PERSISTENT_EMBED_TOKEN_TOOL_NAME]: "manager",
  [REVOKE_PERSISTENT_EMBED_TOKEN_TOOL_NAME]: "manager",
  // Phase 10A — validate is read-only (worker); publish promotes a draft
  // to executable, gating the runtime, so it requires manager tier.
  [VALIDATE_WORKFLOW_TOOL_NAME]: "worker",
  [PUBLISH_WORKFLOW_TOOL_NAME]: "manager",
  // Phase 11 — mutates a workflow definition, so manager-tier.
  [APPLY_WORKFLOW_PARAMETERS_TOOL_NAME]: "manager",
};
