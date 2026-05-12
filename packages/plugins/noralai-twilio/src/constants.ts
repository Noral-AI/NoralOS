/**
 * Constants shared between the manifest, worker, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.twilio:send_sms`). It MUST stay stable
 * across versions — operator-side assignments in `integration_credentials`
 * reference it by `pluginKey: "noralai.twilio"`.
 */

export const PLUGIN_ID = "noralai.twilio";
export const PLUGIN_VERSION = "0.1.0";

/** Tool name within this plugin (becomes `noralai.twilio:send_sms` at the host). */
export const SEND_SMS_TOOL_NAME = "send_sms";

/** Twilio Messages body length limit. Documented at https://www.twilio.com/docs/glossary/what-sms-character-limit. */
export const TWILIO_MAX_BODY_CHARS = 1600;
