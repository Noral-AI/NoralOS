/**
 * Seed-template registry for the Voice Director builder flow.
 *
 * An agent never authors a raw workflow graph. Instead it clones a
 * validated seed template — a known-good ReactFlow definition NoralVoice
 * accepts verbatim — and fills a small set of named parameters via
 * `apply_workflow_parameters`. Each template declares its `fillPoints`:
 * named parameters mapped to a path inside the definition.
 *
 * Adding a template: create `src/templates/<slug>.ts` exporting a
 * `VoiceTemplate`, then register it in `TEMPLATES` below. The capture
 * script (`scripts/capture-voice-template.ts`) can snapshot a hand-built
 * NoralVoice workflow into such a file.
 */

import { outboundLeadQualifier } from "./outbound_lead_qualifier.js";

/** A node in a NoralVoice ReactFlow workflow definition. */
export interface VoiceWorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/** An edge in a NoralVoice ReactFlow workflow definition. */
export interface VoiceWorkflowEdge {
  id: string;
  source: string;
  target: string;
  data: Record<string, unknown>;
}

/** A workflow definition NoralVoice's `create/definition` endpoint accepts. */
export interface VoiceWorkflowDefinition {
  nodes: VoiceWorkflowNode[];
  edges: VoiceWorkflowEdge[];
}

/**
 * A named parameter an agent can fill on a seed template. `path` locates
 * the target inside the definition; a `#<id>` segment selects the array
 * element whose `id` equals `<id>` (so paths survive node reordering).
 */
export interface VoiceTemplateFillPoint {
  key: string;
  path: string;
  description: string;
  /** Advisory: the agent should customise this before publishing. */
  required: boolean;
}

export interface VoiceTemplate {
  slug: string;
  displayName: string;
  description: string;
  definition: VoiceWorkflowDefinition;
  fillPoints: VoiceTemplateFillPoint[];
}

/** Registry of seed templates, keyed by slug. */
const TEMPLATES: Record<string, VoiceTemplate> = {
  [outboundLeadQualifier.slug]: outboundLeadQualifier,
};

/** Look up a seed template by slug. Returns undefined if unknown. */
export function getTemplate(slug: string): VoiceTemplate | undefined {
  return TEMPLATES[slug];
}

/** Summaries of every registered seed template (for tool/agent discovery). */
export function listTemplates(): Array<{
  slug: string;
  displayName: string;
  description: string;
  fillPoints: VoiceTemplateFillPoint[];
}> {
  return Object.values(TEMPLATES).map((t) => ({
    slug: t.slug,
    displayName: t.displayName,
    description: t.description,
    fillPoints: t.fillPoints,
  }));
}

/** Sorted list of known slugs — handy for error messages. */
export function templateSlugs(): string[] {
  return Object.keys(TEMPLATES).sort();
}

// ---------------------------------------------------------------------------
// fillPoint application
//
// `apply_workflow_parameters` reads the live definition back from
// NoralVoice, mutates it in place along the declared fillPoint paths, then
// PUTs the whole definition. The path mini-language: dot-separated
// segments, where a `#<id>` segment selects the array element whose `id`
// equals `<id>`. Plain segments index objects by key or arrays by integer.
// ---------------------------------------------------------------------------

function descend(cur: unknown, seg: string, fullPath: string): unknown {
  if (seg.startsWith("#")) {
    const id = seg.slice(1);
    if (!Array.isArray(cur)) {
      throw new Error(`Path "${fullPath}": "${seg}" expects an array, found ${typeof cur}.`);
    }
    const hit = cur.find(
      (el) => el && typeof el === "object" && (el as Record<string, unknown>).id === id,
    );
    if (hit === undefined) {
      throw new Error(`Path "${fullPath}": no element with id "${id}".`);
    }
    return hit;
  }
  if (Array.isArray(cur)) {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
      throw new Error(`Path "${fullPath}": invalid array index "${seg}".`);
    }
    return cur[idx];
  }
  if (cur && typeof cur === "object") {
    return (cur as Record<string, unknown>)[seg];
  }
  throw new Error(`Path "${fullPath}": cannot descend into ${typeof cur} at "${seg}".`);
}

function assignLeaf(cur: unknown, seg: string, value: unknown, fullPath: string): void {
  if (seg.startsWith("#")) {
    throw new Error(`Path "${fullPath}": cannot assign to an id selector "${seg}".`);
  }
  if (Array.isArray(cur)) {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
      throw new Error(`Path "${fullPath}": invalid array index "${seg}".`);
    }
    cur[idx] = value;
    return;
  }
  if (cur && typeof cur === "object") {
    (cur as Record<string, unknown>)[seg] = value;
    return;
  }
  throw new Error(`Path "${fullPath}": cannot assign into ${typeof cur}.`);
}

/** Set `value` at `path` inside `root`, mutating in place. */
export function setAtPath(root: unknown, path: string, value: unknown): void {
  const segments = path.split(".");
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`Invalid path "${path}".`);
  }
  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = descend(cur, segments[i], path);
  }
  assignLeaf(cur, segments[segments.length - 1], value, path);
}

export interface ApplyParametersResult {
  /** Keys that were written, in input order. */
  applied: string[];
}

/**
 * Apply named `parameters` onto a workflow `definition` using `template`'s
 * fillPoints. Rejects any parameter key not declared as a fillPoint — the
 * agent can only touch what the template exposes. Mutates `definition`.
 */
export function applyParameters(
  definition: Record<string, unknown>,
  template: VoiceTemplate,
  parameters: Record<string, unknown>,
): ApplyParametersResult {
  const byKey = new Map(template.fillPoints.map((fp) => [fp.key, fp]));
  const unknownKeys = Object.keys(parameters).filter((k) => !byKey.has(k));
  if (unknownKeys.length > 0) {
    const allowed = template.fillPoints.map((fp) => fp.key).join(", ");
    throw new Error(
      `Unknown parameter(s) for template "${template.slug}": ${unknownKeys.join(", ")}. ` +
        `Allowed: ${allowed || "(none)"}.`,
    );
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    const fp = byKey.get(key)!;
    setAtPath(definition, fp.path, value);
    applied.push(key);
  }
  return { applied };
}
