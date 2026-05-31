/**
 * `noralvoice:apply_workflow_parameters` tool handler.
 *
 * Phase 11 — seed-template builder (manager tier).
 *
 * Customises a workflow that was provisioned from a seed template by
 * setting the template's declared `fillPoints` (named parameters mapped to
 * paths inside the definition). The agent supplies friendly names like
 * `openingLine` / `agentSystemPrompt`; this resolves each to its path and
 * writes it. Keys the template does not declare are rejected — the agent
 * can only touch what the template exposes, never the raw graph.
 *
 * Read-modify-write: fetch the current definition, mutate the declared
 * paths, PUT the whole definition back. Voice, caller id, transfers, and
 * telephony are NOT set here — they go through the dedicated tools.
 */

import {
  type NoralVoiceClientConfig,
  agentSaveWorkflow,
  getWorkflowDefinition,
} from "../noralvoice-client.js";
import { applyParameters, getTemplate } from "../templates/index.js";

export interface ApplyWorkflowParametersParams {
  workflowId: number;
  templateSlug: string;
  parameters: Record<string, unknown>;
}

export type ApplyWorkflowParametersResult =
  | {
      ok: true;
      content: string;
      data: { workflow_id: number; applied: string[] };
    }
  | {
      ok: false;
      error: "UNKNOWN_TEMPLATE";
      message: string;
      availableTemplates: string[];
    }
  | {
      ok: false;
      error: "UNKNOWN_PARAMETERS";
      message: string;
      allowed: string[];
    };

export async function executeApplyWorkflowParameters(
  config: NoralVoiceClientConfig,
  params: ApplyWorkflowParametersParams,
  // `getTemplate` is injectable for tests; defaults to the real registry.
  deps: { resolveTemplate?: typeof getTemplate } = {},
): Promise<ApplyWorkflowParametersResult> {
  const resolveTemplate = deps.resolveTemplate ?? getTemplate;
  const template = resolveTemplate(params.templateSlug);
  if (!template) {
    return {
      ok: false,
      error: "UNKNOWN_TEMPLATE",
      message: `Unknown template "${params.templateSlug}".`,
      availableTemplates: [],
    };
  }

  // Reject undeclared keys before touching the network — cheaper, and the
  // agent gets the allowed set back to retry.
  const allowed = template.fillPoints.map((fp) => fp.key);
  const allowedSet = new Set(allowed);
  const unknownKeys = Object.keys(params.parameters).filter((k) => !allowedSet.has(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: "UNKNOWN_PARAMETERS",
      message: `Unknown parameter(s) for template "${template.slug}": ${unknownKeys.join(", ")}.`,
      allowed,
    };
  }

  const detail = await getWorkflowDefinition(config, params.workflowId);
  const definition = detail.workflowDefinition;
  const { applied } = applyParameters(definition, template, params.parameters);

  const saved = await agentSaveWorkflow(config, {
    workflowId: params.workflowId,
    workflowDefinition: definition,
  });

  return {
    ok: true,
    content: `Applied ${applied.length} parameter(s) (${
      applied.join(", ") || "none"
    }) to workflow id=${saved.id}.`,
    data: { workflow_id: saved.id, applied },
  };
}
