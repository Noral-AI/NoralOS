/**
 * `noralvoice:provision_voice_agent` tool handler.
 *
 * Creates a fresh NoralVoice workflow for a NoralOS agent and writes
 * the returned `workflow_uuid` back to `agents.voice_agent_uuid`. The
 * default workflow definition is intentionally minimal (one Agent node)
 * so Phase 4's iframed builder is the only path that grows the graph.
 *
 * Refuses if the agent already has a `voice_agent_uuid` — provisioning
 * is one-shot per agent. Use the NV editor (Phase 4) to clone if
 * multiple voice agents are needed; this tool stays predictable.
 *
 * Tier: manager.
 */

import { type NoralVoiceClientConfig, createWorkflow } from "../noralvoice-client.js";

export interface ProvisionVoiceAgentParams {
  noralosAgentId: string;
  displayName?: string;
  template?: "blank" | "conversational";
}

export type ProvisionVoiceAgentResult =
  | {
      ok: true;
      content: string;
      data: {
        voice_agent_uuid: string;
        workflow_name: string;
      };
    }
  | {
      ok: false;
      error: "ALREADY_PROVISIONED";
      voice_agent_uuid: string;
      message: string;
    };

export interface ProvisionVoiceAgentContext {
  /** Look up the existing voice_agent_uuid (if any) for the agent. */
  resolveVoiceAgentUuid: (agentId: string) => Promise<string | null>;
  /**
   * Read a friendly agent name (for the default workflow display name).
   * Returns null if the agent doesn't exist — handler treats this as a
   * 4xx via the NoralVoiceClientError path.
   */
  resolveAgentName: (agentId: string) => Promise<string | null>;
  /** Write voice_agent_uuid back to agents row. */
  writeVoiceAgentUuid: (agentId: string, uuid: string) => Promise<void>;
}

export async function executeProvisionVoiceAgent(
  config: NoralVoiceClientConfig,
  params: ProvisionVoiceAgentParams,
  ctx: ProvisionVoiceAgentContext,
): Promise<ProvisionVoiceAgentResult> {
  const existing = await ctx.resolveVoiceAgentUuid(params.noralosAgentId);
  if (existing) {
    return {
      ok: false,
      error: "ALREADY_PROVISIONED",
      voice_agent_uuid: existing,
      message: `Agent already has voice_agent_uuid=${existing}. Use the NoralVoice editor to modify the workflow.`,
    };
  }

  const agentName = await ctx.resolveAgentName(params.noralosAgentId);
  const workflowName =
    params.displayName ??
    (agentName ? `${agentName} voice` : `Voice agent ${params.noralosAgentId}`);

  // Phase 3 ships only the implicit "minimal conversational" template
  // (a single Agent node) — the createWorkflow helper handles the
  // default. `template: "blank"` is reserved for a follow-up that
  // pre-stamps a different starter graph; today it falls through to
  // the same minimal one with a different display affordance.
  const created = await createWorkflow(config, { name: workflowName });
  if (!created.workflowUuid) {
    // NV always returns workflow_uuid (Phase 0 D2 enforced NOT NULL).
    // Defensive: if a future NV schema regresses, surface clearly.
    throw new Error(
      `NoralVoice created the workflow but returned no workflow_uuid (id=${created.id}).`,
    );
  }
  await ctx.writeVoiceAgentUuid(params.noralosAgentId, created.workflowUuid);

  return {
    ok: true,
    content: `Provisioned NoralVoice workflow "${workflowName}" (uuid ${created.workflowUuid}) for agent ${params.noralosAgentId}.`,
    data: {
      voice_agent_uuid: created.workflowUuid,
      workflow_name: workflowName,
    },
  };
}
