"""Batch 3 resolutions."""
from pathlib import Path

resolutions = [
    # agent-live-run-routes.test.ts — take upstream (more thorough test name)
    ("./server/src/__tests__/agent-live-run-routes.test.ts",
     """<<<<<<< v2026.525.0
  it("treats explicit zero or invalid live run limit as the capped default", async () => {
=======
  it("treats explicit zero live run limits as the capped default", async () => {
>>>>>>> master""",
     '  it("treats explicit zero or invalid live run limit as the capped default", async () => {'),

    # company-portability.test.ts — take upstream (adds whole new test) + brand rename
    ("./server/src/__tests__/company-portability.test.ts",
     """  it("exports default sidebar order into the Paperclip extension and manifest", async () => {""",
     '  it("exports default sidebar order into the NoralOS extension and manifest", async () => {'),
    # And remove the conflict markers (after the brand rename above is applied)
    ("./server/src/__tests__/company-portability.test.ts",
     """<<<<<<< v2026.525.0
  it("exports legacy inline sensitive env values as declarations without values", async () => {""",
     '  it("exports legacy inline sensitive env values as declarations without values", async () => {'),
    ("./server/src/__tests__/company-portability.test.ts",
     """=======
  it("exports default sidebar order into the NoralOS extension and manifest", async () => {
>>>>>>> master""",
     '  it("exports default sidebar order into the NoralOS extension and manifest", async () => {'),

    # environment-runtime.test.ts — take upstream (adds 31234 lease value)
    ("./server/src/__tests__/environment-runtime.test.ts",
     """<<<<<<< v2026.525.0
    expect(workerManager.call).toHaveBeenCalledWith(pluginId, "environmentReleaseLease", expect.anything(), 31234);
=======
    expect(workerManager.call).toHaveBeenCalledWith(pluginId, "environmentReleaseLease", expect.anything());
>>>>>>> master""",
     '    expect(workerManager.call).toHaveBeenCalledWith(pluginId, "environmentReleaseLease", expect.anything(), 31234);'),

    # gemini-local-adapter.test.ts — take upstream (adds isGeminiTurnLimitResult) + brand rename
    ("./server/src/__tests__/gemini-local-adapter.test.ts",
     """<<<<<<< v2026.525.0
import {
  isGeminiTurnLimitResult,
  isGeminiUnknownSessionError,
  parseGeminiJsonl,
} from "@paperclipai/adapter-gemini-local/server";
import { parseGeminiStdoutLine } from "@paperclipai/adapter-gemini-local/ui";
import { printGeminiStreamEvent } from "@paperclipai/adapter-gemini-local/cli";
=======
import { isGeminiUnknownSessionError, parseGeminiJsonl } from "@noralos/adapter-gemini-local/server";
import { parseGeminiStdoutLine } from "@noralos/adapter-gemini-local/ui";
import { printGeminiStreamEvent } from "@noralos/adapter-gemini-local/cli";
>>>>>>> master""",
     """import {
  isGeminiTurnLimitResult,
  isGeminiUnknownSessionError,
  parseGeminiJsonl,
} from "@noralos/adapter-gemini-local/server";
import { parseGeminiStdoutLine } from "@noralos/adapter-gemini-local/ui";
import { printGeminiStreamEvent } from "@noralos/adapter-gemini-local/cli";"""),

    # heartbeat-model-profile.test.ts — take upstream (adds listAdapterModelProfiles)
    ("./server/src/__tests__/heartbeat-model-profile.test.ts",
     """<<<<<<< v2026.525.0
import {
  listAdapterModelProfiles,
  type AdapterModelProfileDefinition,
} from "../adapters/index.js";
=======
import type { AdapterModelProfileDefinition } from "../adapters/index.js";
>>>>>>> master""",
     """import {
  listAdapterModelProfiles,
  type AdapterModelProfileDefinition,
} from "../adapters/index.js";"""),

    # plugins.ts — take upstream (adds PluginPerformActionActorContext) + brand rename
    ("./server/src/routes/plugins.ts",
     """<<<<<<< v2026.525.0
import type { PluginPerformActionActorContext, ToolRunContext } from "@paperclipai/plugin-sdk";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@paperclipai/plugin-sdk";
=======
import type { ToolRunContext } from "@noralos/plugin-sdk";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@noralos/plugin-sdk";
>>>>>>> master""",
     """import type { PluginPerformActionActorContext, ToolRunContext } from "@noralos/plugin-sdk";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES } from "@noralos/plugin-sdk";"""),

    # routes/secrets.ts — take upstream (cleaner helper call)
    ("./server/src/routes/secrets.ts",
     """<<<<<<< v2026.525.0
  const defaultProvider = getConfiguredSecretProvider();
=======
  const configuredDefaultProvider = process.env.NORALOS_SECRETS_PROVIDER;
  const defaultProvider = (
    configuredDefaultProvider && SECRET_PROVIDERS.includes(configuredDefaultProvider as SecretProvider)
      ? configuredDefaultProvider
      : "local_encrypted"
  ) as SecretProvider;
>>>>>>> master""",
     '  const defaultProvider = getConfiguredSecretProvider();'),

    # services/companies.ts — take fork (more detailed comment)
    ("./server/src/services/companies.ts",
     """<<<<<<< v2026.525.0
        // Delete from child tables in dependency order
        const companyRunIds = await tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.companyId, id));

=======
        // Delete from child tables in dependency order.
        //
        // For tables whose FK to `companies.id` is declared with
        // `onDelete: "cascade"` (e.g. environments, integrationCredentials,
        // routines, labels, departments, etc.) the row is auto-removed
        // when the companies row drops at the end of this transaction —
        // they do NOT appear below. Likewise, tables that cascade off a
        // table we delete explicitly (e.g. `issue_attachments` cascades
        // off `issues`, `document_revisions` cascades off `documents`)
        // are also omitted; PostgreSQL fires those triggers within the
        // explicit DELETE statement.
        //
        // The tables below are the ones that have a non-cascade
        // `companyId` FK AND no parent-cascade chain to a table we
        // already delete. Missing any of them produces an FK-constraint
        // error on the final `delete(companies)`.
>>>>>>> master""",
     """        // Delete from child tables in dependency order.
        //
        // For tables whose FK to `companies.id` is declared with
        // `onDelete: "cascade"` (e.g. environments, integrationCredentials,
        // routines, labels, departments, etc.) the row is auto-removed
        // when the companies row drops at the end of this transaction —
        // they do NOT appear below. Likewise, tables that cascade off a
        // table we delete explicitly (e.g. `issue_attachments` cascades
        // off `issues`, `document_revisions` cascades off `documents`)
        // are also omitted; PostgreSQL fires those triggers within the
        // explicit DELETE statement.
        //
        // The tables below are the ones that have a non-cascade
        // `companyId` FK AND no parent-cascade chain to a table we
        // already delete. Missing any of them produces an FK-constraint
        // error on the final `delete(companies)`.
        const companyRunIds = await tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.companyId, id));
"""),

    # services/projects.ts — take upstream (adds pluginManagedResources, plugins) + brand rename
    ("./server/src/services/projects.ts",
     """<<<<<<< v2026.525.0
import type { Db } from "@paperclipai/db";
import {
  projects,
  projectGoals,
  goals,
  pluginManagedResources,
  plugins,
  projectWorkspaces,
  workspaceRuntimeServices,
} from "@paperclipai/db";
=======
import type { Db } from "@noralos/db";
import { projects, projectGoals, goals, projectWorkspaces, workspaceRuntimeServices } from "@noralos/db";
>>>>>>> master""",
     """import type { Db } from "@noralos/db";
import {
  projects,
  projectGoals,
  goals,
  pluginManagedResources,
  plugins,
  projectWorkspaces,
  workspaceRuntimeServices,
} from "@noralos/db";"""),
]

applied = 0
failed = []
for path, old, new in resolutions:
    p = Path(path)
    try:
        content = p.read_text(encoding='utf-8')
    except Exception as e:
        failed.append((path, f"read error: {e}"))
        continue
    if old not in content:
        failed.append((path, "old text not found"))
        continue
    new_content = content.replace(old, new, 1)
    p.write_text(new_content, encoding='utf-8')
    applied += 1
    print(f"  ✓ {path}")

print()
print(f"=== Applied {applied}/{len(resolutions)} ===")
if failed:
    print("FAILURES:")
    for path, reason in failed:
        print(f"  ✗ {path}: {reason}")
