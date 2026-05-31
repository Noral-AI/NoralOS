/**
 * Capture a hand-built NoralVoice workflow into a seed-template module.
 *
 * The builder flow (provision_voice_agent → apply_workflow_parameters)
 * clones a *validated* seed definition rather than letting an agent author
 * a raw graph. The canonical way to produce such a seed is to build the
 * flow by hand in the NoralVoice editor, get it passing the publish
 * validator, then snapshot it here.
 *
 * This script fetches a workflow's current definition from NoralVoice and
 * emits a `src/templates/<slug>.ts` file with the definition inlined and a
 * `fillPoints: []` stub. The operator then declares the fillPoints (the
 * named parameters an agent may set) and registers the slug in
 * `src/templates/index.ts`.
 *
 * Re-capturing an existing template (refreshing a golden flow after an edit)
 * is safe: the script refuses to overwrite a template file unless `--force`
 * is given, and when it does overwrite it PRESERVES the operator-declared
 * `fillPoints` from the existing file rather than resetting them to `[]`.
 * Node ids in the editor are stable across saves, so preserved paths stay
 * valid — but a structural rebuild can change them, so re-verify the paths
 * after a forced refresh (the script prints a reminder).
 *
 * Usage (run with tsx from the plugin package root). Identify the workflow
 * by EITHER its numeric id OR its workflow_uuid (provide exactly one):
 *
 *   NORALVOICE_BASE_URL=https://voice.noral.ai \
 *   NORALVOICE_API_KEY=sk-... \
 *   tsx scripts/capture-voice-template.ts \
 *     --workflow-uuid 1f2e... --slug outbound_lead_qualifier \
 *     --name "Outbound Lead Qualifier" \
 *     --description "Calls a lead and qualifies need/budget/timeline." \
 *     --force
 *
 *   # ...or by numeric id:
 *   tsx scripts/capture-voice-template.ts --id 42 --slug outbound_lead_qualifier
 *
 * Pass `--out -` to print to stdout instead of writing a file. This script
 * is a developer convenience; it is not part of the plugin build or the
 * shipped runtime.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  getWorkflowByUuid,
  getWorkflowDefinition,
  type NoralVoiceClientConfig,
} from "../src/noralvoice-client.js";

function fail(message: string): never {
  process.stderr.write(`capture-voice-template: ${message}\n`);
  process.exit(1);
}

function camelize(slug: string): string {
  const parts = slug.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) fail(`Cannot derive an identifier from slug "${slug}".`);
  return parts
    .map((p, i) => (i === 0 ? p[0].toLowerCase() + p.slice(1) : p[0].toUpperCase() + p.slice(1)))
    .join("");
}

/**
 * Extract the `fillPoints: [ ... ]` array literal (the text between the
 * matching brackets, inclusive) from an existing template module's source.
 *
 * Anchors on the LAST `fillPoints:[` occurrence — prose/comments may
 * mention `fillPoints` earlier, but the property assignment is last — then
 * does a string-aware balanced-bracket scan so `]` characters inside a
 * description string don't end the scan early. Returns null if no declared
 * fillPoints literal is found.
 */
function extractFillPointsLiteral(source: string): string | null {
  const re = /fillPoints\s*:\s*\[/g;
  let match: RegExpExecArray | null;
  let open = -1;
  while ((match = re.exec(source)) !== null) {
    open = match.index + match[0].length - 1; // index of the '['
  }
  if (open < 0) return null;

  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i++; // skip the escaped char
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function renderTemplateModule(args: {
  slug: string;
  displayName: string;
  description: string;
  definition: Record<string, unknown>;
  /**
   * When refreshing an existing template, the operator's declared
   * fillPoints literal (`[ ... ]`) to carry forward. Omitted / "[]" emits
   * the stub + TODO for a first capture.
   */
  fillPointsLiteral?: string;
}): string {
  const ident = camelize(args.slug);
  const def = JSON.stringify(args.definition, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");

  const preserve = args.fillPointsLiteral && args.fillPointsLiteral !== "[]";
  const fillPointsBlock = preserve
    ? `  fillPoints: ${args.fillPointsLiteral},`
    : `  // TODO: declare the named parameters an agent may set. Each maps a key
  // to a path inside the definition above; a \`#<id>\` segment selects the
  // node/edge whose \`id\` equals \`<id>\`. Example:
  //   { key: "openingLine", path: "nodes.#start.data.greeting",
  //     description: "First thing the agent says.", required: true }
  fillPoints: [],`;

  return `/**
 * Seed template: ${args.displayName}.
 *
 * Captured from a hand-built NoralVoice workflow via
 * scripts/capture-voice-template.ts. Declare \`fillPoints\` below (the
 * named parameters an agent may set through apply_workflow_parameters),
 * then register this slug in src/templates/index.ts.
 */

import type { VoiceTemplate } from "./index.js";

export const ${ident}: VoiceTemplate = {
  slug: ${JSON.stringify(args.slug)},
  displayName: ${JSON.stringify(args.displayName)},
  description: ${JSON.stringify(args.description)},
  definition: ${def},
${fillPointsBlock}
};

export default ${ident};
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      "workflow-uuid": { type: "string" },
      slug: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean" },
    },
  });

  const slug = values.slug;
  if (!slug) {
    fail("required: --slug <slug>.");
  }

  // Identify the workflow by exactly one of --id or --workflow-uuid.
  const idRaw = values.id;
  const uuid = values["workflow-uuid"];
  if (Boolean(idRaw) === Boolean(uuid)) {
    fail("provide exactly one of --id <workflowId> or --workflow-uuid <uuid>.");
  }

  const baseUrl = process.env.NORALVOICE_BASE_URL;
  const apiKey = process.env.NORALVOICE_API_KEY;
  if (!baseUrl || !apiKey) {
    fail("set NORALVOICE_BASE_URL and NORALVOICE_API_KEY in the environment.");
  }
  const config: NoralVoiceClientConfig = { baseUrl, apiKey };

  let workflowId: number;
  if (idRaw) {
    workflowId = Number(idRaw);
    if (!Number.isInteger(workflowId) || workflowId <= 0) {
      fail(`--id must be a positive integer (got "${idRaw}").`);
    }
  } else {
    // NoralVoice keys workflow fetch/update by numeric id; resolve the uuid.
    const found = await getWorkflowByUuid(config, uuid!);
    if (!found) {
      fail(`no workflow found with workflow_uuid "${uuid}".`);
    }
    workflowId = found.id;
  }

  const detail = await getWorkflowDefinition(config, workflowId);

  // Resolve the output target up front so we can read back (and preserve)
  // any operator-declared fillPoints before overwriting an existing file.
  const toStdout = values.out === "-";
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = toStdout
    ? null
    : values.out
      ? resolve(process.cwd(), values.out)
      : join(here, "..", "src", "templates", `${slug}.ts`);

  let preservedFillPoints: string | null = null;
  if (outPath && existsSync(outPath)) {
    if (!values.force) {
      fail(
        `template already exists at ${outPath}. Re-capturing would overwrite it. ` +
          "Pass --force to refresh; the existing fillPoints will be preserved.",
      );
    }
    preservedFillPoints = extractFillPointsLiteral(readFileSync(outPath, "utf8"));
  }

  const module = renderTemplateModule({
    slug,
    displayName: values.name ?? detail.name ?? slug,
    description: values.description ?? "",
    definition: detail.workflowDefinition,
    fillPointsLiteral: preservedFillPoints ?? undefined,
  });

  if (toStdout) {
    process.stdout.write(module);
    return;
  }

  writeFileSync(outPath!, module, "utf8");
  process.stdout.write(`Wrote ${outPath}\n`);
  if (preservedFillPoints && preservedFillPoints !== "[]") {
    process.stdout.write(
      "Preserved the existing fillPoints. Re-verify each `path` against the new node ids — " +
        "a stale `#<id>` path will fail at apply_workflow_parameters time.\n",
    );
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
