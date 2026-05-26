---
name: noralvoice-author-workflow
description: >
  Author a NoralVoice voice workflow from a natural-language description.
  Use when a user asks you to create, modify, or publish a voice agent
  via the noralai.noralvoice plugin. Covers the full lifecycle: assemble
  a valid graph JSON, save it as a draft, self-check with
  `validate_workflow`, and promote to executable with `publish_workflow`.
---

# NoralVoice Author Workflow Skill

Use this skill when a user asks you to **create a voice agent**, **build a
phone workflow**, or **modify a NoralVoice workflow**. Reach end-to-end:
prompt → draft → validated → published → dialable from the user's
voice.noral.ai UI.

## Tools you will use

All under the `noralai.noralvoice` plugin:

| Tool | Purpose |
|---|---|
| `create_workflow` | Create a new workflow from a graph JSON. Returns numeric `id` + `workflow_uuid`. |
| `save_workflow` | Replace an existing workflow's graph (PUT). Returns updated record. |
| `validate_workflow` | Read-only — runs the publish-gate validator on the current draft, returns structured findings. **Always call before publish.** |
| `publish_workflow` | Promote the current draft to a published version that the runtime executes. **Requires manager-tier.** |
| `list_workflows` | List existing workflows in the user's organization. |
| `set_agent_voice` | Pick a TTS voice (optional, after publish). |
| `assign_phone_number_to_workflow` | Wire a phone number (for inbound) or use `run_call` (for outbound). |

## The authoring loop

```
1. clarify intent              → ask what the agent should do
2. assemble graph JSON         → see references/schema-reference.md
3. create_workflow(name, def)  → draft created
4. validate_workflow(id)       → read findings; loop back to 2 if errors
5. publish_workflow(id)        → executable
6. confirm to user             → "Created and published 'X' (id=N)"
```

**Never skip step 4.** The validator catches schema and graph errors
that publish would also throw — but as structured findings you can act
on, not as a 422 stack trace.

## Schema reference

See [`references/schema-reference.md`](references/schema-reference.md) for:

- Node types: `startCall`, `agentNode`, `endCall`, `globalNode`, `trigger`, `webhook`, `qa`
- Required fields per node type (especially `prompt` for `startCall`/`agentNode`/`endCall`/`globalNode`)
- Edge shape: `{ id, source, target, data: { label, condition } }`
- `model_overrides` schema (when present in `workflow_configurations`)
- Trigger-path uniqueness rules
- Referential integrity rules (edges must reference existing node IDs)

## Worked examples

Three canonical shapes — copy and adapt rather than building from
scratch. Each is a complete, valid graph that publishes cleanly:

- [`references/examples/intake-bot.json`](references/examples/intake-bot.json) — single-agent intake form: greet → ask 3-5 questions → confirm → end.
- [`references/examples/callback-agent.json`](references/examples/callback-agent.json) — schedule callback: ask name + best time → confirm → end.
- [`references/examples/support-transfer.json`](references/examples/support-transfer.json) — triage + transfer: greet → triage (agent) → either resolve or transfer to human.

## When the user's intent is ambiguous

Before assembling a graph, confirm:

1. **Inbound or outbound?** Inbound needs a `startCall` node; outbound is dialed via `run_call` after publish.
2. **What does the agent ask the caller?** Translates directly into the `startCall` and `agentNode` prompts.
3. **What ends the call?** Successful capture? Hang up? Transfer to human?
4. **Variables to extract?** (name, email, intent, etc.) — drives `extraction_variables` on the relevant node.
5. **Voice provider preference?** Optional; can call `set_agent_voice` after publish.

Don't ask all five upfront — pick the one or two that most disambiguate
the user's request, then refine after the first draft.

## Common validation errors and fixes

| Error | Fix |
|---|---|
| `Prompt is required for {agent/start/end/global} nodes` | The `data.prompt` field is missing or empty. Every prompted node needs a non-empty prompt string. |
| `edges.<i>.source/target does not refer to a node` | Edge references a node id that isn't in `nodes`. Re-check ids after any rename. |
| `label`/`condition` is required on edge data | Every edge needs a human-readable `label` and a `condition` that the agent evaluates. Use `"always"` for unconditional transitions. |
| Trigger conflict / duplicate `trigger_path` | Two trigger nodes can't share a path. Auto-mint or use a distinct path per inbound entry. |

## After publishing

Confirm to the user with both the workflow name AND the dialable
artifact. If you assigned a phone number, mention it. If you didn't,
remind them they can place an outbound test via `run_call` or attach a
number via the voice.noral.ai UI.

Example confirmation:
> Created and published **"ACME callback agent"** (id=42, version=1).
> It's now dialable. To test it: open voice.noral.ai → workflow #42 →
> "Test Call", or ask me to place an outbound call to a specific number.

## Permissions

- `create_workflow`, `save_workflow`, `publish_workflow`,
  `set_agent_voice`, `assign_phone_number_to_workflow`,
  `run_call` — all require **manager** tier or above.
- `validate_workflow`, `list_workflows`, `list_voices` — **worker** tier or above.

If you don't have manager tier, ask your CEO or board to either escalate
or have a manager-tier agent (e.g. a Voice Director) handle the publish.
