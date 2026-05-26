# NoralVoice workflow graph schema reference

This is the source-of-truth schema for the `workflow_definition` field
passed to `create_workflow` / `save_workflow`. Drawn from
NoralVoice's `api/services/workflow/dto.py` (`ReactFlowDTO`).

## Top-level shape

```json
{
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

- `nodes`: list of `RFNode` (see below). Order doesn't matter.
- `edges`: list of `RFEdge`. Each edge connects two nodes by `id`.

Both must validate clean before publish. The validator checks:

1. Every per-node-type schema (prompts, fields).
2. Referential integrity: every `edge.source` / `edge.target` must
   match a `node.id` in `nodes`.
3. Trigger-path uniqueness (no two trigger nodes share a `trigger_path`).
4. Edge `data.label` and `data.condition` are required, non-empty.

## Node base shape

Every node:

```json
{
  "id": "string-unique-within-graph",
  "type": "<one of: startCall|agentNode|endCall|globalNode|trigger|webhook|qa>",
  "position": { "x": 0, "y": 0 },
  "data": { ... }
}
```

`position` is required by the React Flow renderer but has no runtime
semantics — any `{ x, y }` is fine for agent-authored workflows. Use
`{x: 0, y: 0}` if you don't care.

## Node types

### `startCall`

The first node a caller hits on inbound. Required for inbound
workflows. The greeting is what plays before the first agent turn.

```json
{
  "id": "start-1",
  "type": "startCall",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Greeting",
    "prompt": "You are a helpful intake agent. Greet the caller and ask how you can help.",
    "is_start": true,
    "greeting": "Hi there, thanks for calling.",
    "greeting_type": "text",
    "wait_for_user_response": false,
    "detect_voicemail": false,
    "allow_interrupt": false,
    "add_global_prompt": true
  }
}
```

Required: `name`, `prompt` (non-empty). `is_start: true` is required.
All other fields default. `greeting` is what plays before the agent
takes the first turn (use `null` to start with the prompt instead).

### `agentNode`

A conversational turn. Multiple agent nodes form a directed flow.

```json
{
  "id": "agent-triage",
  "type": "agentNode",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Triage",
    "prompt": "Find out whether the caller wants billing, technical support, or something else.",
    "extraction_enabled": true,
    "extraction_prompt": "Capture the caller's intent in one word.",
    "extraction_variables": [
      { "name": "intent", "type": "string", "prompt": "billing / tech / other" }
    ],
    "allow_interrupt": true
  }
}
```

Required: `name`, `prompt`. `extraction_*` and `tool_uuids` /
`document_uuids` are optional.

### `endCall`

Terminates the conversation. The prompt is what the agent says before
hanging up. Every reachable path must lead to an `endCall` or a
`transfer` (via webhook).

```json
{
  "id": "end-thanks",
  "type": "endCall",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Wrap up",
    "prompt": "Thank the caller and let them know we'll follow up shortly.",
    "is_end": true
  }
}
```

Required: `name`, `prompt`. `is_end: true` is required.

### `globalNode`

A prompt that applies across the whole workflow — runtime injects it
into every agent turn unless `add_global_prompt: false` on that node.
Use for company-wide tone or compliance instructions.

```json
{
  "id": "global-tone",
  "type": "globalNode",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Brand voice",
    "prompt": "Speak warmly, in second person, and never make claims about products you don't know.",
    "add_global_prompt": true
  }
}
```

### `trigger`

Inbound entry point with a stable URL path. Used by external systems
(webhooks, IVRs) that want to enter the workflow at a specific step.

```json
{
  "id": "trigger-callback",
  "type": "trigger",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Callback from web form",
    "trigger_path": "callback-from-web",
    "enabled": true
  }
}
```

`trigger_path` must be unique across all workflows in the org. Leave
unset and the API auto-mints one on save.

### `webhook`

Outbound HTTP call mid-conversation. Use for "look up customer by
phone number" or "create ticket in Zendesk" type integrations.

```json
{
  "id": "webhook-customer-lookup",
  "type": "webhook",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Customer lookup",
    "enabled": true,
    "http_method": "GET",
    "endpoint_url": "https://api.example.com/customers/{{caller_phone}}",
    "credential_uuid": "<optional secret ref>",
    "custom_headers": [
      { "key": "X-API-Version", "value": "2024-01" }
    ]
  }
}
```

### `qa`

Post-call quality assurance scoring. Doesn't affect the runtime
conversation — runs after the call ends.

```json
{
  "id": "qa-1",
  "type": "qa",
  "position": { "x": 0, "y": 0 },
  "data": {
    "name": "Compliance check",
    "qa_enabled": true,
    "qa_use_workflow_llm": true,
    "qa_system_prompt": "Score whether the agent disclosed the call was recorded.",
    "qa_min_call_duration": 15,
    "qa_voicemail_calls": false,
    "qa_sample_rate": 100
  }
}
```

## Edge shape

```json
{
  "id": "e1",
  "source": "start-1",
  "target": "agent-triage",
  "data": {
    "label": "After greeting",
    "condition": "always"
  }
}
```

Required: `id` (unique), `source`, `target`, `data.label`,
`data.condition`. The `condition` is what the runtime evaluates to
decide which outgoing edge to take. Common values:

- `"always"` — unconditional transition (single outgoing edge or
  fallback edge).
- `"user wants billing"` — natural-language condition the agent
  evaluates after the source node completes.
- `"caller said yes"` / `"caller said no"` — branching on simple intent.

You can also add `transition_speech` to have the agent say something
specific during the transition (e.g. "Connecting you to billing now").

## `workflow_configurations` (optional sibling to `workflow_definition`)

The PUT save / publish endpoints accept a second field at the top
level (not inside the graph):

```json
{
  "workflow_definition": { "nodes": [...], "edges": [...] },
  "workflow_configurations": {
    "model_overrides": {
      "llm": { "provider": "google", "model": "gemini-2.5-flash" },
      "stt": { "provider": "deepgram", "model": "nova-3" },
      "tts": { "provider": "elevenlabs", "voice": "<voice-id>" }
    }
  }
}
```

`model_overrides` is validated against the user's configured providers
on every save AND on publish. Leave it out unless the user explicitly
asks for a specific model — the workflow inherits the user's defaults
when omitted.

## Validation rules quick-reference

| Rule | Consequence if violated |
|---|---|
| Every prompted node has non-empty `data.prompt` | Validator returns `Prompt is required for {type} nodes` |
| Edge endpoints reference existing node ids | Validator returns `does not refer to a node` |
| Edge `data.label` and `data.condition` non-empty | Validator returns `String should have at least 1 character` |
| `trigger_path` unique across workflows | 409 conflict at save/publish |
| `model_overrides.llm/stt/tts` provider has active credential | Validator returns provider-specific error |

## Minimal valid graph

The smallest workflow that publishes cleanly: one start node, one
end node, one edge.

```json
{
  "nodes": [
    {
      "id": "start-1",
      "type": "startCall",
      "position": { "x": 0, "y": 0 },
      "data": {
        "name": "Greet",
        "prompt": "Greet the caller warmly and ask how you can help.",
        "is_start": true,
        "greeting": "Hi, how can I help you today?",
        "greeting_type": "text"
      }
    },
    {
      "id": "end-1",
      "type": "endCall",
      "position": { "x": 0, "y": 200 },
      "data": {
        "name": "Wrap up",
        "prompt": "Thank the caller and end the conversation politely.",
        "is_end": true
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "start-1",
      "target": "end-1",
      "data": { "label": "After greeting", "condition": "always" }
    }
  ]
}
```

This is a one-turn agent — useful as a smoke test that the auth bridge
and publishing flow work end-to-end. Real workflows need at least one
`agentNode` between start and end.
