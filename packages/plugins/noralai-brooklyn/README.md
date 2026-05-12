# @noralos-plugins/noralai-brooklyn

External adapter plugin that adds **Brooklyn LLM (NORALAI)** as a selectable agent runtime in canonical NoralOS.

## What this is

A first-class adapter (in the same shape as `claude_local`, `codex_local`, etc.) exposing a NORALAI-branded chat-completion provider. The OpenAI-compatible upstream endpoint is configured per-agent via `adapterConfig`; the API key is stored per-company via the existing `integration_credentials` system (PR #46).

The operator-facing name is **Brooklyn LLM** / **Brooklyn Core**. The underlying backend (currently a Qwen model on RunPod) is an implementation detail and never surfaces in UI labels, log lines, or adapter identifiers.

## Adapter identity

| Surface | Value |
|---|---|
| `type` | `noralai_brooklyn` |
| `label` | `Brooklyn LLM (NORALAI)` |
| First model | `brooklyn-core` (label `Brooklyn Core`) |
| Permission | `tools.business.calendar.book`-style scopes do not apply — Brooklyn is an LLM adapter, not a tool plugin. |

## Loading

This package follows the canonical **external adapter plugin** contract — exports `createServerAdapter()` from its main entry, discovered at server start by `buildExternalAdapters()` (`server/src/adapters/plugin-loader.ts`).

To register for a dev/test deployment:

```ts
import { addAdapterPlugin } from "@noralos/server/services/adapter-plugin-store";

addAdapterPlugin({
  type: "noralai_brooklyn",
  packageName: "@noralos-plugins/noralai-brooklyn",
  localPath: "/abs/path/to/packages/plugins/noralai-brooklyn",
  installedAt: new Date().toISOString(),
});
```

In production, the adapter is installed via the standard NoralOS adapter plugin install flow (the Adapter Manager UI).

## Credential

Provider entry: `noralai_brooklyn` (category `llm`, type `api_key`). Defined in `packages/shared/src/integration-providers.ts`.

The credential carries only the RunPod API key. The per-agent `adapterConfig` carries the upstream endpoint URL, the upstream technical model id, and any other request shape parameters.

## PR 1 scope

This is the **first** PR that ships Brooklyn LLM into canonical NoralOS. Scope is deliberately narrow:

- Adapter registered and selectable for one agent.
- Credential storable and assignable via `/company/settings/integrations`.
- `execute()` calls the OpenAI-compatible endpoint and returns a real chat response.
- `testEnvironment()` validates connectivity.

Not in PR 1: Twilio SMS, Google Calendar, runtime tools, confirmation queues, smart-model-routing profiles, cost-rate tables.

See `BROOKLYN_LLM_INTEGRATION_MAP.md` at the repo root for the full plan.
