# Override-Matrix Evolution — From Binary Flatten to Model Tiers

**Status:** DESIGN — implements next-action 3 of `execution-layer-strategy.md` (D1/D2 mechanics). Not yet scheduled.
**Date:** 2026-06-10
**Code basis:** `master` @ `e01f82be`.

## 1. Problem

The company LLM-backend switch (PR #143, platform key PR #155) is binary and company-wide:

- `CompanyLlmBackendSettings.mode` ∈ `native | deepseek_v4` (`packages/shared/src/types/company.ts:14`).
- `resolveEffectiveAdapterType()` (`server/src/services/llm-backend-override.ts:11`): when mode is `deepseek_v4`, EVERY run is forced to `opencode_local`, ignoring the agent's stored `adapterType`.

This was right for "switch the whole company to cheap inference," but it blocks the commercial tier model from `execution-layer-strategy.md`:

- No premium tier — a single agent (or issue) cannot run Claude while the fleet runs DeepSeek.
- No BYO-harness coexistence — a `hermes_local` or customer-adapter agent is silently flattened to OpenCode.
- The flatten happens at execution time with no surface telling the operator "your agent's adapter is being ignored."

## 2. Target model

Replace the binary flatten with a **managed default + explicit exceptions** resolution. One new mode, no breaking change:

```ts
export interface CompanyLlmBackendSettings {
  mode: "native" | "deepseek_v4" | "managed";   // deepseek_v4 kept as legacy alias (see §4)
  /** mode=managed: the platform default profile applied to agents with no exception. */
  defaultProfile?: LlmExecutionProfile;          // e.g. { adapterType: "opencode_local", model: "deepseek/deepseek-v4-pro", credentialId: "..." }
  /** mode=managed: named premium/alternate profiles selectable per agent or issue. */
  profiles?: Record<string, LlmExecutionProfile>; // e.g. { premium: { adapterType: "opencode_local", model: "anthropic/claude-...", credentialId } }
  model?: string;          // legacy (deepseek_v4)
  credentialId?: string;   // legacy (deepseek_v4)
  updatedAt?: string;
  updatedByUserId?: string | null;
}
```

```ts
interface LlmExecutionProfile {
  adapterType: string;          // opencode_local | claude_local | hermes_local | ...
  model?: string;
  credentialId?: string;        // secrets-vault credential injected per adapter convention
  byoAllowed?: boolean;         // profile may be satisfied by the agent's own stored adapter
}
```

**Resolution order (one place, `resolveEffectiveExecution()` replacing `resolveEffectiveAdapterType()`):**

1. Issue-level override (`issueAssigneeOverrides.modelProfile` / executionPolicy) — names a profile key.
2. Agent-level exception (`agents.runtimeConfig.llmProfile` — new optional field) — names a profile key, or `"native"` to use the agent's stored adapter (gated by `byoAllowed` / enterprise plan flag).
3. Company `defaultProfile`.
4. `mode=native` → agent's stored `adapterType` + `adapterConfig` (today's behavior, unchanged).

The existing per-run model resolution (call > issue > agent, `heartbeat.ts` `resolveModelProfileApplication`) stays as-is *within* the chosen profile; this design only decides which adapter+credential envelope the run executes in.

## 3. Invariants

- **Lossless**: like today's override, agent rows are never mutated; removing the company setting restores stored adapters exactly (`llm-backend-override.ts:6` comment is the contract — keep it).
- **Visible**: when a run executes under a profile that differs from the agent's stored adapter, stamp `contextSnapshot.executionProfile = <key>` and surface it in the run detail UI. The silent flatten is the bug; don't reproduce it.
- **Vault-only credentials**: profiles reference `credentialId` into the existing secrets vault. No raw keys in `llm_backend_settings` JSONB.
- **Tier gating hook**: `profiles.premium` selection is where usage-billing metering attaches (cost events already record per-run usage; the profile key gives the billing dimension).

## 4. Migration

- `deepseek_v4` remains valid and is interpreted as `managed` with `defaultProfile = { adapterType: "opencode_local", model, credentialId }` — a pure read-time normalization (`normalizeLlmBackendSettings()`), no data migration required. UI writes `managed` going forward; a later cleanup migration can rewrite stored `deepseek_v4` rows.
- `resolveEffectiveAdapterType()` callers (single call site at `heartbeat.ts:6986` + tests) move to `resolveEffectiveExecution()`.
- `buildDeepseekOverrideConfig()` generalizes to `buildProfileOverrideConfig(profile, runtimeConfig)` — same field-scrubbing rules (drop adapter-specific fields like `command`; carry cwd/instructions/timeouts/skills/env).

## 5. Touchpoints

| Layer | Change |
|---|---|
| `packages/shared/src/types/company.ts` | settings type + profile type |
| `server/src/services/llm-backend-override.ts` | resolution + normalization + profile config builder |
| `server/src/services/heartbeat.ts:6986` | call-site swap; stamp `executionProfile` into contextSnapshot |
| `server/src/routes/companies.ts` | PATCH validation for new shape |
| `agents.runtimeConfig` | optional `llmProfile` key (no schema migration; JSONB) |
| UI: company settings | mode picker grows "Managed (default + exceptions)"; per-agent settings grows profile dropdown |
| UI: run detail | show effective profile when ≠ stored adapter |

## 6. Non-goals

- No per-customer pricing/billing logic in this change (the profile key is the hook; billing is separate work).
- No change to model resolution *within* a profile.
- No automatic profile selection (e.g. "route hard issues to premium") — that's a later platform feature; this design only makes it expressible.

## 7. Open questions

1. Should issue-level premium routing require an approval (spend gate) when the issue's assignee is on the default profile? (Ties to budget enforcement, strategy doc §8 item 5.)
2. Is `byoAllowed` a per-profile flag or a company-plan flag? (Enterprise BYO story.)
