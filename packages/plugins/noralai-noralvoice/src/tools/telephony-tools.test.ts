/**
 * Tests for the three Phase 7 PR-J telephony tool handlers.
 *
 * Mirrors the stub pattern from tools.test.ts: stub `globalThis.fetch`,
 * invoke the executor, assert response shape + the four error paths
 * (happy / 4xx / 5xx / NO_API_KEY).
 *
 * The critical invariant covered here is the **secret non-leak**: when
 * an agent calls `add_telephony_credential` with a raw auth_token, that
 * raw value MUST NOT appear in the structured result — only NV's masked
 * preview is allowed to flow back into the agent transcript. We test
 * this directly with `JSON.stringify(result)` containing the raw secret.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeAddTelephonyCredential } from "./add_telephony_credential.js";
import { executeAssignPhoneNumber } from "./assign_phone_number_to_workflow.js";
import { executeListTelephonyCredentials } from "./list_telephony_credentials.js";

const baseConfig = { baseUrl: "https://voice.noral.ai", apiKey: "test-key" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJson(status: number, body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

// ===========================================================================
// add_telephony_credential
// ===========================================================================

describe("executeAddTelephonyCredential", () => {
  const params = {
    name: "Main Twilio",
    provider: "twilio" as const,
    credentials: {
      account_sid: "test-twilio-account-sid-placeholder",
      auth_token: "SUPER-SECRET-TOKEN-NEVER-LEAK-ME",
    },
  };

  it("happy path: returns masked credentials + config metadata", async () => {
    mockJson(200, {
      id: 42,
      name: "Main Twilio",
      provider: "twilio",
      is_default_outbound: false,
      // NV's _mask_sensitive replaces sensitive fields with masked previews
      // before returning. The tool surface MUST only echo these masked
      // forms — never the raw secrets the agent passed in.
      credentials: {
        account_sid: "****************cdef",
        auth_token: "****************t-me",
      },
      created_at: "2026-05-17T13:00:00Z",
      updated_at: "2026-05-17T13:00:00Z",
    });

    const result = await executeAddTelephonyCredential(baseConfig, params);

    expect(result.data.configId).toBe(42);
    expect(result.data.provider).toBe("twilio");
    expect(result.data.name).toBe("Main Twilio");
    expect(result.data.isDefaultOutbound).toBe(false);
    expect(result.data.credentialsMasked.account_sid).toBe("****************cdef");
    expect(result.data.credentialsMasked.auth_token).toBe("****************t-me");
    expect(result.content).toContain("twilio");
    expect(result.content).toContain("Main Twilio");
  });

  it("secret non-leak invariant: raw input secret never appears in result", async () => {
    // Even if NV bugs out and echoes the raw secret in `credentials`, our
    // tool's `credentialsMasked` would mirror it. So this test mocks the
    // best-case (NV masks correctly) AND demonstrates that the tool itself
    // doesn't independently echo the input. Both halves of the contract
    // matter — `result.data` only carries what NV returned, never what
    // the agent passed.
    mockJson(200, {
      id: 99,
      name: "Main Twilio",
      provider: "twilio",
      is_default_outbound: false,
      credentials: {
        account_sid: "****************cdef",
        auth_token: "****************t-me",
      },
      created_at: "2026-05-17T13:00:00Z",
      updated_at: "2026-05-17T13:00:00Z",
    });

    const result = await executeAddTelephonyCredential(baseConfig, params);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("SUPER-SECRET-TOKEN-NEVER-LEAK-ME");
    expect(serialised).not.toContain(
      "test-twilio-account-sid-placeholder",
    );
  });

  it("propagates 409 (name conflict) as HTTP_4XX", async () => {
    mockJson(409, {
      detail:
        "A telephony configuration named 'Main Twilio' already exists in this organization.",
    });
    await expect(executeAddTelephonyCredential(baseConfig, params)).rejects.toMatchObject({
      category: "HTTP_4XX",
      httpStatus: 409,
    });
  });

  it("propagates 5xx as HTTP_5XX", async () => {
    mockJson(503, { detail: "service unavailable" });
    await expect(executeAddTelephonyCredential(baseConfig, params)).rejects.toMatchObject({
      category: "HTTP_5XX",
      httpStatus: 503,
    });
  });

  it("missing API key → NO_API_KEY before any fetch happens", async () => {
    await expect(
      executeAddTelephonyCredential(
        { baseUrl: "https://voice.noral.ai", apiKey: "" },
        params,
      ),
    ).rejects.toMatchObject({ category: "NO_API_KEY" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// list_telephony_credentials
// ===========================================================================

describe("executeListTelephonyCredentials", () => {
  it("happy path: maps NV list shape to TelephonyConfigSummary[]", async () => {
    mockJson(200, {
      configurations: [
        {
          id: 1,
          name: "Twilio",
          provider: "twilio",
          is_default_outbound: true,
          phone_number_count: 3,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-10T00:00:00Z",
        },
        {
          id: 2,
          name: "Plivo backup",
          provider: "plivo",
          is_default_outbound: false,
          phone_number_count: 0,
          created_at: "2026-05-15T00:00:00Z",
          updated_at: "2026-05-15T00:00:00Z",
        },
      ],
    });
    const result = await executeListTelephonyCredentials(baseConfig);
    expect(result.data.configs).toHaveLength(2);
    expect(result.data.configs[0]).toMatchObject({
      id: 1,
      name: "Twilio",
      provider: "twilio",
      isDefaultOutbound: true,
      phoneNumberCount: 3,
    });
    expect(result.content).toContain("Found 2 telephony credentials");
    expect(result.content).toContain("default outbound");
  });

  it("empty list returns the helpful zero-state with provider hint", async () => {
    mockJson(200, { configurations: [] });
    const result = await executeListTelephonyCredentials(baseConfig);
    expect(result.data.configs).toHaveLength(0);
    expect(result.content).toMatch(/no telephony provider credentials/i);
    expect(result.content).toContain("twilio");
  });

  it("propagates 4xx as HTTP_4XX", async () => {
    mockJson(403, { detail: "Forbidden" });
    await expect(executeListTelephonyCredentials(baseConfig)).rejects.toMatchObject({
      category: "HTTP_4XX",
      httpStatus: 403,
    });
  });

  it("missing API key → NO_API_KEY before any fetch happens", async () => {
    await expect(
      executeListTelephonyCredentials({ baseUrl: "https://voice.noral.ai", apiKey: "" }),
    ).rejects.toMatchObject({ category: "NO_API_KEY" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// assign_phone_number_to_workflow
// ===========================================================================

describe("executeAssignPhoneNumber", () => {
  const baseParams = {
    configId: 7,
    address: "+15555550100",
  };

  it("outbound-only (no inbound workflow): reports registration without webhook info", async () => {
    mockJson(200, {
      id: 200,
      telephony_configuration_id: 7,
      address: "+15555550100",
      country_code: "US",
      is_active: true,
      is_default_caller_id: false,
    });
    const result = await executeAssignPhoneNumber(baseConfig, baseParams);
    expect(result.data.id).toBe(200);
    expect(result.data.configId).toBe(7);
    expect(result.data.address).toBe("+15555550100");
    expect(result.content).toContain("outbound use only");
    expect(result.content).not.toMatch(/webhook/i);
  });

  it("inbound with sync OK: confirms NV updated the provider directly", async () => {
    mockJson(200, {
      id: 201,
      telephony_configuration_id: 7,
      address: "+15555550100",
      inbound_workflow_id: 22,
      is_active: true,
      is_default_caller_id: false,
      provider_sync: { ok: true, message: "" },
    });
    const result = await executeAssignPhoneNumber(baseConfig, {
      ...baseParams,
      inboundWorkflowId: 22,
    });
    expect(result.data.providerSyncOk).toBe(true);
    expect(result.content).toContain("Provider sync succeeded");
    expect(result.content).toContain("workflow 22");
  });

  it("inbound with sync FAILED: surfaces webhook URL for manual paste", async () => {
    mockJson(200, {
      id: 202,
      telephony_configuration_id: 7,
      address: "+15555550100",
      inbound_workflow_id: 22,
      is_active: true,
      is_default_caller_id: false,
      provider_sync: {
        ok: false,
        message: "Twilio API returned 401: Authentication failed",
      },
      inbound_webhook_url: "https://voice.noral.ai/api/v1/telephony/inbound/22",
    });
    const result = await executeAssignPhoneNumber(baseConfig, {
      ...baseParams,
      inboundWorkflowId: 22,
    });
    expect(result.data.providerSyncOk).toBe(false);
    expect(result.data.inboundWebhookUrl).toBe(
      "https://voice.noral.ai/api/v1/telephony/inbound/22",
    );
    expect(result.content).toContain("Provider sync failed");
    expect(result.content).toContain("Twilio API returned 401");
    expect(result.content).toContain("Manual step");
    expect(result.content).toContain("https://voice.noral.ai/api/v1/telephony/inbound/22");
  });

  it("propagates 409 (number already routed) as HTTP_4XX", async () => {
    mockJson(409, {
      detail:
        "Phone number +15555550100 is already registered under telephony configuration 'Old Twilio'.",
    });
    await expect(
      executeAssignPhoneNumber(baseConfig, { ...baseParams, inboundWorkflowId: 22 }),
    ).rejects.toMatchObject({
      category: "HTTP_4XX",
      httpStatus: 409,
    });
  });

  it("missing API key → NO_API_KEY before any fetch happens", async () => {
    await expect(
      executeAssignPhoneNumber(
        { baseUrl: "https://voice.noral.ai", apiKey: "" },
        baseParams,
      ),
    ).rejects.toMatchObject({ category: "NO_API_KEY" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
