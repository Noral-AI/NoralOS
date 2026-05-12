/**
 * Twilio plugin manifest.
 *
 * Declares a single agent tool — `send_sms` — that posts to the Twilio
 * Messages API on behalf of the calling agent. The tool's parameters
 * schema is the contract the host hands to the LLM; everything an
 * agent can pass must be representable here.
 *
 * Credentials and `from` number come from the company's `integration_credentials`
 * row (provider `twilio`) once the operator wires it up. PR 2 ships
 * only the plugin manifest + worker shell; PR 2b registers the plugin
 * in the host DB and resolves the credential at tool-invocation time.
 */

import type { NoralosPluginManifestV1 } from "@noralos/shared";

import { PLUGIN_ID, PLUGIN_VERSION, SEND_SMS_TOOL_NAME, TWILIO_MAX_BODY_CHARS } from "./constants.js";

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Twilio SMS",
  description:
    "Lets agents send outbound SMS messages through a per-company Twilio account. Subject to admin approval policies; credentials are stored as encrypted integration credentials and resolved on every invocation, never embedded in agent state.",
  author: "NoralOS",
  categories: ["connector"],

  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "activity.log.write",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
  },

  tools: [
    {
      name: SEND_SMS_TOOL_NAME,
      displayName: "Send SMS",
      description:
        "Send an SMS message to a phone number via the company's Twilio account. Use only when the user has explicitly asked for an SMS to be sent and you have the recipient's E.164 number. The message is subject to admin approval and rate limits.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["to", "body"],
        properties: {
          to: {
            type: "string",
            description:
              "Recipient phone number in E.164 format, including the leading `+` and country code (e.g. `+15551234567`). Twilio rejects national or local formats.",
            pattern: "^\\+[1-9]\\d{1,14}$",
          },
          body: {
            type: "string",
            description:
              "Plain-text message body. UTF-8 is supported; emoji and non-ASCII characters count as multiple segments and may increase per-message cost.",
            minLength: 1,
            maxLength: TWILIO_MAX_BODY_CHARS,
          },
          from: {
            type: "string",
            description:
              "Optional override of the company's default sender number. Must be an E.164 number bound to the same Twilio account. Most agents should omit this and let the company default apply.",
            pattern: "^\\+[1-9]\\d{1,14}$",
          },
        },
      },
    },
  ],
};
