/**
 * Google Sheets v4 + Drive v3 REST client used by the
 * noralai-google-sheets worker.
 *
 * Covers the v0.1.0 surface:
 *   - listSpreadsheets: GET drive/v3/files?mimeType=application/vnd.google-apps.spreadsheet
 *   - getSpreadsheet: GET sheets/v4/spreadsheets/{id}
 *   - readRange: GET sheets/v4/spreadsheets/{id}/values/{range}
 *   - appendRows: POST sheets/v4/spreadsheets/{id}/values/{range}:append
 *   - updateRange: PUT sheets/v4/spreadsheets/{id}/values/{range}
 *
 * Authentication: OAuth 2.0 refresh-token grant against Google's global
 * token endpoint (`oauth2.googleapis.com`). The client owns its own
 * in-process access-token cache. Tokens are minted lazily on the first
 * request and refreshed transparently on 401.
 *
 * Secrets hygiene:
 *   - `clientId`, `clientSecret`, `refreshToken`, and minted access tokens
 *     are NEVER logged or echoed in errors.
 *   - Spreadsheet / sheet titles and cell values are NOT logged at warn+
 *     level so audit logs cannot leak operator-owned data.
 *
 * Boundary: this file knows nothing about NoralOS contexts. The worker
 * resolves the secret-ref, hands it in, and gets back data. Keeps the
 * client trivially testable against a mocked fetch.
 */

import {
  A1_RANGE_PATTERN,
  GOOGLE_DRIVE_API_BASE,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_SHEETS_API_BASE,
  GOOGLE_SPREADSHEET_ID_PATTERN,
  GSHEETS_DEFAULT_TIMEOUT_MS,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GoogleOAuthMaterial {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleSheetsClientConfig {
  /** Material parsed from the resolved secret-ref JSON. */
  material: GoogleOAuthMaterial;
  /** Optional override for the OAuth token URL (test seam). */
  tokenUrl?: string;
  /** Optional override for the Sheets API base (test seam). */
  sheetsApiBase?: string;
  /** Optional override for the Drive API base (test seam). */
  driveApiBase?: string;
  /** Per-call timeout in ms. Defaults to {@link GSHEETS_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Test seam. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Test seam. Defaults to `Date.now`. */
  now?: () => number;
}

export type GoogleErrorCategory =
  | "misconfigured"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "malformed"
  | "unknown";

export class GoogleProviderError extends Error {
  category: GoogleErrorCategory;
  status?: number;
  googleStatus?: string;
  constructor(
    category: GoogleErrorCategory,
    message: string,
    opts?: { status?: number; googleStatus?: string },
  ) {
    super(message);
    this.name = "GoogleProviderError";
    this.category = category;
    this.status = opts?.status;
    this.googleStatus = opts?.googleStatus;
  }
}

export interface SpreadsheetSummary {
  id: string;
  name: string;
  modifiedTime: string | null;
  webViewLink: string | null;
}

export interface ListSpreadsheetsRequest {
  /** Substring filter applied to the spreadsheet name. */
  query?: string;
  /** Max files to return (1..100, default 25). */
  limit?: number;
  /** Opaque pagination cursor from a prior response. */
  pageToken?: string;
  signal?: AbortSignal;
}

export interface ListSpreadsheetsResult {
  spreadsheets: SpreadsheetSummary[];
  /** Pagination cursor for the next page; null when there isn't one. */
  nextPageToken: string | null;
  latencyMs: number;
}

export interface SheetTabSummary {
  sheetId: number;
  title: string;
  gridRows: number | null;
  gridColumns: number | null;
}

export interface SpreadsheetDetail {
  id: string;
  title: string;
  locale: string | null;
  timeZone: string | null;
  spreadsheetUrl: string | null;
  sheets: SheetTabSummary[];
}

export interface ReadRangeRequest {
  spreadsheetId: string;
  range: string;
  /** Sheet `valueRenderOption`. Default: `FORMATTED_VALUE`. */
  valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
  signal?: AbortSignal;
}

export interface ReadRangeResult {
  range: string;
  majorDimension: "ROWS" | "COLUMNS";
  /** Cell values, row-major. Trailing empty cells are omitted by the API. */
  values: unknown[][];
  latencyMs: number;
}

export interface AppendRowsRequest {
  spreadsheetId: string;
  /** Sheet/range hint — Sheets API uses this to find the contiguous table to append below. */
  range: string;
  values: unknown[][];
  /** `valueInputOption`. Default: `USER_ENTERED` so `=SUM(...)` evaluates. */
  valueInputOption?: "RAW" | "USER_ENTERED";
  /** `insertDataOption`. Default: `INSERT_ROWS` so new rows shift existing ones down. */
  insertDataOption?: "OVERWRITE" | "INSERT_ROWS";
  signal?: AbortSignal;
}

export interface AppendRowsResult {
  spreadsheetId: string;
  /** Actual range Sheets wrote to (e.g. `Sheet1!A5:C5`). */
  updatedRange: string | null;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
  latencyMs: number;
}

export interface UpdateRangeRequest {
  spreadsheetId: string;
  range: string;
  values: unknown[][];
  /** `valueInputOption`. Default: `USER_ENTERED`. */
  valueInputOption?: "RAW" | "USER_ENTERED";
  signal?: AbortSignal;
}

export interface UpdateRangeResult {
  spreadsheetId: string;
  updatedRange: string | null;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface AccessTokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

function validateSpreadsheetId(id: string): void {
  if (!GOOGLE_SPREADSHEET_ID_PATTERN.test(id)) {
    throw new GoogleProviderError(
      "malformed",
      "Google spreadsheet ids must be 20–128 chars of [A-Za-z0-9_-].",
    );
  }
}

function validateRange(range: string): void {
  if (!A1_RANGE_PATTERN.test(range)) {
    throw new GoogleProviderError(
      "malformed",
      "Google Sheets range must be a valid A1 expression (e.g. 'Sheet1!A1:C10').",
    );
  }
}

function validateValues(values: unknown, tool: string): asserts values is unknown[][] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new GoogleProviderError(
      "malformed",
      `${tool}: values must be a non-empty 2D array of rows.`,
    );
  }
  for (let i = 0; i < values.length; i += 1) {
    const row = values[i];
    if (!Array.isArray(row)) {
      throw new GoogleProviderError(
        "malformed",
        `${tool}: values[${i}] must be an array (row).`,
      );
    }
  }
}

function classifyResponseStatus(status: number, googleStatus?: string): {
  category: GoogleErrorCategory;
  message: string;
} {
  if (status === 401 || status === 403) {
    return {
      category: "auth",
      message:
        "Google rejected the access token or scope. Check Settings → Integrations → Google Sheets and reconnect if needed.",
    };
  }
  if (status === 404) {
    return { category: "not_found", message: "Google resource not found." };
  }
  if (status === 429) {
    return { category: "rate_limit", message: "Google rate limit hit. Try again shortly." };
  }
  if (status >= 500) {
    return { category: "server", message: `Google upstream error (HTTP ${status}).` };
  }
  if (status >= 400) {
    const suffix = googleStatus ? ` [${googleStatus}]` : "";
    return {
      category: "malformed",
      message: `Google rejected the request (HTTP ${status})${suffix}.`,
    };
  }
  return { category: "unknown", message: `Unexpected Google status ${status}.` };
}

function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyOf = (AbortSignal as { any?: (sigs: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyOf === "function") return anyOf([a, b]);
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  if (a.aborted || b.aborted) merged.abort();
  else {
    a.addEventListener("abort", onAbort, { once: true });
    b.addEventListener("abort", onAbort, { once: true });
  }
  return merged.signal;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface RequestOpts {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  baseUrl: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

class GoogleRequester {
  private cache: AccessTokenCacheEntry | null = null;
  private inflightRefresh: Promise<string> | null = null;
  private readonly config: GoogleSheetsClientConfig;

  constructor(config: GoogleSheetsClientConfig) {
    this.config = config;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    const now = (this.config.now ?? Date.now)();
    if (
      !forceRefresh &&
      this.cache &&
      this.cache.expiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > now
    ) {
      return this.cache.accessToken;
    }
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.refresh();
    try {
      return await this.inflightRefresh;
    } finally {
      this.inflightRefresh = null;
    }
  }

  private async refresh(): Promise<string> {
    const tokenUrl = this.config.tokenUrl ?? GOOGLE_OAUTH_TOKEN_URL;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.material.clientId,
      client_secret: this.config.material.clientSecret,
      refresh_token: this.config.material.refreshToken,
    });

    const fetcher = this.config.fetchImpl ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? GSHEETS_DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as
        | { access_token?: string; expires_in?: number; error?: string }
        | null;
      if (!res.ok || !json || !json.access_token) {
        const safe = json?.error || `HTTP ${res.status}`;
        if (res.status === 400 && (json?.error === "invalid_grant" || safe === "invalid_grant")) {
          throw new GoogleProviderError(
            "auth",
            "Google rejected the refresh token. Reconnect from Settings → Integrations → Google Sheets.",
            { status: res.status },
          );
        }
        throw new GoogleProviderError(
          "auth",
          `Google refresh-token grant failed: ${safe}.`,
          { status: res.status },
        );
      }
      const now = (this.config.now ?? Date.now)();
      this.cache = {
        accessToken: json.access_token,
        expiresAt: now + Math.max(0, (json.expires_in ?? 3600) * 1000),
      };
      return json.access_token;
    } catch (err) {
      if (err instanceof GoogleProviderError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new GoogleProviderError(
          "timeout",
          `Google token refresh timed out after ${timeoutMs}ms.`,
        );
      }
      throw new GoogleProviderError(
        "network",
        "Could not reach Google OAuth endpoint for token refresh.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async request<T>(opts: RequestOpts): Promise<{ data: T; latencyMs: number }> {
    const fetcher = this.config.fetchImpl ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? GSHEETS_DEFAULT_TIMEOUT_MS;

    const url = new URL(`${opts.baseUrl}${opts.path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }

    let bodyInit: BodyInit | undefined;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(opts.body);
    }

    const started = (this.config.now ?? Date.now)();
    let lastErr: GoogleProviderError | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await this.getAccessToken(attempt > 0);
      headers.Authorization = `Bearer ${accessToken}`;

      const internal = new AbortController();
      const timer = setTimeout(() => internal.abort(), timeoutMs);
      const signal = opts.signal ? linkSignals(opts.signal, internal.signal) : internal.signal;
      try {
        const response = await fetcher(url, {
          method: opts.method,
          headers,
          body: bodyInit,
          signal,
        });
        const text = await response.text();
        if (response.status === 204 || text.length === 0) {
          return {
            data: {} as T,
            latencyMs: (this.config.now ?? Date.now)() - started,
          };
        }
        const parsed = safeJsonParse(text);
        if (!response.ok) {
          const googleStatus =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? extractGoogleStatus(parsed as Record<string, unknown>)
              : undefined;
          const { category, message } = classifyResponseStatus(response.status, googleStatus);
          const err = new GoogleProviderError(category, message, {
            status: response.status,
            googleStatus,
          });
          if (response.status === 401 && attempt === 0) {
            lastErr = err;
            continue;
          }
          throw err;
        }
        return {
          data: parsed as T,
          latencyMs: (this.config.now ?? Date.now)() - started,
        };
      } catch (err) {
        if (err instanceof GoogleProviderError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new GoogleProviderError(
            "timeout",
            `Google request timed out after ${timeoutMs}ms.`,
          );
        }
        throw new GoogleProviderError(
          "network",
          "Could not reach Google. Verify network connectivity from the NoralOS server.",
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr ?? new GoogleProviderError("unknown", "Google request failed.");
  }
}

function extractGoogleStatus(payload: Record<string, unknown>): string | undefined {
  // Google's standard error envelope:
  //   { error: { code: 403, message: "...", status: "PERMISSION_DENIED" } }
  const error = payload.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const status = (error as Record<string, unknown>).status;
    if (typeof status === "string") return status;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Field-shaping helpers
// ---------------------------------------------------------------------------

function readSpreadsheetSummary(raw: unknown): SpreadsheetSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  const name = typeof o.name === "string" ? o.name : null;
  if (!id || !name) return null;
  return {
    id,
    name,
    modifiedTime: typeof o.modifiedTime === "string" ? o.modifiedTime : null,
    webViewLink: typeof o.webViewLink === "string" ? o.webViewLink : null,
  };
}

function readSheetTab(raw: unknown): SheetTabSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const props = (o.properties && typeof o.properties === "object" && !Array.isArray(o.properties)
    ? (o.properties as Record<string, unknown>)
    : null);
  if (!props) return null;
  const sheetId = typeof props.sheetId === "number" ? props.sheetId : null;
  const title = typeof props.title === "string" ? props.title : null;
  if (sheetId === null || !title) return null;
  const grid =
    props.gridProperties && typeof props.gridProperties === "object" && !Array.isArray(props.gridProperties)
      ? (props.gridProperties as Record<string, unknown>)
      : null;
  return {
    sheetId,
    title,
    gridRows: grid && typeof grid.rowCount === "number" ? grid.rowCount : null,
    gridColumns: grid && typeof grid.columnCount === "number" ? grid.columnCount : null,
  };
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

export function createGoogleSheetsClient(config: GoogleSheetsClientConfig) {
  if (
    !config.material?.clientId ||
    !config.material?.clientSecret ||
    !config.material?.refreshToken
  ) {
    throw new GoogleProviderError(
      "misconfigured",
      "Google credential material is missing clientId, clientSecret, or refreshToken.",
    );
  }
  const requester = new GoogleRequester(config);
  const sheetsBase = config.sheetsApiBase ?? GOOGLE_SHEETS_API_BASE;
  const driveBase = config.driveApiBase ?? GOOGLE_DRIVE_API_BASE;

  async function listSpreadsheets(
    req: ListSpreadsheetsRequest = {},
  ): Promise<ListSpreadsheetsResult> {
    const pageSize = Math.min(Math.max(req.limit ?? 25, 1), 100);
    // Drive's q filter: only spreadsheets, optional name-contains.
    const qParts = ["mimeType='application/vnd.google-apps.spreadsheet'", "trashed=false"];
    if (req.query) {
      const escaped = req.query.replace(/'/g, "\\'");
      qParts.push(`name contains '${escaped}'`);
    }
    const { data, latencyMs } = await requester.request<{
      files?: unknown[];
      nextPageToken?: string;
    }>({
      method: "GET",
      baseUrl: driveBase,
      path: "/files",
      query: {
        q: qParts.join(" and "),
        pageSize,
        fields: "files(id,name,modifiedTime,webViewLink),nextPageToken",
        pageToken: req.pageToken,
        orderBy: "modifiedTime desc",
      },
      signal: req.signal,
    });
    const files = Array.isArray(data.files) ? data.files : [];
    const spreadsheets = files
      .map(readSpreadsheetSummary)
      .filter((s): s is SpreadsheetSummary => s !== null);
    return {
      spreadsheets,
      nextPageToken: typeof data.nextPageToken === "string" ? data.nextPageToken : null,
      latencyMs,
    };
  }

  async function getSpreadsheet(
    spreadsheetId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<SpreadsheetDetail> {
    validateSpreadsheetId(spreadsheetId);
    const { data } = await requester.request<{
      spreadsheetId?: string;
      properties?: { title?: string; locale?: string; timeZone?: string };
      sheets?: unknown[];
      spreadsheetUrl?: string;
    }>({
      method: "GET",
      baseUrl: sheetsBase,
      path: `/spreadsheets/${spreadsheetId}`,
      query: { includeGridData: "false" },
      signal: opts?.signal,
    });
    const sheets = (Array.isArray(data.sheets) ? data.sheets : [])
      .map(readSheetTab)
      .filter((s): s is SheetTabSummary => s !== null);
    return {
      id: data.spreadsheetId ?? spreadsheetId,
      title: data.properties?.title ?? "",
      locale: data.properties?.locale ?? null,
      timeZone: data.properties?.timeZone ?? null,
      spreadsheetUrl: data.spreadsheetUrl ?? null,
      sheets,
    };
  }

  async function readRange(req: ReadRangeRequest): Promise<ReadRangeResult> {
    validateSpreadsheetId(req.spreadsheetId);
    validateRange(req.range);
    const { data, latencyMs } = await requester.request<{
      range?: string;
      majorDimension?: string;
      values?: unknown[][];
    }>({
      method: "GET",
      baseUrl: sheetsBase,
      // The range MUST be URL-encoded — quoted sheet names contain `!` and `'`.
      path: `/spreadsheets/${req.spreadsheetId}/values/${encodeURIComponent(req.range)}`,
      query: {
        valueRenderOption: req.valueRenderOption ?? "FORMATTED_VALUE",
      },
      signal: req.signal,
    });
    return {
      range: data.range ?? req.range,
      majorDimension:
        data.majorDimension === "COLUMNS" ? "COLUMNS" : "ROWS",
      values: Array.isArray(data.values) ? data.values : [],
      latencyMs,
    };
  }

  async function appendRows(req: AppendRowsRequest): Promise<AppendRowsResult> {
    validateSpreadsheetId(req.spreadsheetId);
    validateRange(req.range);
    validateValues(req.values, "gsheets_append_rows");
    const { data, latencyMs } = await requester.request<{
      updates?: {
        updatedRange?: string;
        updatedRows?: number;
        updatedColumns?: number;
        updatedCells?: number;
      };
    }>({
      method: "POST",
      baseUrl: sheetsBase,
      path: `/spreadsheets/${req.spreadsheetId}/values/${encodeURIComponent(req.range)}:append`,
      query: {
        valueInputOption: req.valueInputOption ?? "USER_ENTERED",
        insertDataOption: req.insertDataOption ?? "INSERT_ROWS",
      },
      body: { values: req.values },
      signal: req.signal,
    });
    const updates = data.updates ?? {};
    return {
      spreadsheetId: req.spreadsheetId,
      updatedRange: typeof updates.updatedRange === "string" ? updates.updatedRange : null,
      updatedRows: typeof updates.updatedRows === "number" ? updates.updatedRows : 0,
      updatedColumns: typeof updates.updatedColumns === "number" ? updates.updatedColumns : 0,
      updatedCells: typeof updates.updatedCells === "number" ? updates.updatedCells : 0,
      latencyMs,
    };
  }

  async function updateRange(req: UpdateRangeRequest): Promise<UpdateRangeResult> {
    validateSpreadsheetId(req.spreadsheetId);
    validateRange(req.range);
    validateValues(req.values, "gsheets_update_range");
    const { data, latencyMs } = await requester.request<{
      updatedRange?: string;
      updatedRows?: number;
      updatedColumns?: number;
      updatedCells?: number;
    }>({
      method: "PUT",
      baseUrl: sheetsBase,
      path: `/spreadsheets/${req.spreadsheetId}/values/${encodeURIComponent(req.range)}`,
      query: {
        valueInputOption: req.valueInputOption ?? "USER_ENTERED",
      },
      body: { range: req.range, majorDimension: "ROWS", values: req.values },
      signal: req.signal,
    });
    return {
      spreadsheetId: req.spreadsheetId,
      updatedRange: typeof data.updatedRange === "string" ? data.updatedRange : null,
      updatedRows: typeof data.updatedRows === "number" ? data.updatedRows : 0,
      updatedColumns: typeof data.updatedColumns === "number" ? data.updatedColumns : 0,
      updatedCells: typeof data.updatedCells === "number" ? data.updatedCells : 0,
      latencyMs,
    };
  }

  return {
    listSpreadsheets,
    getSpreadsheet,
    readRange,
    appendRows,
    updateRange,
    _internals: { requester },
  };
}

export type GoogleSheetsClient = ReturnType<typeof createGoogleSheetsClient>;
