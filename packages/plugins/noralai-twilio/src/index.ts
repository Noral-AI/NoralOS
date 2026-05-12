/**
 * `@noralos-plugins/noralai-twilio` public entry.
 *
 * Re-exports the manifest (used by the host's manifest validator and
 * by the future install-time DB row) and the constants so callers
 * (and tests) don't have to import deep paths.
 *
 * The worker entrypoint lives at `dist/worker.js` after `pnpm build`;
 * it is referenced by the manifest's `entrypoints.worker` field and is
 * not exported through this index file because no in-process consumer
 * imports it.
 */

export { manifest } from "./manifest.js";
export {
  PLUGIN_ID,
  PLUGIN_VERSION,
  SEND_SMS_TOOL_NAME,
  TWILIO_MAX_BODY_CHARS,
} from "./constants.js";
export {
  sendSms,
  isRetryable,
  TwilioProviderError,
  type TwilioClientConfig,
  type SendSmsRequest,
  type SendSmsResult,
  type TwilioErrorCategory,
} from "./twilio-client.js";
