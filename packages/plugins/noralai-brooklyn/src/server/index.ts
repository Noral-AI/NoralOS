/**
 * `createServerAdapter()` — the entry point `plugin-loader.ts` looks
 * for. Returns a `ServerAdapterModule` shaped exactly like the
 * built-in adapters under `packages/adapters/`.
 *
 * Kept thin on purpose: the heavy lifting lives in `execute.ts` and
 * `test-environment.ts` so each can be unit-tested without a full
 * runtime context.
 */

import type { ServerAdapterModule } from "@noralos/adapter-utils";

import {
  type AdapterModel,
} from "@noralos/adapter-utils";

import {
  agentConfigurationDoc as defaultAgentConfigurationDoc,
  label as defaultLabel,
  models as defaultModels,
  type as defaultType,
} from "../index.js";

import { execute } from "./execute.js";
import { testEnvironment } from "./test-environment.js";

export function createServerAdapter(): ServerAdapterModule {
  return {
    type: defaultType,
    execute,
    testEnvironment,
    models: defaultModels as AdapterModel[],
    agentConfigurationDoc: defaultAgentConfigurationDoc,
    // Brooklyn is a chat-completion HTTPS adapter. It is not a CLI
    // tool, so the "managed instructions bundle" surface does not
    // apply. The agent prompt assembly (built by the canonical's
    // `agent-instructions.ts` pipeline) is passed in via the
    // `AdapterExecutionContext.context` payload like any other
    // adapter; this flag stays explicit at false to avoid the host
    // injecting an instructions file argument.
    supportsInstructionsBundle: false,
    requiresMaterializedRuntimeSkills: false,
  };
}

export { execute, testEnvironment };
