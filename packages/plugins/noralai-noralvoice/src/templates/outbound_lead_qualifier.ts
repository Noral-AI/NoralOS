/**
 * Seed template: outbound lead qualifier.
 *
 * A known-good NoralVoice ReactFlow definition the host clones verbatim
 * when an agent provisions a voice agent with this slug. The graph is a
 * straight three-node flow — greet → qualify → wrap up — that already
 * passes NoralVoice's publish validator (every prompted node has a
 * non-empty `prompt`; every edge carries a non-empty `label`/`condition`).
 *
 * The agent customises it through `apply_workflow_parameters`, which only
 * writes the declared `fillPoints` below. Everything else (voice, caller
 * id, transfers, telephony) is set through the existing dedicated tools —
 * this module never exposes raw-graph authoring.
 */

import type { VoiceTemplate } from "./index.js";

export const outboundLeadQualifier: VoiceTemplate = {
  slug: "outbound_lead_qualifier",
  displayName: "Outbound Lead Qualifier",
  description:
    "Calls a lead, opens with a short intro, qualifies need/budget/timeline, then wraps up. Customise the opening line, the qualifying instructions, and what to extract.",
  definition: {
    nodes: [
      {
        id: "start",
        type: "startCall",
        position: { x: 0, y: 0 },
        data: {
          name: "Call Start",
          is_start: true,
          allow_interrupt: true,
          greeting: "Hi, this is your assistant calling — do you have a quick minute?",
          greeting_type: "text",
          prompt:
            "Open the call warmly. Confirm you are speaking with the right person before moving on.",
        },
      },
      {
        id: "qualify",
        type: "agentNode",
        position: { x: 320, y: 0 },
        data: {
          name: "Qualify Lead",
          allow_interrupt: true,
          prompt:
            "You are a friendly sales development rep. Have a natural conversation to understand the lead's need, rough budget, and timeline. Ask one question at a time and listen. If the lead is not interested, thank them and move to wrap up.",
          extraction_enabled: true,
          extraction_prompt:
            "Capture the lead's stated need, budget range, decision timeline, and whether they want a follow-up.",
          extraction_variables: [
            { name: "need", type: "string", prompt: "What does the lead need?" },
            { name: "budget", type: "string", prompt: "What budget did the lead mention?" },
            { name: "timeline", type: "string", prompt: "What is the lead's timeline?" },
            {
              name: "wants_followup",
              type: "boolean",
              prompt: "Does the lead want a follow-up?",
            },
          ],
        },
      },
      {
        id: "end",
        type: "endCall",
        position: { x: 640, y: 0 },
        data: {
          name: "Wrap Up",
          is_end: true,
          prompt:
            "Thank the lead for their time, confirm any agreed next steps, and end the call politely.",
        },
      },
    ],
    edges: [
      {
        id: "start-qualify",
        source: "start",
        target: "qualify",
        data: {
          label: "Begin qualifying",
          condition: "The person confirmed they have a moment to talk.",
        },
      },
      {
        id: "qualify-end",
        source: "qualify",
        target: "end",
        data: {
          label: "Wrap up",
          condition: "Qualification is complete or the lead is not interested.",
        },
      },
    ],
  },
  fillPoints: [
    {
      key: "openingLine",
      path: "nodes.#start.data.greeting",
      description: "First thing the agent says when the call connects.",
      required: true,
    },
    {
      key: "agentSystemPrompt",
      path: "nodes.#qualify.data.prompt",
      description:
        "Instructions that drive the qualifying conversation (persona, goals, how to handle objections).",
      required: true,
    },
    {
      key: "qualifyingQuestions",
      path: "nodes.#qualify.data.extraction_prompt",
      description:
        "What the agent should find out from the lead — used to extract structured fields from the call.",
      required: false,
    },
  ],
};

export default outboundLeadQualifier;
