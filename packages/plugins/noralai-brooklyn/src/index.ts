/**
 * Brooklyn LLM (NORALAI) adapter — public manifest.
 *
 * This is the entry point both the host runtime (via
 * `createServerAdapter()`) and any UI surface that consumes the
 * adapter list import from. It MUST stay free of node-only imports
 * so it can be evaluated in browser bundling pipelines.
 */

import type { AdapterModel } from "@noralos/adapter-utils";

import { createServerAdapter } from "./server/index.js";

/** Stable adapter identifier — used in `agents.adapterType`. */
export const type = "noralai_brooklyn";

/** Operator-facing label. Never references the upstream backend. */
export const label = "Brooklyn LLM (NORALAI)";

/**
 * Stable model ids exposed to NoralOS. The mapping from these ids to
 * an upstream technical model id (e.g. "Qwen/Qwen3-32B-FP8") happens
 * inside `execute()` and is configurable per-agent via
 * `adapterConfig.upstreamModel`.
 */
export const models: AdapterModel[] = [
  { id: "brooklyn-core", label: "Brooklyn Core" },
];

export const agentConfigurationDoc = `# noralai_brooklyn agent configuration

Adapter: noralai_brooklyn

Brooklyn LLM is a NORALAI-managed chat-completion provider. The
operator-facing model is "Brooklyn Core"; the upstream backend (an
OpenAI-compatible HTTPS endpoint) is configured per-agent and the API
key is stored per-company via NoralOS's Integration Credentials.

Core fields:
- model (string, required): the Brooklyn model id. Today: "brooklyn-core".
- baseUrl (string, required): the OpenAI-compatible HTTPS base URL
  (e.g. "https://api.runpod.ai/v2/<endpoint-id>/openai/v1"). NoralOS
  never assumes a default — set it explicitly per agent.
- upstreamModel (string, optional): the technical model id sent in
  the request body. Defaults to a named internal constant
  (DEFAULT_UPSTREAM_MODEL_ID) when not set. Operator-facing label
  ("Brooklyn Core") is independent of this value. Override per-agent
  when you want to swap the upstream backend without editing source.
- apiKeyRef (string, required): the secret reference produced by
  the Integration Credentials system. Format
  "company-secret:<credential-id>"; resolved at execute time.

Operational fields:
- temperature (number, optional): 0..2, defaults to provider default.
- maxTokens (number, optional): cap on completion tokens.
- timeoutSec (number, optional): per-call HTTPS timeout (default 30).
- maxRetries (number, optional): bounded retries on transient errors
  (default 1; retries cover 408/429/5xx, network, timeout).

Safety:
- The API key is resolved server-side from the assigned company
  secret immediately before each call and is never written to logs,
  audit rows, or returned to the model.
- The upstream technical model id is not surfaced in any operator-
  facing UI or log line above debug level.
`;

export { createServerAdapter };
