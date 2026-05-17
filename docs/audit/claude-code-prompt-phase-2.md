# Claude Code Prompt — Phase 2: Credential consolidation

**Prerequisite:** Phase 1 PR-A and PR-B merged; `@noralai/voice-sdk@0.2.0` published; the `noralai.noralvoice` plugin is active on `agent.noral.ai`; a Voice Director can be created in at least one company by hand-editing `plugin_config.config_json`.

This phase is **NoralOS-only**. One PR. The goal is to get the NoralVoice API key + base URL + org ID flowing through `/company/settings/integrations` (PR #46's system) so operators stop hand-editing JSON.

Small, focused phase.

Copy-paste everything below the `---` line into a fresh Claude Code session in `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`.

---

You are executing **Phase 2** of the NoralOS ↔ NoralVoice consolidation. NoralOS-only.

## Binding context (read in this order)

```
docs/audit/
  consolidation-scope.md          ← binding scope
  consolidation-plan.md           ← Phase 2 section
  overlap-map.md                  ← §C1 "integration credentials"
  integration-architecture.md     ← §5 "auth contract"
```

Also read:
- `CLAUDE.md`
- `packages/shared/src/integration-providers.ts` — the registry you're extending
- `server/src/routes/integrations.ts` — the API surface
- `server/src/services/integrations/assignments.ts` (or wherever assignments live — find it via grep)
- `ui/src/pages/CompanyIntegrations.tsx` — the existing UI (no UI changes needed; new providers auto-render)
- The Twilio provider entry in `INTEGRATION_PROVIDERS` — that's your closest analogue (multi-field provider with secret + non-secret fields)

## Repo / branching

- Repo: `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`
- Base branch: `master`
- Working branch: `feat/phase-2-noralvoice-integration-provider`

## Goal

After this phase, an operator can:
1. Go to `/:prefix/company/settings/integrations`
2. Click "Add integration"
3. Pick **NoralVoice** from the picker
4. Paste API key, base URL (default `https://voice.noral.ai`), org ID
5. Hit **Test** → green badge
6. Hit **Save** → assignment to `noralai.noralvoice` plugin happens automatically
7. Plugin lifecycle hook from Phase 1 B11 fires → webhook registered with NoralVoice
8. Plugin page transitions from State A (no key) to State B (key set, Voice Director button shown)

No hand-editing of `plugin_config.config_json` required.

## Deliverables (one PR)

### D1. New `INTEGRATION_PROVIDERS` entry

File: `packages/shared/src/integration-providers.ts`

Add entry after the Twilio provider:

```ts
{
  id: "noralvoice",
  category: "voice",
  credentialType: "api_key",
  displayName: "NoralVoice",
  description: "Voice agent platform — design, run, and monitor voice workflows from your NoralOS agents.",
  iconUrl: "/integrations/noralvoice.svg",  // add the asset (see D5)
  helpUrl: "https://docs.noral.ai/voice/noralos-integration",
  fields: [
    {
      key: "value",
      label: "API Key",
      type: "secret",
      required: true,
      placeholder: "Paste your NoralVoice X-API-Key",
      helpText: "Generate at voice.noral.ai → Settings → API Keys",
    },
    {
      key: "baseUrl",
      label: "Base URL",
      type: "string",
      required: true,
      default: "https://voice.noral.ai",
      helpText: "Override only for self-hosted NoralVoice",
    },
    {
      key: "organizationId",
      label: "NoralVoice Organization ID",
      type: "integer",
      required: true,
      helpText: "Found at voice.noral.ai → Settings → Organization",
    },
  ],
  test: {
    kind: "http",
    method: "GET",
    pathTemplate: "{baseUrl}/api/v1/health",
    headers: { "X-API-Key": "{value}" },
    expectStatus: 200,
    expectJsonPath: "$.status",  // verify it's a NoralVoice response, not a generic 200
    expectJsonValue: "ok",
  },
  assignableSlots: [
    { pluginId: "noralai.noralvoice", path: "apiKeyRef" },
  ],
},
```

If the existing `IntegrationProvider` type doesn't support a multi-field `test` with `expectJsonPath`, extend it minimally — match how Twilio handles its test probe. If the type is too narrow, propose the extension in the PR description and pick the smallest change.

### D2. New `ASSIGNMENT_TARGETS` entry

Same file, in the `ASSIGNMENT_TARGETS` array.

The challenge: the NoralVoice provider has **three fields** but only one is a secret (`value` → plugin `apiKeyRef`). The other two (`baseUrl`, `organizationId`) must also flow to the plugin's instanceConfig as **direct values**, not secret refs.

Mirror how Twilio handles this. The shape likely looks like:

```ts
{
  targetPluginId: "noralai.noralvoice",
  expectsProvider: "noralvoice",
  fieldMappings: [
    { sourceField: "value", targetConfigPath: "apiKeyRef", as: "secret-ref" },
    { sourceField: "baseUrl", targetConfigPath: "baseUrl", as: "value" },
    { sourceField: "organizationId", targetConfigPath: "organizationId", as: "value" },
  ],
  displayName: "NoralVoice connection",
},
```

If `fieldMappings` doesn't exist in the current shape (the existing assignments might be single-field), look at how Twilio's multi-field assignment works — there should be a pattern already. If there isn't and Twilio just stuffs everything as a serialized JSON secret, propose the cleanest minimal extension and document the trade-off in the PR.

### D3. Assignment writer support for non-secret fields

File: `server/src/services/integrations/assignments.ts` (or equivalent — find it via grep on `patchConfig` + `secret-ref`)

Confirm the writer:
1. For `as: "secret-ref"` fields → writes `"company-secret:<uuid>"` to the target path
2. For `as: "value"` fields → writes the direct value to the target path
3. Uses shallow-merge so existing config keys (like `voiceMode` per memory `feedback_compose_env_passthroughs` and PR #46 patchConfig behavior) are preserved

If multi-field writes don't already work, this is the smallest extension. Add tests:
- Single-secret assignment (existing) — still works
- Multi-field assignment with one secret-ref + two direct values — writes all three correctly
- Re-assignment overwrites only the mapped fields, preserves unmapped fields
- Removing the credential clears the secret-ref but leaves direct values (deliberate — direct values are not secrets, retaining them on disconnect is fine and matches Twilio behavior)

### D4. Health probe endpoint on NoralVoice (verify already exists)

The `test.pathTemplate` is `{baseUrl}/api/v1/health`. Verify NoralVoice has this endpoint by checking `voice.noral.ai/api/v1/health` returns `{ "status": "ok" }` (curl test). 

If it doesn't exist, **stop and report** — don't add it (NoralVoice changes are out of scope for Phase 2). The fallback is to use an existing endpoint that authenticates (e.g., `GET /api/v1/user/me`) — pick one and document the choice.

### D5. NoralVoice icon asset

File: `ui/public/integrations/noralvoice.svg`

Copy or adapt the NoralVoice logo SVG. Keep it monochrome / single-color so it fits the existing integration card aesthetic. If you don't have a NoralVoice SVG handy, use a generic microphone icon from Lucide as a placeholder and note in the PR that a designer-blessed asset should replace it.

### D6. Webhook re-registration on org change

Phase 1 B11 wired an `onConfigChange` plugin lifecycle hook that registers a webhook with NoralVoice. Verify behavior when:

1. Credential first assigned → plugin registers webhook (Phase 1 behavior; should already work)
2. Operator edits `organizationId` to a different NoralVoice org → plugin should **delete the old webhook on the previous org** and register a new one on the new org
3. Operator deletes the credential → plugin should delete the webhook from NoralVoice
4. Operator rotates the API key (same org) → no webhook re-registration needed; webhook auth is by HMAC secret, not API key

If the Phase 1 hook doesn't handle org-change, extend it. This is the seam where Phase 2 meets Phase 1; it's small but easy to miss.

### D7. Authz / scope verification

PR #46 shipped a 31-case authz matrix on the integrations routes. Verify new provider + assignment paths route through it correctly:

- Only `owner` / `admin` / `instance_admin` / `local_implicit` can create/edit NoralVoice credentials
- `member` / `viewer` / `operator` are blocked with 403
- Cross-company assignment attempts are blocked (operator in Company A cannot assign a Company B credential)

Don't write new authz code — verify the existing matrix catches the new provider. Add 3 tests at minimum: admin-success, member-403, cross-company-403.

### D8. Smoke

After D1–D7 land:

- [ ] Build the UI; `/company/settings/integrations` shows NoralVoice in the picker with the icon and description
- [ ] Click "Add NoralVoice" → form renders three fields (API Key as masked secret, Base URL with default, Org ID as integer)
- [ ] Paste a valid NoralVoice API key + base URL + org ID, click **Test** → green checkmark, expected response visible
- [ ] Hit **Save** → row appears in the credentials list with masked suffix
- [ ] Auto-assigned to `noralai.noralvoice / apiKeyRef` (single assignable slot) → assignment badge shows on the row
- [ ] Inspect `plugin_config.config_json` for the company → `apiKeyRef` is a `company-secret:<uuid>` string, `baseUrl` and `organizationId` are direct values
- [ ] Plugin page in NoralOS transitions from State A to State B (per Phase 1 B10)
- [ ] Phase 1 B11 lifecycle hook fired → `integration_webhooks` table on NoralVoice has a new row pointing at the NoralOS callback URL
- [ ] Voice Director (created via Phase 1) successfully calls `noralvoice:list_workflows` and gets real data
- [ ] Edit the credential, change `organizationId` to a different value, save → old webhook deleted on the previous NoralVoice org, new webhook registered on the new org
- [ ] Delete the credential → `apiKeyRef` cleared from plugin config, webhook deleted from NoralVoice; plugin page reverts to State A
- [ ] As a `member` role, attempt to create/edit the credential → 403
- [ ] Standalone NoralVoice smoke still passes (no change to NoralVoice in this phase)

## PR meta

- Title: `feat(phase-2): NoralVoice integration provider + multi-field assignment`
- Commits per item (D1+D2 registry, D3 assignment writer, D5 icon, D6 lifecycle, D7 authz tests, D8 smoke)
- PR body includes the D8 smoke checklist results

## Anti-goals

- Do NOT change the NoralVoice repo (Phase 2 is NoralOS-only)
- Do NOT add new UI components (the existing CompanyIntegrations.tsx auto-renders new providers; if it doesn't render NoralVoice correctly, that's a bug in the existing renderer worth fixing minimally — don't redesign)
- Do NOT add OAuth flow for NoralVoice (it's API-key, not OAuth)
- Do NOT add new tools to the plugin (Phase 7 fills the inventory)
- Do NOT change the plugin's manifest from Phase 1 unless `instanceConfigSchema` was incomplete — if it was, fix it minimally and call it out

## Stop and report if

- The existing `IntegrationProvider` type or `ASSIGNMENT_TARGETS` shape can't represent a multi-field-mapping assignment without a non-trivial extension — propose the extension before implementing
- `/api/v1/health` on NoralVoice doesn't return `{ "status": "ok" }` or doesn't exist — pick a fallback endpoint and document
- Phase 1 B11's lifecycle hook doesn't actually fire on config change — surface this as a Phase 1 bug, not a Phase 2 deliverable
- Multi-field provider rendering in CompanyIntegrations.tsx is broken for NoralVoice (e.g., integer field type isn't handled) — fix minimally; flag for design follow-up

## When you finish

Reply with:
1. PR URL and merge status
2. D8 smoke results
3. Whether D6 (webhook re-registration) required Phase 1 changes — if so, note exactly what was added
4. Any provider-registry shape extensions and your reasoning
5. Anything that should land in Phase 3 (likely: the `set_agent_voice` tool needs the credential to already be assigned — which after Phase 2, it always will be in NoralOS-managed flows)

Do not start Phase 3. Wait for the next prompt.
