# Template catalog & worked example

Reference for [the `noralvoice-build-from-template` skill](../SKILL.md).
Keep parameter names exact — `apply_workflow_parameters` rejects anything a
template doesn't declare.

## `outbound_lead_qualifier`

**What it does:** dials a lead, opens with a short intro, has a natural
conversation to understand need / budget / timeline, then wraps up. The
call extracts four structured fields automatically: `need`, `budget`,
`timeline`, `wants_followup`.

**Graph shape (for your mental model — you do not edit this):**

```
start (greet)  ──"Begin qualifying"──▶  qualify (agentNode)  ──"Wrap up"──▶  end
```

**What it does NOT do:** it does not transfer to a human and does not book a
calendar slot. There is no transfer or booking parameter. If the owner needs
either, that is a *new template*, not a parameter — see
[When no template fits](#when-no-template-fits).

### Named parameters (fillPoints)

| Key | Required | What it sets | Notes |
|---|:---:|---|---|
| `openingLine` | ✅ | The first thing the agent says when the call connects (the greeting). | Keep it short and human. Include who's calling and why. |
| `agentSystemPrompt` | ✅ | The instructions that drive the qualifying conversation — persona, goals, how to handle objections. | This is the heart of the agent. Be specific about what "qualified" means for this owner. |
| `qualifyingQuestions` | ⬜ optional | What the agent should find out — the extraction instructions. | Changes *how* the four fields are gathered in conversation; it does not change *which* fields are extracted (those are fixed: need, budget, timeline, wants_followup). |

Everything else — voice, caller id, the phone number, telephony — is set
through the dedicated tools (`set_agent_voice`,
`assign_phone_number_to_workflow`), never through `apply_workflow_parameters`.

## End-to-end worked example

Spec (already elicited and confirmed with the owner):

> Call new leads from the "May leads" Google Sheet for ACME Roofing. Friendly
> SDR persona, English. Goal: qualify on budget + timeline. Qualified =
> homeowner with a roof project in the next 90 days and a budget over $5k.
> Dial from ACME's main line, 8am–9pm local, max 5 concurrent. Results to the
> owner's call log; notify the owner on each qualified lead.

**1 — Provision from the template** (one-shot per agent):

```
provision_voice_agent({
  noralosAgentId: "a1b2c3d4-…",            // the NoralOS agent that will own this voice workflow
  template: "outbound_lead_qualifier",
  displayName: "ACME outbound lead qualifier"
})
→ { voice_agent_uuid: "wf_9f8e…", workflow_name: "ACME outbound lead qualifier", workflow_id: 42 }
```

Keep **both** ids: `workflow_id` (42, numeric) and `voice_agent_uuid`
(`wf_9f8e…`, string). You need each for different tools.

**2 — Fill the named parameters** (numeric `workflowId`):

```
apply_workflow_parameters({
  workflowId: 42,
  templateSlug: "outbound_lead_qualifier",
  parameters: {
    openingLine: "Hi, this is Sam from ACME Roofing — do you have a quick minute?",
    agentSystemPrompt:
      "You are a friendly ACME Roofing SDR. Confirm you're speaking with the homeowner, then have a natural conversation to learn whether they have a roof project, their rough budget, and their timeline. A lead is qualified when they own the home, have a project in the next 90 days, and a budget over $5,000. Ask one question at a time. If they're not interested, thank them warmly and wrap up.",
    qualifyingQuestions:
      "Find out: do they own the home; what roof work they need; their rough budget; and how soon they want it done."
  }
})
→ { applied: ["openingLine", "agentSystemPrompt", "qualifyingQuestions"] }
```

**3 — (optional) Set the voice:**

```
list_voices({ provider: "elevenlabs" })            // pick a voiceId
set_agent_voice({ noralosAgentId: "a1b2c3d4-…", provider: "elevenlabs", voiceId: "<id>" })
```

**4 — Validate** (never skip):

```
validate_workflow({ workflowId: 42 })  → { valid: true, errors: [] }
```

If `valid: false`, read the findings, fix the offending parameter (a common
one is an empty `openingLine`/`agentSystemPrompt`), and re-validate.

**5 — Preview to the owner**, in plain language: the opening line, what the
agent asks, what counts as qualified, what happens on no-answer, the number
it dials from, the 8am–9pm window, and the concurrency cap. Get a "yes".

**6 — Test call to the owner's own phone** (uuid + E.164):

```
run_call({
  workflowUuid: "wf_9f8e…",
  toNumber: "+15555550123",                 // the OWNER's phone
  variables: { lead_name: "Test Owner" }    // optional context injected into the call
})
→ { runId: "run_… ", status: "queued" }
```

Then `get_run({ runId })` to confirm it connected and review the transcript.

**7 — Arm, only on explicit approval** of both the preview and the test call:

```
publish_workflow({ workflowId: 42 })
```

Then run live — either one lead at a time:

```
run_call({ workflowUuid: "wf_9f8e…", toNumber: "+1…", variables: { lead_name: "…" } })
```

…or as a batch campaign from the sheet (numeric `workflowId`):

```
create_campaign({
  name: "ACME May leads",
  workflowId: 42,
  sourceType: "google-sheet",
  sourceId: "<google-sheet-id>",
  maxConcurrency: 5
})
→ { campaignId: 11, status: "pending" }     // created paused
start_campaign({ campaignId: 11 })          // begins dialing
```

**8 — Monitor:** `get_campaign({ campaignId: 11 })` for progress,
`list_runs({ workflowUuid: "wf_9f8e…" })` for individual calls,
`get_daily_report()` for the daily rollup. Notify the owner on qualified
leads as agreed; escalate anything needing executive judgment to the CEO.

## When no template fits

The shipped template qualifies and wraps up. The moment a request needs
something it can't express — a warm transfer, a calendar booking, a payment
capture, a multi-branch triage — **stop**. You don't have a tool to build
that, and you must not improvise a raw graph.

Instead:

1. Tell the owner plainly which part no current template supports.
2. Recommend they build that flow **once** in the NoralVoice editor and get it
   passing the publish validator.
3. A maintainer then captures it into a permanent seed template
   (`scripts/capture-voice-template.ts` snapshots a hand-built workflow into a
   `src/templates/<slug>.ts` module with declared parameters). After it ships,
   it appears as a new slug you can provision from — exactly like
   `outbound_lead_qualifier`.

Your job is to recognise the gap and route it, not to fill it with a graph.
That's what keeps every voice agent you stand up reliable.
