/**
 * `noralvoice:assign_phone_number_to_workflow` tool handler.
 *
 * High-stakes: registers a phone number with NoralVoice and (when an inbound
 * workflow is supplied) wires inbound calls on that number to the workflow.
 * Tier gate (manager+) is enforced in `worker.ts` BEFORE this handler runs.
 *
 * For Twilio specifically, NoralVoice attempts an auto-sync of the inbound
 * webhook to the Twilio number's "Voice → A CALL COMES IN" setting. The sync
 * uses the credentials stored against `configId`, so it works without the
 * user touching Twilio if those credentials have write access to the number.
 * When the sync fails (number not owned by the account, restricted token,
 * etc.), the result's `inboundWebhookUrl` field surfaces the URL the user
 * must paste into the Twilio console manually.
 */

import {
  addPhoneNumber,
  type NoralVoiceClientConfig,
  type PhoneNumberAssignment,
} from "../noralvoice-client.js";

export interface AssignPhoneNumberParams {
  configId: number;
  address: string;
  inboundWorkflowId?: number;
  countryCode?: string;
  label?: string;
  isDefaultCallerId?: boolean;
}

export interface AssignPhoneNumberResult {
  content: string;
  data: PhoneNumberAssignment;
}

export async function executeAssignPhoneNumber(
  config: NoralVoiceClientConfig,
  params: AssignPhoneNumberParams,
): Promise<AssignPhoneNumberResult> {
  const result = await addPhoneNumber(config, params);
  const lines: string[] = [];
  if (params.inboundWorkflowId !== undefined) {
    lines.push(
      `Registered ${result.address} under telephony config ${params.configId} and routed inbound calls to workflow ${params.inboundWorkflowId}.`,
    );
    if (result.providerSyncOk === true) {
      lines.push(
        `Provider sync succeeded — NoralVoice updated the inbound webhook on the number directly.`,
      );
    } else if (result.providerSyncOk === false) {
      lines.push(
        `Provider sync failed: ${result.providerSyncMessage ?? "unknown reason"}.`,
      );
      if (result.inboundWebhookUrl) {
        lines.push(
          `Manual step: in your telephony provider's console, set the inbound webhook on ${result.address} to: ${result.inboundWebhookUrl}`,
        );
      }
    } else if (result.inboundWebhookUrl) {
      lines.push(
        `Inbound webhook URL (paste into your telephony provider's console for ${result.address}): ${result.inboundWebhookUrl}`,
      );
    }
  } else {
    lines.push(
      `Registered ${result.address} under telephony config ${params.configId} for outbound use only (no inbound workflow attached).`,
    );
  }
  return { content: lines.join("\n"), data: result };
}
