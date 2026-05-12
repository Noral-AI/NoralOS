/**
 * Twilio plugin worker entrypoint.
 *
 * Registers a single tool handler — `send_sms` — that resolves the
 * Twilio Auth Token from the per-company plugin config, then dispatches
 * to the REST client. This worker is the only host-facing surface of
 * the plugin; everything else (manifest, REST client, types) is
 * imported through `./src/index.ts` for in-process consumers (tests).
 *
 * Boundaries:
 *   - Reads `accountSid`, `authTokenRef`, and `fromNumber` from the
 *     resolved plugin config. The `authTokenRef` is a host-secret
 *     reference (e.g. `company-secret:<credential-id>`) that is
 *     resolved through `ctx.secrets.resolve()` at every call — never
 *     cached.
 *   - Never logs the resolved Auth Token, the message body, or the
 *     recipient phone number at info+ level. Errors capture only the
 *     plugin-level category and Twilio's safe error code.
 *
 * Plugin-config contract (set by the host in PR 2b):
 *   {
 *     "accountSid":    "AC...",          // text  — public-ish identifier
 *     "authTokenRef":  "<secret-ref>",   // ref to an integration_credential
 *     "fromNumber":    "+1555..."        // text  — default E.164 sender
 *   }
 *
 * The handler accepts a per-call `from` override so an agent that
 * controls multiple Twilio numbers can send from a specific line; if
 * omitted, the company's default `fromNumber` is used.
 */

import { definePlugin, runWorker } from "@noralos/plugin-sdk";

import { PLUGIN_ID, SEND_SMS_TOOL_NAME, TWILIO_MAX_BODY_CHARS } from "./constants.js";
import { sendSms, TwilioProviderError } from "./twilio-client.js";
import { manifest } from "./manifest.js";

interface ResolvedConfig {
  accountSid: string;
  authTokenRef: string;
  fromNumber: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readConfig(raw: Record<string, unknown>): ResolvedConfig | { error: string } {
  const accountSid = isString(raw.accountSid) ? raw.accountSid.trim() : "";
  const authTokenRef = isString(raw.authTokenRef) ? raw.authTokenRef.trim() : "";
  const fromNumber = isString(raw.fromNumber) ? raw.fromNumber.trim() : "";
  const missing: string[] = [];
  if (!accountSid) missing.push("accountSid");
  if (!authTokenRef) missing.push("authTokenRef");
  if (!fromNumber) missing.push("fromNumber");
  if (missing.length > 0) {
    return { error: `Twilio plugin config is missing: ${missing.join(", ")}.` };
  }
  return { accountSid, authTokenRef, fromNumber };
}

interface SendSmsParams {
  to: string;
  body: string;
  from?: string;
}

function readParams(raw: unknown): SendSmsParams | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "send_sms requires a parameter object with `to` and `body`." };
  }
  const obj = raw as Record<string, unknown>;
  const to = isString(obj.to) ? obj.to.trim() : "";
  const body = isString(obj.body) ? obj.body : "";
  const from = isString(obj.from) ? obj.from.trim() : undefined;
  if (!to) return { error: "send_sms.`to` must be a non-empty string." };
  if (!body) return { error: "send_sms.`body` must be a non-empty string." };
  if (body.length > TWILIO_MAX_BODY_CHARS) {
    return { error: `send_sms.\`body\` exceeds Twilio's ${TWILIO_MAX_BODY_CHARS}-char limit.` };
  }
  return { to, body, from };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.tools.register(
      SEND_SMS_TOOL_NAME,
      // Re-declare the operator-visible metadata here too. The host
      // also reads it from the manifest at install time; declaring it
      // again at registration keeps the worker self-contained for the
      // `executeTool` path and matches the SDK signature.
      {
        displayName: manifest.tools![0]!.displayName,
        description: manifest.tools![0]!.description,
        parametersSchema: manifest.tools![0]!.parametersSchema,
      },
      async (rawParams, runCtx) => {
        const params = readParams(rawParams);
        if ("error" in params) return { error: params.error };

        const config = readConfig(await ctx.config.get());
        if ("error" in config) return { error: config.error };

        let authToken: string;
        try {
          authToken = await ctx.secrets.resolve(config.authTokenRef);
        } catch (err) {
          ctx.logger.error("Twilio authToken resolution failed", {
            companyId: runCtx.companyId,
            agentId: runCtx.agentId,
            // Intentionally NOT logging authTokenRef or the error
            // message — DB errors can leak credential ids.
          });
          return {
            error:
              "Twilio plugin could not resolve the Auth Token credential. Check Settings → Integrations → Twilio.",
          };
        }
        if (!authToken) {
          return {
            error:
              "Twilio plugin Auth Token credential is empty. Re-enter the credential in Settings → Integrations.",
          };
        }

        try {
          const result = await sendSms(
            {
              accountSid: config.accountSid,
              authToken,
            },
            {
              to: params.to,
              from: params.from ?? config.fromNumber,
              body: params.body,
            },
          );
          ctx.logger.info("Twilio send_sms accepted by upstream", {
            companyId: runCtx.companyId,
            agentId: runCtx.agentId,
            sid: result.sid,
            twilioStatus: result.status,
            attempts: result.attempts,
            latencyMs: result.latencyMs,
            // Intentionally NOT logging `to`, `from`, or `body`.
          });
          return {
            content: `SMS accepted by Twilio (sid=${result.sid}, status=${result.status}).`,
            data: {
              sid: result.sid,
              status: result.status,
              attempts: result.attempts,
              latencyMs: result.latencyMs,
            },
          };
        } catch (err) {
          const safe =
            err instanceof TwilioProviderError
              ? err.message
              : "Twilio send_sms failed for an unknown reason.";
          const category =
            err instanceof TwilioProviderError ? err.category : "unknown";
          const httpStatus =
            err instanceof TwilioProviderError ? err.status : undefined;
          const twilioCode =
            err instanceof TwilioProviderError ? err.twilioCode : undefined;
          ctx.logger.warn("Twilio send_sms failed", {
            companyId: runCtx.companyId,
            agentId: runCtx.agentId,
            category,
            httpStatus,
            twilioCode,
            // `safe` is hand-curated by the client — never the raw body.
          });
          return { error: safe };
        }
      },
    );

    ctx.logger.info(`${PLUGIN_ID} plugin setup complete`);
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_ID} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
