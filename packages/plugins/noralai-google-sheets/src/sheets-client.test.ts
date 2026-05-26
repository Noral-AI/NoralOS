import { describe, expect, it } from "vitest";

import {
  GoogleProviderError,
  createGoogleSheetsClient,
  type GoogleOAuthMaterial,
  type GoogleSheetsClientConfig,
} from "./sheets-client.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SPREADSHEET_ID = "1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd";

function material(overrides: Partial<GoogleOAuthMaterial> = {}): GoogleOAuthMaterial {
  return {
    clientId: "1234.apps.googleusercontent.com",
    clientSecret: "secret",
    refreshToken: "rt_xyz",
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
  throws?: Error;
}

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
    const isNullBodyStatus =
      spec.status === 204 || spec.status === 205 || spec.status === 304;
    const body = isNullBodyStatus
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
  override?: Partial<GoogleSheetsClientConfig>,
): { client: ReturnType<typeof createGoogleSheetsClient>; calls: MockCall[] } {
  const { fetchImpl, calls } = mockFetch(specs);
  const client = createGoogleSheetsClient({
    material: material(),
    fetchImpl,
    now: () => 1_700_000_000_000,
    ...override,
  });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe("createGoogleSheetsClient", () => {
  it("rejects missing material fields", () => {
    expect(() =>
      createGoogleSheetsClient({
        material: { clientId: "", clientSecret: "x", refreshToken: "x" },
      }),
    ).toThrow(GoogleProviderError);
  });
});

// ---------------------------------------------------------------------------
// Access-token refresh + caching
// ---------------------------------------------------------------------------

describe("access token caching", () => {
  it("refreshes once and reuses the cached token across calls", async () => {
    const { client, calls } = configWithFetch([
      { url: "oauth2.googleapis.com/token", status: 200, body: { access_token: "at_1", expires_in: 3600 } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
    ]);
    await client.listSpreadsheets();
    await client.listSpreadsheets();
    expect(calls.length).toBe(3);
    expect(calls[0].url).toContain("oauth2.googleapis.com");
  });

  it("uses Bearer auth scheme on API calls", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "abc", expires_in: 3600 } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
    ]);
    await client.listSpreadsheets();
    const apiCall = calls[1];
    const headers = new Headers(apiCall.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer abc");
  });

  it("force-refreshes on a 401 and retries the request once", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "stale", expires_in: 3600 } },
      {
        url: "drive/v3/files",
        status: 401,
        body: { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } },
      },
      { url: "/token", status: 200, body: { access_token: "fresh", expires_in: 3600 } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
    ]);
    const result = await client.listSpreadsheets();
    expect(result.spreadsheets).toEqual([]);
    expect(calls.length).toBe(4);
    const lastHeaders = new Headers(calls[3].init?.headers);
    expect(lastHeaders.get("Authorization")).toBe("Bearer fresh");
  });

  it("classifies invalid_grant as auth and prompts a reconnect", async () => {
    const { client } = configWithFetch([
      { url: "/token", status: 400, body: { error: "invalid_grant" } },
    ]);
    await expect(client.listSpreadsheets()).rejects.toMatchObject({
      category: "auth",
      message: /Reconnect/,
    });
  });
});

// ---------------------------------------------------------------------------
// listSpreadsheets
// ---------------------------------------------------------------------------

describe("listSpreadsheets", () => {
  it("constructs a Drive q filter and parses the file list", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "drive/v3/files",
        status: 200,
        body: {
          files: [
            { id: "abc", name: "Q1 Forecast", modifiedTime: "2026-05-23T00:00:00Z" },
            { id: "def", name: "Customer List" },
            { broken: true }, // dropped
          ],
          nextPageToken: "next-cursor",
        },
      },
    ]);
    const result = await client.listSpreadsheets({ query: "Forecast", limit: 50 });
    expect(result.spreadsheets.map((s) => s.id)).toEqual(["abc", "def"]);
    expect(result.nextPageToken).toBe("next-cursor");

    const apiUrl = new URL(calls[1].url);
    expect(apiUrl.searchParams.get("pageSize")).toBe("50");
    const q = apiUrl.searchParams.get("q");
    expect(q).toContain("mimeType='application/vnd.google-apps.spreadsheet'");
    expect(q).toContain("trashed=false");
    expect(q).toContain("name contains 'Forecast'");
  });

  it("escapes single quotes in the query to avoid breaking the Drive q filter", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
    ]);
    await client.listSpreadsheets({ query: "O'Brien's" });
    const q = new URL(calls[1].url).searchParams.get("q") ?? "";
    expect(q).toContain("name contains 'O\\'Brien\\'s'");
  });
});

// ---------------------------------------------------------------------------
// getSpreadsheet
// ---------------------------------------------------------------------------

describe("getSpreadsheet", () => {
  it("returns sheet tab metadata", async () => {
    const { client } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: `sheets.googleapis.com/v4/spreadsheets/${VALID_SPREADSHEET_ID}`,
        status: 200,
        body: {
          spreadsheetId: VALID_SPREADSHEET_ID,
          properties: { title: "Q1 Plan", locale: "en_US", timeZone: "America/New_York" },
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${VALID_SPREADSHEET_ID}/edit`,
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: "Pipeline",
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
            {
              properties: {
                sheetId: 1234,
                title: "Notes",
                gridProperties: { rowCount: 100, columnCount: 10 },
              },
            },
            { unknown: true }, // dropped
          ],
        },
      },
    ]);
    const detail = await client.getSpreadsheet(VALID_SPREADSHEET_ID);
    expect(detail.title).toBe("Q1 Plan");
    expect(detail.sheets).toHaveLength(2);
    expect(detail.sheets[0]).toEqual({
      sheetId: 0,
      title: "Pipeline",
      gridRows: 1000,
      gridColumns: 26,
    });
  });

  it("rejects malformed spreadsheet ids without a network call", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(client.getSpreadsheet("short")).rejects.toMatchObject({
      category: "malformed",
    });
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readRange
// ---------------------------------------------------------------------------

describe("readRange", () => {
  it("URL-encodes the range and returns parsed values", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: `sheets.googleapis.com/v4/spreadsheets/${VALID_SPREADSHEET_ID}/values/`,
        status: 200,
        body: {
          range: "'My Sheet'!A1:B2",
          majorDimension: "ROWS",
          values: [
            ["Name", "Email"],
            ["Jane", "jane@example.com"],
          ],
        },
      },
    ]);
    const result = await client.readRange({
      spreadsheetId: VALID_SPREADSHEET_ID,
      range: "'My Sheet'!A1:B2",
    });
    expect(result.values).toHaveLength(2);
    expect(result.majorDimension).toBe("ROWS");
    const apiUrl = calls[1].url;
    // `encodeURIComponent` percent-encodes spaces (`%20`) and `:` (`%3A`),
    // but the URL constructor normalises the unreserved chars `'` and
    // `!` back to literal form — Google accepts both. So we assert on
    // the post-`new URL()` shape, not on the raw `encodeURIComponent`
    // output.
    expect(apiUrl).toContain("/values/'My%20Sheet'!A1%3AB2");
  });

  it("rejects an invalid A1 range without a network call", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(
      client.readRange({ spreadsheetId: VALID_SPREADSHEET_ID, range: "not a range" }),
    ).rejects.toMatchObject({ category: "malformed" });
    expect(calls.length).toBe(0);
  });

  it("handles an empty values payload from Google", async () => {
    const { client } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "sheets.googleapis.com/v4",
        status: 200,
        body: { range: "Sheet1!A1:Z", majorDimension: "ROWS" },
      },
    ]);
    const result = await client.readRange({
      spreadsheetId: VALID_SPREADSHEET_ID,
      range: "Sheet1!A1:Z",
    });
    expect(result.values).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendRows / updateRange
// ---------------------------------------------------------------------------

describe("appendRows", () => {
  it("POSTs the values, USER_ENTERED + INSERT_ROWS by default", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: `sheets.googleapis.com/v4/spreadsheets/${VALID_SPREADSHEET_ID}/values/`,
        status: 200,
        body: {
          updates: {
            updatedRange: "Sheet1!A5:B5",
            updatedRows: 1,
            updatedColumns: 2,
            updatedCells: 2,
          },
        },
      },
    ]);
    const result = await client.appendRows({
      spreadsheetId: VALID_SPREADSHEET_ID,
      range: "Sheet1!A1",
      values: [["Jane", "jane@example.com"]],
    });
    expect(result.updatedRows).toBe(1);
    expect(result.updatedCells).toBe(2);

    const writeCall = calls[1];
    expect(writeCall.init?.method).toBe("POST");
    const url = new URL(writeCall.url);
    expect(url.searchParams.get("valueInputOption")).toBe("USER_ENTERED");
    expect(url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS");
    const body = JSON.parse(writeCall.init?.body as string);
    expect(body).toEqual({ values: [["Jane", "jane@example.com"]] });
  });

  it("rejects an empty values array without a network call", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(
      client.appendRows({
        spreadsheetId: VALID_SPREADSHEET_ID,
        range: "Sheet1!A1",
        values: [],
      }),
    ).rejects.toMatchObject({ category: "malformed" });
    expect(calls.length).toBe(0);
  });

  it("rejects a non-2D values array (single flat row passed by mistake)", async () => {
    const { client, calls } = configWithFetch([]);
    await expect(
      client.appendRows({
        spreadsheetId: VALID_SPREADSHEET_ID,
        range: "Sheet1!A1",
        values: ["Jane", "jane@example.com"] as unknown as unknown[][],
      }),
    ).rejects.toMatchObject({ category: "malformed" });
    expect(calls.length).toBe(0);
  });
});

describe("updateRange", () => {
  it("PUTs values with USER_ENTERED by default and includes the range in the body", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "sheets.googleapis.com/v4/spreadsheets",
        status: 200,
        body: {
          updatedRange: "Sheet1!A1:B1",
          updatedRows: 1,
          updatedColumns: 2,
          updatedCells: 2,
        },
      },
    ]);
    await client.updateRange({
      spreadsheetId: VALID_SPREADSHEET_ID,
      range: "Sheet1!A1:B1",
      values: [["x", "y"]],
    });
    const writeCall = calls[1];
    expect(writeCall.init?.method).toBe("PUT");
    const url = new URL(writeCall.url);
    expect(url.searchParams.get("valueInputOption")).toBe("USER_ENTERED");
    const body = JSON.parse(writeCall.init?.body as string);
    expect(body).toEqual({
      range: "Sheet1!A1:B1",
      majorDimension: "ROWS",
      values: [["x", "y"]],
    });
  });
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe("error classification", () => {
  it("captures Google's status enum from the error envelope", async () => {
    const { client } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      {
        url: "drive/v3/files",
        status: 403,
        body: {
          error: {
            code: 403,
            message: "The caller does not have permission",
            status: "PERMISSION_DENIED",
          },
        },
      },
    ]);
    await expect(client.listSpreadsheets()).rejects.toMatchObject({
      category: "auth",
      status: 403,
      googleStatus: "PERMISSION_DENIED",
    });
  });

  it("maps a fetch reject to category=network", async () => {
    const networkErr = new Error("ECONNREFUSED");
    const { client } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "drive/v3/files", status: 0, body: "", throws: networkErr },
    ]);
    await expect(client.listSpreadsheets()).rejects.toMatchObject({
      category: "network",
    });
  });

  it("maps 429 to rate_limit", async () => {
    const { client } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "drive/v3/files", status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } },
    ]);
    await expect(client.listSpreadsheets()).rejects.toMatchObject({
      category: "rate_limit",
    });
  });
});

// ---------------------------------------------------------------------------
// Concurrent refresh coalescing
// ---------------------------------------------------------------------------

describe("concurrent calls", () => {
  it("coalesces concurrent refreshes into a single token request", async () => {
    const { client, calls } = configWithFetch([
      { url: "/token", status: 200, body: { access_token: "at", expires_in: 3600 } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
      { url: "drive/v3/files", status: 200, body: { files: [] } },
    ]);
    await Promise.all([
      client.listSpreadsheets(),
      client.listSpreadsheets(),
      client.listSpreadsheets(),
    ]);
    const refreshCount = calls.filter((c) => c.url.includes("oauth2.googleapis.com/token")).length;
    expect(refreshCount).toBe(1);
  });
});
