/**
 * `noralvoice:add_telephony_credential` tool handler.
 *
 * High-stakes: creates a telephony provider configuration with a real
 * credential (e.g. Twilio account_sid + auth_token). Tier gate (manager+)
 * is enforced in `worker.ts` BEFORE this handler runs.
 *
 * Secret-handling contract: the agent passes credentials in via the
 * `credentials` param. NoralVoice masks sensitive fields in its response
 * (server-side `_mask_sensitive` keyed on the provider's UI registry),
 * so the `credentialsMasked` we surface to the agent is safe to log.
 *
 * The raw secret the agent sent is NEVER echoed back in the result — only
 * the masked version from NV's response. This means a stray transcript
 * dump still leaks the input the agent typed, but it does NOT amplify
 * the leak by repeating the secret in the tool's structured output.
 */

import {
  createTelephonyConfig,
  type NoralVoiceClientConfig,
  type NoralVoiceTelephonyProvider,
} from "../noralvoice-client.js";

export interface AddTelephonyCredentialParams {
  name: string;
  provider: NoralVoiceTelephonyProvider;
  credentials: Record<string, string>;
  isDefaultOutbound?: boolean;
}

export interface AddTelephonyCredentialResult {
  content: string;
  data: {
    configId: number;
    name: string;
    provider: string;
    isDefaultOutbound: boolean;
    /**
     * The provider credential fields with sensitive values masked by NV
     * server-side. Display-only — never the raw secret the agent passed.
     */
    credentialsMasked: Record<string, unknown>;
  };
}

export async function executeAddTelephonyCredential(
  config: NoralVoiceClientConfig,
  params: AddTelephonyCredentialParams,
): Promise<AddTelephonyCredentialResult> {
  const detail = await createTelephonyConfig(config, params);
  return {
    content:
      `Saved ${detail.provider} telephony credential "${detail.name}" ` +
      `(config_id ${detail.id})${detail.isDefaultOutbound ? " as the default outbound" : ""}. ` +
      `The credential's sensitive fields are stored encrypted in NoralVoice; only masked previews are returned here.`,
    data: {
      configId: detail.id,
      name: detail.name,
      provider: detail.provider,
      isDefaultOutbound: detail.isDefaultOutbound,
      credentialsMasked: detail.credentialsMasked,
    },
  };
}
