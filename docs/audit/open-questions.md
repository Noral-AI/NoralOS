# Open Questions

**Audit date:** 2026-05-14

> Things I couldn't determine from code alone. Each requires user input or out-of-band verification before the corresponding decision can be made. Ordered by blocking-ness.

---

## Blocking (must decide before Phase 1 starts)

### 1. NoralVoice prod URL and tenancy model

The audit found `voice.noral.ai` referenced in [deploy/noral/README.md](../../deploy/noral/README.md) as the server `129.121.101.154`. Confirmed?

- Is `voice.noral.ai` the canonical prod URL?
- Is there a single NoralVoice org per NoralOS company, or do customers share an org?
- Is multi-org-per-customer ever a real scenario (one customer with `voice.noral.ai/eng-org` and `voice.noral.ai/sales-org`)?

The plugin's `instanceConfig.organizationId` (one int per NoralOS company) assumes 1:1. If many-to-one, the plugin needs a config dropdown.

### 2. SDK rename: are there existing external consumers?

Phase 1 renames the published `dograh-sdk` (Python) and `@dograh/sdk` (TypeScript) packages to `noralai-voice` / `@noralai/voice-sdk`.

- Are any **non-Noral** customers consuming these published packages today?
- If yes — for how long should the deprecated names continue to publish?
- If no — we can rename in a single release with a one-line note

Source check: [scripts/release_sdks.sh](../../scripts/release_sdks.sh) publishes via twine (Python) and npm (TS). Last published versions are both v0.1.5.

### 3. The MPS dependency — keep, replace, or remove?

NoralVoice OSS phones home to `https://services.dograh.com` ([api/services/auth/depends.py:236-310](../../api/services/auth/depends.py)) to issue managed LLM/TTS/STT keys ("service keys") on signup. This is a Dograh-cloud dependency.

Three options:
1. **Keep MPS** but rename / repoint to a Noral-owned issuer (`services.noral.ai`?). This continues to phone home — fine if it's our service.
2. **Replace with NoralOS-issued cloud-credit system.** NoralOS holds the bulk-bought keys and resells via `integration_credentials`. Cleaner long-term.
3. **Remove entirely.** NoralVoice standalone requires every user to bring their own keys for every provider. Friction but maximally independent.

The "rebrand" theme suggests (1) short-term, (2) long-term. Or (3) for purist standalone. Decision affects Phase 8.

### 4. Local-trusted mode equivalence

NoralOS supports `NORALOS_DEPLOYMENT_MODE=local_trusted` which synthesizes a board admin actor for every request ([server/src/middleware/auth.ts:25-32](../../server/src/middleware/auth.ts)).

NoralVoice supports `AUTH_PROVIDER=local` + `DEPLOYMENT_MODE=oss` which uses bcrypt + JWT.

- Should NoralVoice gain a `local_trusted` mode equivalent for dev-machine usage where there's no real auth?
- Or should NoralVoice's local-OSS always require login?

Not blocking Phase 1, but affects dev DX and Phase 8.

### 5. Workflow / Voice Agent renaming

[uiux-streamlining.md §3](uiux-streamlining.md) recommends settling the "Agent" vs "Workflow" terminology. The most invasive change is renaming the NoralVoice DB tables:

- `workflows` → `voice_agents`
- `workflow_runs` → `voice_agent_runs`
- `workflow_definitions` → `voice_agent_definitions`

This is a major version of the SDK and the DB. Is it in scope?

If yes — happens around Phase 5/7. If no — UI says "Voice Agent" but internals stay `workflow`.

---

## High-value (decide before Phase 2)

### 6. NoralOS company → NoralVoice organization provisioning

When a new NoralOS company is created, should we **auto-provision** a NoralVoice org for it, or require manual setup?

- Auto: plugin reaches into NoralVoice's auth endpoint, creates an org, mints an API key, stores it. Magical onboarding.
- Manual: operator pastes a NoralVoice API key into `/company/settings/integrations`. More explicit, less magic.

Auto-provision requires NoralVoice to expose a "create org" endpoint that the plugin can call with a master credential — i.e. NoralOS holds a NoralVoice **superuser** key. Possible but introduces a powerful credential.

### 7. Conference Room — keep, embed, or replace?

NoralOS's Conference Room ([packages/plugins/conference-room-bridge/](../../packages/plugins/conference-room-bridge/)) is the in-NoralOS voice surface for talking to a NoralOS agent. Today it bridges to an external Pipecat instance.

Three trajectories:
1. **Keep as-is**, just point Pipecat at NoralVoice's WebRTC layer (Phase 6 minimal — what's planned)
2. **Embed NoralVoice's WebRTC widget** ([api/routes/public_embed.py](../../api/routes/public_embed.py)) inside the Conference Room page — NoralOS owns the page chrome; NoralVoice owns the audio plane
3. **Replace** entirely — NoralOS Conference Room URL redirects to `voice.noral.ai/embed/<token>`

(1) is the minimal change. (2) is cleaner UX but requires the iframe auth bridge from Phase 4. (3) is the boldest — abandons the NoralOS-side React UI for Conference Room.

### 8. Multi-head Alembic — was this intentional?

The three Alembic heads in NoralVoice ([overlap-map.md H-NV-2](overlap-map.md)) might be:
- Accidental (a missing merge migration) — fix in Phase 0
- Intentional (someone is using `alembic upgrade heads` deliberately to keep features separable) — leave alone

Worth verifying with whoever last ran a migration in prod (`voice.noral.ai` server, deploy `129.121.101.154`).

### 9. NoralVoice security flags — acceptable today?

Two security observations from the audit:

- **`agent_stream` WS has no auth** ([api/routes/agent_stream.py:31](../../api/routes/agent_stream.py)). Workflow UUID is the only identifier; UUIDs leak into the React-Flow JSON that users can export.
- **CORS `allow_origins=["*"]` + `allow_credentials=True`** ([api/app.py:88](../../api/app.py)). Most browsers reject this combo, but it shouldn't be in the config.

Are these:
- Acceptable for the OSS / local-dev mode and fixed only in `deploy/noral/`?
- Real bugs to fix in Phase 0?

---

## Medium-value (decide before Phase 4)

### 10. Iframe auth bridge — exchange-token or session-cookie cross-domain?

Phase 4 needs to authenticate the iframed NoralVoice UI as the NoralOS user. Two paths:

- **Exchange-token**: NoralOS plugin mints a token from NoralVoice (`POST /embed/exchange-token`), iframe opens `voice.noral.ai/embed-login?token=…`, NoralVoice sets a session cookie scoped to its own domain
- **Shared cookie domain** at `*.noral.ai` if both products live under the same parent — NoralOS session cookie is automatically sent to NoralVoice

Shared cookie requires both products to deploy under `*.noral.ai` (they do today: `agent.noral.ai` + `voice.noral.ai`). Cleaner but couples auth tightly.

### 11. Telephony — is `/telephony-configurations` exposed in NoralOS?

NoralVoice has 7 telephony providers ([overlap-map.md A7](overlap-map.md)) with per-org credentials, phone number management, and inbound-workflow binding. Should operators configure these:

- **Only in NoralVoice** at `/telephony-configurations` (status quo)
- **Mirrored read-only in NoralOS** plugin (operator sees what's configured but edits in NoralVoice)
- **Editable in NoralOS** with the plugin proxying writes

Read-only mirror is the minimum useful pass. Full edit-in-NoralOS is a big iframe candidate.

### 12. NoralOS Twilio plugin — kill or finish?

[packages/shared/src/integration-providers.ts:285-288](../../packages/shared/src/integration-providers.ts) references a `feat/twilio-plugin-foundation` branch. NoralVoice already has Twilio fully wired.

Recommendation: kill the NoralOS Twilio plugin branch; route telephony via NoralVoice. Confirm? (Or is the NoralOS Twilio plugin meant to do something different — SMS sending perhaps?)

### 13. Cost aggregation — single dashboard or two?

Both products have cost tracking ([overlap-map.md G1](overlap-map.md)):
- NoralVoice: `WorkflowRunModel.cost_info` + `organization_usage_cycles`
- NoralOS: `cost_events` + `finance_events` + budget windows

Phase 7 suggests merging into NoralOS Costs page. Confirm the target experience:
- One unified Costs page in NoralOS, NoralVoice cost data flows in via plugin?
- Side-by-side panels?
- NoralVoice deep-link for detail?

---

## Low-value (parking lot)

### 14. Should `voice-config`'s tier system promote to a first-class `agents.tier` column?

[overlap-map.md B3](overlap-map.md) notes voice-config derives `exec/manager/worker` from role, while NoralSign hardcodes a `{ceo,cto,cmo,cfo}` allowlist. Two ways to encode the same concept.

If many plugins will gate on tier, a column makes sense. If only voice and signature gate, keep derivations.

### 15. Brooklyn-the-CEO-agent vs Brooklyn-the-LLM-adapter

Recent commit `926a67a3` started disambiguating. Should we go further and rename the adapter to `noralai_llm` so "Brooklyn" only appears as the persona's name? Or is the adapter naming meaningful enough to keep (Anthropic ≠ Claude-the-product)?

### 16. Pipecat — where does it run?

The audit found Pipecat is bundled as a submodule in NoralVoice but `conference-room-bridge` expects it to be external. Today, is Pipecat:
- Running inside NoralVoice's Docker container as part of the api process?
- Running as a sidecar on the voice.noral.ai server?
- Running elsewhere?

Affects Phase 6 — if Pipecat is co-located with NoralVoice, the Conference Room media path redirect is mechanical. If separate, there's deployment work.

### 17. NoralSign cross-tenant webhook fan-out TODO

[packages/plugins/noralai-noralsign/src/worker.ts:567-572](../../packages/plugins/noralai-noralsign/src/worker.ts) defers cross-tenant event emit to "milestone 1D". Does this block the NoralVoice plugin?

Probably no — NoralVoice plugin webhooks can emit per-company directly using `companyResolution` from the API route. Confirm.

### 18. Embedded-Postgres vs remote-Postgres for dev

NoralOS supports `embedded-postgres@18.1.0-beta.16` for local dev. NoralVoice doesn't — it expects a remote DB URL via `DATABASE_URL`.

Question: should NoralVoice gain embedded-postgres support for dev parity? Or is `docker-compose-local.yaml` good enough?

### 19. Storybook & component library

NoralOS has Storybook 10.3.5 ([ui/package.json:54](../../ui/package.json)). NoralVoice doesn't. The two products use different design systems (shadcn/ui + Radix in both, but different tokens). Is there appetite to unify?

Low priority unless a shared design system becomes a goal.

### 20. Deploy: should NoralVoice run on the same VPS as NoralOS?

NoralOS runs at `agent.noral.ai` on `129.121.84.139`. NoralVoice's `deploy/noral/README.md` references `129.121.101.154` for `voice.noral.ai`. Two VPSes.

Question: is there a plan to consolidate to a single VPS / k8s cluster, or stay on two? Affects network-cost assumptions for plugin → NoralVoice round-trips.

---

## Open questions specifically about UI inspection

The audit was code-grounded. The user approved "code + screenshots from existing prod" for UI inspection. Screenshots were deferred because the code-level audit was sufficient for the deliverables. To close the loop:

### 21. Should a visual UI inspection pass happen now?

Specifically:
- Browse `agent.noral.ai` (NoralOS prod) — Dashboard, Integrations, Conference Room, Documents/NoralSign, Agent Detail
- Browse `voice.noral.ai` (NoralVoice prod) — Overview, Voice Agents list, Workflow editor, Campaigns, Files, the 5+ settings surfaces

If yes — add a `uiux-visual-notes.md` doc capturing rendered findings (especially anything the code audit missed: spacing, accessibility, microcopy issues, mobile rendering).
