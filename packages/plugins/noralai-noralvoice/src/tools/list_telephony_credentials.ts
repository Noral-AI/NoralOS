/**
 * `noralvoice:list_telephony_credentials` tool handler.
 *
 * Read-only — admits any tier. NoralVoice's list endpoint deliberately
 * omits credentials (`TelephonyConfigurationListItem` carries only
 * name/provider/counts/timestamps), so there's no secret surface here
 * even if a transcript leaks.
 */

import {
  listTelephonyConfigs,
  type NoralVoiceClientConfig,
  type TelephonyConfigSummary,
} from "../noralvoice-client.js";

export interface ListTelephonyCredentialsResult {
  content: string;
  data: { configs: TelephonyConfigSummary[] };
}

export async function executeListTelephonyCredentials(
  config: NoralVoiceClientConfig,
): Promise<ListTelephonyCredentialsResult> {
  const configs = await listTelephonyConfigs(config);
  if (configs.length === 0) {
    return {
      content:
        "No telephony provider credentials configured yet. Use `add_telephony_credential` " +
        "with a provider (twilio, plivo, vonage, vobiz, cloudonix, ari, telnyx) and the " +
        "provider-specific credential fields.",
      data: { configs: [] },
    };
  }
  const lines = configs.map((c) => {
    const defaultMark = c.isDefaultOutbound ? " [default outbound]" : "";
    const phoneSummary =
      c.phoneNumberCount === 0
        ? "no numbers"
        : c.phoneNumberCount === 1
          ? "1 number"
          : `${c.phoneNumberCount} numbers`;
    return `- ${c.provider} "${c.name}" (config_id ${c.id}) — ${phoneSummary}${defaultMark}`;
  });
  return {
    content: `Found ${configs.length} telephony credential${configs.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
    data: { configs },
  };
}
