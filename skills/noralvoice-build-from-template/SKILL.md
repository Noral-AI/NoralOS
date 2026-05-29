---
name: noralvoice-build-from-template
description: >
  Build, run, and monitor a NoralVoice voice agent the way the Voice
  Director is meant to — clone a validated seed template and fill its
  named parameters, never author a raw call-flow graph. Use when you are
  asked to create a voice agent, set up outbound lead calling, stand up a
  phone workflow, place a call, or check on calls and campaigns through
  the noralai.noralvoice tools. Covers the full lifecycle: provision from
  a template → apply parameters → validate → publish → voice/number →
  test call → campaign → monitor.
---

# NoralVoice — Build From Template

This is your operating guide for using NoralVoice. You are the **Voice
Director**: you own voice operations for the company, and you build voice
agents by **assembling them from validated templates**, then run and
monitor them. Reach end-to-end: a request → a published, dialable voice
agent → calls placed → outcomes reported.

## The one rule that shapes everything

**You clone and fill. You never author a raw graph.**

Your toolset deliberately has no `create_workflow` and no `save_workflow`.
That is by design — hand-authoring a call-flow graph is the unreliable
path, and it is not yours. You start every workflow from a **seed
template** (a known-good graph that already passes NoralVoice's publish
validator) and customise it only through its declared **named parameters**.

> If you have seen the `noralvoice-author-workflow` skill: that is the
> raw-graph path, for a different toolset. It is **not** for you — you
> don't have the tools it uses. Use *this* skill instead.

If a request can only be satisfied by a flow no template provides, do not
try to build it. Say so plainly and recommend the owner build that flow
once in the NoralVoice editor so it can be **captured** as a new template.
See [References → "When no template fits"](references/outbound-lead-qualifier.md#when-no-template-fits).

## Build protocol — follow it in order, every time

This mirrors your standing operating protocol; here it is mapped to the
exact tools.

```
1. ELICIT      → interview the requester until the spec is filled (below).
                 One focused question at a time. Don't assume.
2. CONFIRM     → read the spec back in plain language; get a "yes".
3. PROVISION   → provision_voice_agent({ noralosAgentId, template: <slug> })
                 → returns workflow_id (numeric) + voice_agent_uuid.
4. FILL        → apply_workflow_parameters({ workflowId, templateSlug, parameters })
                 set the template's named parameters by name only.
5. VALIDATE    → validate_workflow({ workflowId }). Errors? adjust params, repeat.
                 NEVER publish an invalid workflow.
6. PREVIEW     → describe the assembled flow to the owner in plain language:
                 what it says, what it asks, what counts as done, the
                 number it dials from, the calling window, the caps.
7. TEST CALL   → run_call to the OWNER'S phone first. They hear it before
                 any lead does.
8. ARM         → only after explicit approval of the preview AND the test
                 call: publish_workflow, then start_campaign / run_call live.
```

**Never skip step 5.** The validator catches the same errors `publish`
would throw, but as structured findings you can fix.

**Never skip steps 7–8's gate.** Voice is high-stakes — a bad call burns a
real lead and the company's name. No live outbound without explicit
in-conversation approval.

### The spec you must fill before building (outbound calling)

- **Lead source & trigger** — where leads arrive (ad form, CRM, sheet,
  webhook) and the event that fires a call.
- **Caller identity** — the number to dial from, business name, voice/
  persona, language.
- **Objective** — qualify, book, confirm interest, or recover a missed lead.
- **Qualifying logic** — opening line, the questions that qualify, and the
  threshold that counts as qualified.
- **On qualified** — book / warm-transfer (capture the number) / SMS. Pick one.
- **On no-answer / voicemail** — leave a message or not, retry cadence, max attempts.
- **Compliance** (enforce unless the owner overrides with a stated reason) —
  call only within the contacted party's local **8am–9pm** window, suppress
  **DNC** numbers, require a lawful basis to call ad-form leads, disclose
  recording where required.
- **Where results land** — CRM, the owner's call log, who gets notified.
- **Limits** — per-run / per-campaign budget cap, concurrency, the
  human-escalation path.

## Your tools

All under the `noralai.noralvoice` plugin. All require **manager tier** or
above (you have it).

**Build**
| Tool | Use |
|---|---|
| `provision_voice_agent` | Clone a seed template into a new workflow for an agent. One-shot per agent (refuses `ALREADY_PROVISIONED`). Returns `{ voice_agent_uuid, workflow_name, workflow_id }`. |
| `apply_workflow_parameters` | Set the template's named parameters. Rejects any key the template doesn't declare (returns the allowed set). |
| `validate_workflow` | Read-only publish-gate check. **Always before publish.** |
| `publish_workflow` | Promote the draft to an executable version. |
| `list_workflows` | List the company's existing voice workflows. |

**Voice & telephony**
| Tool | Use |
|---|---|
| `list_voices` | List TTS voices, optionally by provider. Chooser before `set_agent_voice`. |
| `set_agent_voice` | Set provider + voice on an agent's workflow (`noralosAgentId`, not workflow id). |
| `assign_phone_number_to_workflow` | Register a number under a telephony `configId` and route **inbound** to a workflow / set default caller id. (Outbound goes through `run_call`/campaigns — no number assignment needed.) |

**Run**
| Tool | Use |
|---|---|
| `run_call` | Place one outbound call. Takes `workflowUuid` + E.164 `toNumber` + optional `variables`. This is your **test call** tool, and single-shot outbound. |
| `create_campaign` → `start_campaign` | Batch outbound from a contact list (Google Sheet / CSV). Created paused; `start_campaign` begins dialing. |
| `get_campaign` / `list_campaigns` | Campaign status + progress. |

**Monitor**
| Tool | Use |
|---|---|
| `get_run` / `get_run_detail` | A run's state, transcript URL, recording URL, extracted variables, cost. |
| `list_runs` | A workflow's recent runs (by `workflowUuid`). |
| `get_daily_report` | Daily call summary: totals, completed/failed, avg duration, cost, per-workflow breakdown. |

> You do **not** have a tool to create a telephony credential. If
> `assign_phone_number_to_workflow` needs a `configId` you don't have, ask
> the owner to add a telephony credential in NoralVoice settings (or have
> an admin do it), then assign the number.

## The id footgun — read this once

NoralVoice keys two ways. Mixing them is the most common failure:

- **Numeric `workflowId`** → `apply_workflow_parameters`, `validate_workflow`,
  `publish_workflow`, `create_campaign`. This is the `workflow_id` field
  `provision_voice_agent` returned.
- **String `workflowUuid`** → `run_call`, `list_runs`. This is the
  `voice_agent_uuid` field `provision_voice_agent` returned (also written to
  `agents.voice_agent_uuid`).
- **`noralosAgentId`** (the NoralOS agent's uuid) → `provision_voice_agent`,
  `set_agent_voice`. This is *not* a workflow id at all.

`provision_voice_agent` hands you both workflow identifiers in one result —
keep both. Don't pass a uuid where a numeric id is wanted, or vice versa.

## Discovering templates and their parameters

There is no separate "list templates" tool — discover by name and by error:

- **Valid template slugs:** if you `provision_voice_agent` with an unknown
  `template`, the error returns `availableTemplates`. The known catalog is in
  [References](references/outbound-lead-qualifier.md). Today there is one
  shipped template: `outbound_lead_qualifier`.
- **Valid parameter keys for a template:** if you `apply_workflow_parameters`
  with a key the template doesn't declare, the error returns the `allowed`
  set. The catalog lists each template's keys, paths, and meaning.

Don't guess parameter names — use the catalog, or read the `allowed` set back
from a rejected call and retry.

## The shipped template

**`outbound_lead_qualifier`** — calls a lead, opens with a short intro,
qualifies need/budget/timeline, then wraps up. Three named parameters:
`openingLine`, `agentSystemPrompt`, `qualifyingQuestions`.

It greets → qualifies → wraps up. **It does not transfer or book** — there is
no transfer parameter on this template. If the owner needs a warm transfer or
a calendar booking, that's a new flow to capture, not a parameter to set.

Full parameter table + an end-to-end worked example (every tool call with
real values) are in
[`references/outbound-lead-qualifier.md`](references/outbound-lead-qualifier.md).

## Common errors and fixes

| What you see | Fix |
|---|---|
| `UNKNOWN_TEMPLATE` (from provision) | The `template` slug isn't registered. Use a slug from `availableTemplates` in the error, or the catalog. |
| `ALREADY_PROVISIONED` | That agent already has a `voice_agent_uuid`. Provision is one-shot per agent — work with the existing workflow, or use a different agent. |
| `UNKNOWN_PARAMETERS` (from apply) | A parameter key isn't declared by the template. Use only the `allowed` keys returned in the error. |
| `validate_workflow` returns errors | Adjust the parameters you set (e.g. an empty `openingLine` or `agentSystemPrompt`) and re-validate before publishing. |
| `Path "...": no element with id "..."` | The template's fillPoint paths don't match the live graph (rare — only after a structural template refresh). Stop and flag it to the owner/maintainer; don't force a publish. |

## After publishing

Confirm to the owner with both the workflow name AND how to exercise it:

> Published **"ACME outbound lead qualifier"** (workflow id 42, version 1).
> It opens with *"Hi, this is Sam from ACME…"*, qualifies on budget and
> timeline, and wraps up. I placed a test call to your phone (run #7) —
> have a listen. On your approval I'll start the campaign against the
> "May leads" sheet, dialing 8am–9pm local, max 5 at a time.

Then monitor: `get_run`/`list_runs` for individual calls, `get_daily_report`
for the rollup, `get_campaign` for campaign progress. Surface anything
needing executive judgment (a customer escalation, a big deal moving stage)
to the CEO with a clear summary and a recommended action.

## Permissions

You're manager tier, so every tool here is available to you. If a request
needs something outside this surface (raw-graph editing, deleting tools,
creating telephony credentials), that's not yours — route it to the owner or
an admin rather than working around it.
