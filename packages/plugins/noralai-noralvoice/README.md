# @noralos-plugins/noralai-noralvoice

NoralVoice integration for NoralOS. Wraps `voice.noral.ai`'s public REST API behind a NoralOS-branded plugin surface:

- **Agent tools** — three starter tools (`list_workflows`, `run_call`, `get_run`) for the Voice Director template to manage voice agents, place outbound calls, and review outcomes.
- **Tier gate** — `run_call` is restricted to `manager` tier and above. Worker-tier agents are blocked with a clean error pointing at the Voice Director.
- **Webhook receiver** — receives NoralVoice's `run.completed` events (signed with HMAC-SHA256), republishes on the NoralOS event bus so the originating agent wakes within 5 seconds.
- **Voice Director template** — auto-registered manager-tier agent template that owns voice ops for the company.
- **Plugin page** — under `/<companyPrefix>/voice`. Three states: configure-me, create-first-Voice-Director, list-Voice-Directors.

## Configuration

The plugin's `instanceConfig` is a small shape with three fields:

```jsonc
{
  "baseUrl": "https://voice.noral.ai",  // NoralVoice deployment
  "apiKeyRef": "company-secret:<id>",   // X-API-Key for that org
  "organizationId": 42                  // NoralVoice org id this company maps to
}
```

`apiKeyRef` is an encrypted secret ref (Phase 2 wires the assignment from `/company/settings/integrations`). The plugin resolves the secret via `ctx.secrets.resolve()` on each tool call; never cached in worker memory.

## Phases 1B → 2 → 3 → 4 …

This is the Phase 1B scaffold. Phase 2 adds the credential UI assignment. Phase 3 layers voice-settings unification. Phase 4 adds the iframed workflow builder + Costs merge. See `docs/audit/consolidation-plan.md` in the canonical repo.
