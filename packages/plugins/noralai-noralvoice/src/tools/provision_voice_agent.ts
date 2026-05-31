/**
 * `noralvoice:provision_voice_agent` tool handler.
 *
 * Creates a fresh NoralVoice workflow for a NoralOS agent and writes the
 * minted **agent-trigger path** back to `agents.voice_agent_uuid`.
 *
 * Why the trigger path and not the workflow_uuid: NoralVoice places an
 * outbound call via `POST /api/v1/public/agent/<path>`, where `<path>` is
 * resolved as an *agent trigger* (`get_agent_trigger_by_path`), NOT a
 * workflow_uuid. NoralVoice mints an ACTIVE agent trigger automatically for
 * every `type:"trigger"` node in the definition at create time (and stores
 * the first definition as a published V1, so it is immediately dialable —
 * no separate publish step). So we provision a definition that carries a
 * trigger node with a UUID we choose, and persist *that* UUID as the agent's
 * dial target. `run_call` then dials it directly.
 *
 * Refuses if the agent already has a `voice_agent_uuid` — provisioning is
 * one-shot per agent. Use the NoralVoice editor to clone if multiple voice
 * agents are needed; this tool stays predictable.
 *
 * Tier: manager.
 */

import { randomUUID } from "node:crypto";

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

/**
 * A minimal, dialable outbound workflow: a standalone API `trigger` node (the
 * launch handle) alongside a greet → converse → wrap-up flow
 * (`startCall` → `agentNode` → `endCall`). The trigger is intentionally NOT
 * edge-connected to the flow — NoralVoice's runtime graph validator requires
 * the is_start node (startCall) to have zero incoming edges, and the run
 * begins at is_start when the trigger fires. The trigger node carries the
 * `trigger_path` we choose so we know the dial target without reading it back;
 * NoralVoice preserves a supplied, non-empty `trigger_path` verbatim and mints
 * an ACTIVE agent trigger for it on create. Verified end-to-end with a live
 * call (`validate` returns is_valid; the pipeline runs and the agent speaks).
 */
export function buildTriggerWorkflowDefinition(
  triggerPath: string,
): Record<string, unknown> {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: -320, y: 0 },
        data: { name: "API Trigger", enabled: true, trigger_path: triggerPath },
      },
      {
        id: "start",
        type: "startCall",
        position: { x: 0, y: 0 },
        data: {
          name: "Call Start",
          is_start: true,
          allow_interrupt: true,
          greeting: "Hi, this is your assistant calling. Do you have a quick moment?",
          greeting_type: "text",
          prompt:
            "Open the call warmly and confirm you are speaking with the right person before moving on.",
        },
      },
      {
        id: "agent",
        type: "agentNode",
        position: { x: 320, y: 0 },
        data: {
          name: "Conversation",
          allow_interrupt: true,
          prompt:
            "You are a helpful voice assistant. Have a natural, concise conversation and help the caller. When the conversation is complete, move to wrap up.",
        },
      },
      {
        id: "end",
        type: "endCall",
        position: { x: 640, y: 0 },
        data: {
          name: "Wrap Up",
          is_end: true,
          prompt:
            "Thank them for their time, confirm any agreed next steps, and end the call politely.",
        },
      },
    ],
    // NB: the trigger node is a standalone launch handle — intentionally NOT
    // edge-connected to the flow. NoralVoice's graph validator requires the
    // is_start node (startCall) to have zero incoming edges (max_incoming=0),
    // and the run begins at is_start when the trigger fires. Wiring trigger→start
    // passes create-time checks but fails at runtime ("Start Call cannot have
    // incoming edges"), dead-airing the call.
    edges: [
      {
        id: "start-agent",
        source: "start",
        target: "agent",
        data: { label: "Begin", condition: "The call connected." },
      },
      {
        id: "agent-end",
        source: "agent",
        target: "end",
        data: { label: "Wrap up", condition: "The conversation is complete." },
      },
    ],
  };
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

  // The dial target is an agent-trigger path. Choose it here, embed it in a
  // trigger node, and persist it — NoralVoice mints the ACTIVE trigger for
  // this exact path on create.
  const triggerPath = randomUUID();
  const created = await createWorkflow(config, {
    name: workflowName,
    definition: buildTriggerWorkflowDefinition(triggerPath),
  });
  if (!created.id) {
    // Defensive: creation should always return the new workflow id.
    throw new Error(
      `NoralVoice did not return a workflow id when provisioning agent ${params.noralosAgentId}.`,
    );
  }
  await ctx.writeVoiceAgentUuid(params.noralosAgentId, triggerPath);

  return {
    ok: true,
    content: `Provisioned NoralVoice voice agent "${workflowName}" (workflow id ${created.id}, dial trigger ${triggerPath}) for agent ${params.noralosAgentId}.`,
    data: {
      voice_agent_uuid: triggerPath,
      workflow_name: workflowName,
    },
  };
}
