/**
 * `noralvoice:provision_voice_agent` tool handler.
 *
 * Creates a fresh NoralVoice workflow for a NoralOS agent and writes the
 * minted **agent-trigger path** back to `agents.voice_agent_uuid`.
 *
 * Starting graph depends on `template`:
 *   - omitted / "blank" / "conversational" → a minimal dialable conversational
 *     starter (greet → converse → wrap-up).
 *   - a registered seed-template slug (see `src/templates/`) → that template's
 *     validated definition, cloned. The agent then customises it through
 *     `apply_workflow_parameters`; it never authors a raw graph here.
 *   Unknown slugs are rejected with the list of available templates.
 *
 * Dialability (the critical invariant): NoralVoice places an outbound call via
 * `POST /api/v1/public/agent/<path>`, where `<path>` is resolved as an *agent
 * trigger* (`get_agent_trigger_by_path`), NOT a workflow_uuid. NoralVoice mints
 * an ACTIVE agent trigger for every `type:"trigger"` node at create time (and
 * stores the first definition as a published V1 → immediately dialable, no
 * publish step). So whichever starting graph we use, we **inject a standalone
 * `trigger` node** carrying a UUID we choose, and persist *that* UUID as
 * `voice_agent_uuid`. The trigger is intentionally NOT edge-connected: NV's
 * runtime validator requires the is_start node to have zero incoming edges, so
 * wiring trigger→start dead-airs the call. `run_call` then dials the stored
 * trigger path directly.
 *
 * Refuses if the agent already has a `voice_agent_uuid` — provisioning is
 * one-shot per agent. Use `apply_workflow_parameters` / the NoralVoice editor
 * to customise; this tool stays predictable.
 *
 * Tier: manager.
 */

import { randomUUID } from "node:crypto";

import { type NoralVoiceClientConfig, createWorkflow } from "../noralvoice-client.js";
import { getTemplate, templateSlugs } from "../templates/index.js";

/** Starter values that map to the minimal conversational graph. */
const MINIMAL_TEMPLATE_ALIASES = new Set(["blank", "conversational"]);

export interface ProvisionVoiceAgentParams {
  noralosAgentId: string;
  displayName?: string;
  /**
   * "blank"/"conversational" (or omitted) → minimal dialable starter; any
   * other value is treated as a registered seed-template slug.
   */
  template?: string;
}

export type ProvisionVoiceAgentResult =
  | {
      ok: true;
      content: string;
      data: {
        voice_agent_uuid: string;
        workflow_name: string;
        workflow_id: number;
      };
    }
  | {
      ok: false;
      error: "ALREADY_PROVISIONED";
      voice_agent_uuid: string;
      message: string;
    }
  | {
      ok: false;
      error: "UNKNOWN_TEMPLATE";
      availableTemplates: string[];
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
 * A standalone API `trigger` node — the launch handle. Intentionally has NO
 * edges: NoralVoice's runtime validator rejects an is_start node with incoming
 * edges, so the trigger never points into the flow; the run begins at the
 * is_start node when the trigger fires.
 */
function triggerNode(triggerPath: string): Record<string, unknown> {
  return {
    id: "trigger",
    type: "trigger",
    position: { x: -360, y: -160 },
    data: { name: "API Trigger", enabled: true, trigger_path: triggerPath },
  };
}

/**
 * Minimal dialable conversational workflow: a standalone trigger + a
 * greet → converse → wrap-up flow. Shapes match the validated graph proven by
 * a live call (NOR-820).
 */
function minimalDialableDefinition(triggerPath: string): Record<string, unknown> {
  return {
    nodes: [
      triggerNode(triggerPath),
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

/**
 * Deep-clone a seed template's definition and inject a standalone trigger node
 * (unless one is already present) so the provisioned workflow is dialable. The
 * template constant is never mutated.
 */
function cloneWithInjectedTrigger(
  definition: Record<string, unknown>,
  triggerPath: string,
): Record<string, unknown> {
  const def = JSON.parse(JSON.stringify(definition)) as Record<string, unknown>;
  const nodes = Array.isArray(def.nodes) ? (def.nodes as Record<string, unknown>[]) : [];
  if (!nodes.some((n) => n && typeof n === "object" && n.type === "trigger")) {
    nodes.unshift(triggerNode(triggerPath));
  }
  def.nodes = nodes;
  if (!Array.isArray(def.edges)) def.edges = [];
  return def;
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
      message: `Agent already has voice_agent_uuid=${existing}. Use apply_workflow_parameters or the NoralVoice editor to modify the workflow.`,
    };
  }

  // The dial target is an agent-trigger path. Choose it here, embed it in a
  // standalone trigger node, and persist it — NoralVoice mints the ACTIVE
  // trigger for this exact path on create.
  const triggerPath = randomUUID();

  // Resolve the starting graph (template clone or minimal), always trigger-bearing.
  let definition: Record<string, unknown>;
  let templateLabel: string;
  const requested = params.template;
  if (requested !== undefined && !MINIMAL_TEMPLATE_ALIASES.has(requested)) {
    const template = getTemplate(requested);
    if (!template) {
      const available = templateSlugs();
      return {
        ok: false,
        error: "UNKNOWN_TEMPLATE",
        availableTemplates: available,
        message: `Unknown template "${requested}". Available templates: ${
          available.length ? available.join(", ") : "(none registered)"
        }.`,
      };
    }
    definition = cloneWithInjectedTrigger(
      template.definition as unknown as Record<string, unknown>,
      triggerPath,
    );
    templateLabel = template.slug;
  } else {
    definition = minimalDialableDefinition(triggerPath);
    templateLabel = "conversational";
  }

  const agentName = await ctx.resolveAgentName(params.noralosAgentId);
  const workflowName =
    params.displayName ??
    (agentName ? `${agentName} voice` : `Voice agent ${params.noralosAgentId}`);

  const created = await createWorkflow(config, { name: workflowName, definition });
  if (!created.id) {
    // Defensive: creation should always return the new workflow id.
    throw new Error(
      `NoralVoice did not return a workflow id when provisioning agent ${params.noralosAgentId}.`,
    );
  }
  await ctx.writeVoiceAgentUuid(params.noralosAgentId, triggerPath);

  return {
    ok: true,
    content: `Provisioned NoralVoice voice agent "${workflowName}" (workflow id ${created.id}, template ${templateLabel}, dial trigger ${triggerPath}) for agent ${params.noralosAgentId}.`,
    data: {
      voice_agent_uuid: triggerPath,
      workflow_name: workflowName,
      workflow_id: created.id,
    },
  };
}
