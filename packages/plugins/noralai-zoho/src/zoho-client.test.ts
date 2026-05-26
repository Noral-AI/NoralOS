import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ZohoProviderError,
  createZohoClient,
  type ZohoClientConfig,
  type ZohoOAuthMaterial,
} from "./zoho-client.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function material(overrides: Partial<ZohoOAuthMaterial> = {}): ZohoOAuthMaterial {
  return {
    clientId: "1000.ABCDEF",
    clientSecret: "secret-value",
    refreshToken: "rt_abc123",
    ...overrides,
  };
}

interface MockCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchSpec {
  url: string | RegExp;
  status: number;
  body: unknown;
  /** When set, throws this once for that call (e.g. to simulate a network error). */
  throws?: Error;
}

/**
 * Build a fetch mock that returns the queued responses in order, matching
 * each by URL (string includes or regex). The mock records every call's
 * url + init for downstream assertions.
 */
function mockFetch(specs: FetchSpec[]): {
  fetchImpl: typeof fetch;
  calls: MockCall[];
} {
  const queue = [...specs];
  const calls: MockCall[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    if (queue.length === 0) {
      throw new Error(`Unexpected fetch call (no spec queued): ${url}`);
    }
    const spec = queue.shift()!;
    const matches =
      typeof spec.url === "string"
        ? url.includes(spec.url)
        : spec.url.test(url);
    if (!matches) {
      throw new Error(`Fetch URL ${url} did not match expected ${spec.url}`);
    }
    if (spec.throws) throw spec.throws;
    // The Fetch spec forbids a body on 204/205/304 — `new Response("", { status: 204 })`
    // throws. Pass `null` (or an empty body via undefined) in that case.
    const isNullBodyStatus = spec.status === 204 || spec.status === 205 || spec.status === 304;
    const body =
      isNullBodyStatus
        ? null
        : typeof spec.body === "string"
          ? spec.body
          : JSON.stringify(spec.body);
    return new Response(body, {
      status: spec.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function configWithFetch(
  specs: FetchSpec[],
  override?: Partial<ZohoClientConfig>,
): { client: ReturnType<typeof createZohoClient>; calls: MockCall[] } {
  const { fetchImpl, calls } = mockFetch(specs);
  const client = createZohoClient({
    material: material(),
    dataCenter: "us",
    fetchImpl,
    now: () => 1_700_000_000_000,
    ...override,
  });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe("createZohoClient", () => {
  it("rejects missing material fields", () => {
    expect(() =>
      createZohoClient({
        material: { clientId: "", clientSecret: "x", refreshToken: "x" },
        dataCenter: "us",
      }),
    ).toThrow(ZohoProviderError);
  });

  it("rejects an unknown data center", () => {
    expect(() =>
      createZohoClient({
        material: material(),
        dataCenter: "mars" as unknown as "us",
      }),
    ).toThrow(/dataCenter 'mars' is not recognised/);
  });
});

// ---------------------------------------------------------------------------
// Access-token refresh + caching
// ---------------------------------------------------------------------------

describe("access token caching", () => {
  it("refreshes once and reuses the cached token across calls", async () => {
    const { client, calls } = configWithFetch([
      // First call: refresh.
      {
        url: "accounts.zoho.com/oauth/v2/token",
        status: 200,
        body: { access_token: "at_1", expires_in: 3600 },
      },
      // Second call: API call uses cached token.
      {
        url: "/crm/v7/settings/modules",
        status: 200,
        body: { modules: [{ api_name: "Leads", plural_label: "Leads", viewable: true, creatable: true, editable: true }] },
      },
      // Third call: another API call. Should NOT trigger a second refresh.
      {
        url: "/crm/v7/settings/modules",
        status: 200,
        body: { modules: [] },
      },
    ]);
    await client.listModules();
    await client.listModules();
    // 1 refresh + 2 API calls = 3 fetches; no second refresh.
    expect(calls.length).toBe(3);
    expect(calls[0].url).toContain("accounts.zoho.com");
    expect(calls[1].url).toContain("/crm/v7/settings/modules");
    expect(calls[2].url).toContain("/crm/v7/settings/modules");
  });

  it("uses Zoho-oauthtoken auth scheme on API calls", async () => {
    const { client, calls } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at_xyz", expires_in: 3600 } },
      { url: "/crm/v7/settings/modules", status: 200, body: { modules: [] } },
    ]);
    await client.listModules();
    const apiCall = calls[1];
    const headers = new Headers(apiCall.init?.headers);
    expect(headers.get("Authorization")).toBe("Zoho-oauthtoken at_xyz");
  });

  it("force-refreshes on a 401 and retries the request once", async () => {
    const { client, calls } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "stale", expires_in: 3600 } },
      { url: "/crm/v7/settings/modules", status: 401, body: { code: "AUTHENTICATION_FAILURE", message: "Invalid token" } },
      { url: "/oauth/v2/token", status: 200, body: { access_token: "fresh", expires_in: 3600 } },
      { url: "/crm/v7/settings/modules", status: 200, body: { modules: [] } },
    ]);
    const result = await client.listModules();
    expect(result.modules).toEqual([]);
    expect(calls.length).toBe(4);
    // Final API call uses the fresh token.
    const lastApi = calls[3];
    const lastHeaders = new Headers(lastApi.init?.headers);
    expect(lastHeaders.get("Authorization")).toBe("Zoho-oauthtoken fresh");
  });

  it("does not infinite-loop when a 401 persists after refresh", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "t1", expires_in: 3600 } },
      { url: "/crm/v7/settings/modules", status: 401, body: { code: "AUTHENTICATION_FAILURE" } },
      { url: "/oauth/v2/token", status: 200, body: { access_token: "t2", expires_in: 3600 } },
      { url: "/crm/v7/settings/modules", status: 401, body: { code: "AUTHENTICATION_FAILURE" } },
    ]);
    await expect(client.listModules()).rejects.toMatchObject({
      category: "auth",
      status: 401,
    });
  });

  it("classifies invalid_grant as auth and surfaces a clear reconnect hint", async () => {
    const { client } = configWithFetch([
      {
        url: "/oauth/v2/token",
        status: 400,
        body: { error: "invalid_grant" },
      },
    ]);
    await expect(client.listModules()).rejects.toMatchObject({
      category: "auth",
      message: /Reconnect/,
    });
  });
});

// ---------------------------------------------------------------------------
// Per-method behavior
// ---------------------------------------------------------------------------

describe("listModules", () => {
  it("parses the modules payload into the typed summary", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "/crm/v7/settings/modules",
        status: 200,
        body: {
          modules: [
            {
              api_name: "Leads",
              plural_label: "Leads",
              generated_type: "default",
              viewable: true,
              creatable: true,
              editable: true,
            },
            {
              api_name: "Custom_1",
              plural_label: "Custom Module 1",
              generated_type: "custom",
              viewable: true,
              creatable: false,
              editable: true,
            },
            { broken: true }, // malformed entry should be dropped
          ],
        },
      },
    ]);
    const result = await client.listModules();
    expect(result.modules).toEqual([
      {
        apiName: "Leads",
        displayName: "Leads",
        generatedByCustomization: false,
        viewable: true,
        creatable: true,
        editable: true,
      },
      {
        apiName: "Custom_1",
        displayName: "Custom Module 1",
        generatedByCustomization: true,
        viewable: true,
        creatable: false,
        editable: true,
      },
    ]);
  });
});

describe("searchRecords", () => {
  it("rejects calls with no filter", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
    ]);
    await expect(client.searchRecords({ module: "Leads" })).rejects.toMatchObject({
      category: "malformed",
      message: /at least one of: criteria, word, email, phone/,
    });
  });

  it("rejects calls with more than one filter", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
    ]);
    await expect(
      client.searchRecords({ module: "Leads", word: "acme", email: "x@y.com" }),
    ).rejects.toMatchObject({ category: "malformed" });
  });

  it("rejects malformed module names without a network call", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(
      client.searchRecords({ module: "Leads; DROP TABLE", word: "x" }),
    ).rejects.toMatchObject({ category: "malformed" });
    expect(calls.length).toBe(0);
  });

  it("sends the criteria query string and parses records", async () => {
    const { client, calls } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "/crm/v7/Leads/search",
        status: 200,
        body: {
          data: [
            { id: "111", Last_Name: "Doe", Email: "jane@example.com" },
            { id: "222", Last_Name: "Roe" },
          ],
          info: { more_records: true },
        },
      },
    ]);
    const result = await client.searchRecords({
      module: "Leads",
      criteria: "(Last_Name:starts_with:D)",
      limit: 10,
      page: 2,
    });
    expect(result.records.map((r) => r.id)).toEqual(["111", "222"]);
    expect(result.moreRecords).toBe(true);

    const apiUrl = new URL(calls[1].url);
    expect(apiUrl.searchParams.get("criteria")).toBe("(Last_Name:starts_with:D)");
    expect(apiUrl.searchParams.get("per_page")).toBe("10");
    expect(apiUrl.searchParams.get("page")).toBe("2");
  });

  it("treats a 204 No Content as zero records", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "/crm/v7/Leads/search", status: 204, body: "" },
    ]);
    const result = await client.searchRecords({ module: "Leads", word: "nobody-matches" });
    expect(result.records).toEqual([]);
    expect(result.moreRecords).toBe(false);
  });
});

describe("getRecord", () => {
  it("returns a parsed record", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "/crm/v7/Contacts/12345",
        status: 200,
        body: { data: [{ id: "12345", Full_Name: "Jane Doe", Email: "jane@example.com" }] },
      },
    ]);
    const record = await client.getRecord("Contacts", "12345");
    expect(record.id).toBe("12345");
    expect(record.name).toBe("Jane Doe");
    expect(record.fields.Email).toBe("jane@example.com");
  });

  it("throws not_found on an empty payload", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "/crm/v7/Contacts/12345", status: 200, body: { data: [] } },
    ]);
    await expect(client.getRecord("Contacts", "12345")).rejects.toMatchObject({
      category: "not_found",
    });
  });

  it("rejects non-numeric record ids without a network call", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(client.getRecord("Contacts", "abc")).rejects.toMatchObject({
      category: "malformed",
    });
    expect(calls.length).toBe(0);
  });
});

describe("createRecord", () => {
  it("wraps values in the Zoho `data` array and returns the new id", async () => {
    const { client, calls } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "/crm/v7/Leads",
        status: 201,
        body: {
          data: [
            {
              code: "SUCCESS",
              status: "success",
              message: "record added",
              details: { id: "99999", Created_Time: "2026-05-23T00:00:00Z" },
            },
          ],
        },
      },
    ]);
    const record = await client.createRecord({
      module: "Leads",
      values: { Last_Name: "Doe", Company: "Acme" },
    });
    expect(record.id).toBe("99999");

    const writeCall = calls[1];
    expect(writeCall.init?.method).toBe("POST");
    const body = JSON.parse(writeCall.init?.body as string);
    expect(body).toEqual({ data: [{ Last_Name: "Doe", Company: "Acme" }] });
  });

  it("surfaces Zoho per-row failures as malformed errors", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "/crm/v7/Leads",
        status: 200,
        body: {
          data: [
            {
              code: "MANDATORY_NOT_FOUND",
              status: "error",
              message: "required field not found",
            },
          ],
        },
      },
    ]);
    await expect(
      client.createRecord({ module: "Leads", values: { Email: "x@y.com" } }),
    ).rejects.toMatchObject({ category: "malformed", zohoCode: "MANDATORY_NOT_FOUND" });
  });

  it("rejects empty values without a network call", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(
      client.createRecord({ module: "Leads", values: {} }),
    ).rejects.toMatchObject({ category: "malformed" });
    expect(calls.length).toBe(0);
  });
});

describe("updateRecord", () => {
  it("PATCHes with the id merged into the data row", async () => {
    const { client, calls } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "/crm/v7/Deals/77",
        status: 200,
        body: {
          data: [
            {
              code: "SUCCESS",
              status: "success",
              details: { id: "77", Modified_Time: "2026-05-23T00:00:00Z" },
            },
          ],
        },
      },
    ]);
    await client.updateRecord({
      module: "Deals",
      id: "77",
      values: { Stage: "Closed Won", Amount: 12000 },
    });
    const writeCall = calls[1];
    expect(writeCall.init?.method).toBe("PATCH");
    const body = JSON.parse(writeCall.init?.body as string);
    expect(body).toEqual({
      data: [{ id: "77", Stage: "Closed Won", Amount: 12000 }],
    });
  });
});

// ---------------------------------------------------------------------------
// Timeout + network errors
// ---------------------------------------------------------------------------

describe("error classification", () => {
  it("maps a fetch reject to category=network", async () => {
    const networkErr = new Error("ECONNREFUSED");
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "/crm/v7/Leads/search", status: 0, body: "", throws: networkErr },
    ]);
    await expect(
      client.searchRecords({ module: "Leads", word: "anything" }),
    ).rejects.toMatchObject({ category: "network" });
  });

  it("maps 429 to rate_limit", async () => {
    const { client } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "/crm/v7/Leads/search", status: 429, body: { code: "TOO_MANY_REQUESTS" } },
    ]);
    await expect(
      client.searchRecords({ module: "Leads", word: "x" }),
    ).rejects.toMatchObject({ category: "rate_limit" });
  });
});

// ---------------------------------------------------------------------------
// Concurrent refresh coalescing
// ---------------------------------------------------------------------------

describe("concurrent calls", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("coalesces concurrent refreshes into a single token request", async () => {
    const { client, calls } = configWithFetch([
      { url: "/oauth/v2/token", status: 200, body: { access_token: "at_one", expires_in: 3600 } },
      { url: "/crm/v7/settings/modules", status: 200, body: { modules: [] } },
      { url: "/crm/v7/settings/modules", status: 200, body: { modules: [] } },
      { url: "/crm/v7/settings/modules", status: 200, body: { modules: [] } },
    ]);
    await Promise.all([client.listModules(), client.listModules(), client.listModules()]);
    // Exactly one refresh + 3 API calls.
    const refreshCount = calls.filter((c) => c.url.includes("/oauth/v2/token")).length;
    expect(refreshCount).toBe(1);
  });
});
