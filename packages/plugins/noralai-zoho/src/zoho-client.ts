/**
 * Zoho CRM REST client used by the noralai-zoho worker.
 *
 * Covers the v0.1.0 surface:
 *   - listModules: GET /crm/v7/settings/modules
 *   - searchRecords: GET /crm/v7/{Module}/search
 *   - getRecord: GET /crm/v7/{Module}/{id}
 *   - createRecord: POST /crm/v7/{Module}
 *   - updateRecord: PATCH /crm/v7/{Module}/{id}
 *
 * Authentication: OAuth 2.0 refresh-token grant. The client owns its own
 * in-process access-token cache, identical in shape to the server-side
 * `oauthService` cache but isolated per plugin worker. Tokens are minted
 * lazily on the first request and refreshed transparently on 401.
 *
 * Secrets hygiene:
 *   - `clientId`, `clientSecret`, `refreshToken`, and minted access tokens
 *     are NEVER logged or echoed in errors.
 *   - The `apiDomain` is identifying-but-non-secret — included in error
 *     context so operators can tell which Zoho DC a failure belongs to.
 *   - Zoho response bodies are inspected for `code`/`message` to populate
 *     the category and a hand-shaped error message. Raw upstream bodies
 *     are not surfaced to callers.
 *
 * Boundary: this file knows nothing about NoralOS contexts. The worker
 * resolves the secret-ref and dataCenter, hands them in, and gets back
 * data. That keeps the client trivially testable against a mocked fetch.
 */

import {
  ZOHO_ACCOUNTS_HOST_BY_DC,
  ZOHO_API_HOST_BY_DC,
  ZOHO_DEFAULT_TIMEOUT_MS,
  ZOHO_MODULE_NAME_PATTERN,
  type ZohoDataCenter,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ZohoOAuthMaterial {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface ZohoClientConfig {
  /** Material parsed from the resolved secret-ref JSON. */
  material: ZohoOAuthMaterial;
  /** Data center key (`us`, `eu`, etc.) — derives accounts + API host when overrides aren't set. */
  dataCenter: ZohoDataCenter;
  /** Optional override for the API host (e.g. when Zoho returned a non-default apiDomain on the callback). */
  apiDomain?: string;
  /** Optional override for the accounts server (rare — primarily for tests). */
  accountsHost?: string;
  /** Per-call timeout in ms. Defaults to {@link ZOHO_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Test seam. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Test seam. Defaults to `Date.now`. */
  now?: () => number;
}

export type ZohoErrorCategory =
  | "misconfigured"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "malformed"
  | "unknown";

export class ZohoProviderError extends Error {
  category: ZohoErrorCategory;
  status?: number;
  zohoCode?: string;
  constructor(
    category: ZohoErrorCategory,
    message: string,
    opts?: { status?: number; zohoCode?: string },
  ) {
    super(message);
    this.name = "ZohoProviderError";
    this.category = category;
    this.status = opts?.status;
    this.zohoCode = opts?.zohoCode;
  }
}

export interface ZohoModuleSummary {
  apiName: string;
  displayName: string;
  /** True for built-in modules (Leads, Contacts, …); false for org-specific custom modules. */
  generatedByCustomization: boolean;
  /** True when the calling org has at least read access on this module. */
  viewable: boolean;
  /** True when the calling org can create new records. */
  creatable: boolean;
  /** True when the calling org can patch existing records. */
  editable: boolean;
}

export interface ZohoRecord {
  id: string;
  /** Display name Zoho computed for the record (best-effort; may be empty on minimal payloads). */
  name: string | null;
  /** All other fields as-returned by Zoho. */
  fields: Record<string, unknown>;
}

export interface SearchRecordsRequest {
  module: string;
  /** Pre-formed Zoho criteria string (e.g. `(Last_Name:equals:Doe)`). Mutually exclusive with the other filters. */
  criteria?: string;
  /** Free-text word search across indexed fields. */
  word?: string;
  /** Exact-match email search. */
  email?: string;
  /** Exact-match phone search. */
  phone?: string;
  /** Max records to return (1..200, default 20). */
  limit?: number;
  /** 1-indexed page number (default 1). */
  page?: number;
  signal?: AbortSignal;
}

export interface SearchRecordsResult {
  records: ZohoRecord[];
  /** True if Zoho indicates more pages exist for this query. */
  moreRecords: boolean;
  latencyMs: number;
}

export interface CreateRecordRequest {
  module: string;
  /** Field-name → value map. Values follow Zoho's typing (string/number/bool/null/object). */
  values: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface UpdateRecordRequest {
  module: string;
  id: string;
  values: Record<string, unknown>;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface AccessTokenCacheEntry {
  accessToken: string;
  /** Unix-ms epoch when the token expires. */
  expiresAt: number;
}

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

function resolveApiDomain(config: ZohoClientConfig): string {
  if (config.apiDomain && /^https:\/\//i.test(config.apiDomain)) {
    return config.apiDomain.replace(/\/+$/, "");
  }
  const host = ZOHO_API_HOST_BY_DC[config.dataCenter];
  if (!host) {
    throw new ZohoProviderError(
      "misconfigured",
      `Zoho dataCenter '${config.dataCenter}' is not a recognised value.`,
    );
  }
  return host;
}

function resolveAccountsHost(config: ZohoClientConfig): string {
  if (config.accountsHost && /^https:\/\//i.test(config.accountsHost)) {
    return config.accountsHost.replace(/\/+$/, "");
  }
  const host = ZOHO_ACCOUNTS_HOST_BY_DC[config.dataCenter];
  if (!host) {
    throw new ZohoProviderError(
      "misconfigured",
      `Zoho dataCenter '${config.dataCenter}' has no accounts host mapping.`,
    );
  }
  return host;
}

function validateModule(module: string): void {
  if (!ZOHO_MODULE_NAME_PATTERN.test(module)) {
    throw new ZohoProviderError(
      "malformed",
      "Zoho module names must be alphanumeric with underscores (e.g. 'Leads', 'Custom_Module_1').",
    );
  }
}

function validateId(id: string): void {
  if (!/^[0-9]{1,32}$/.test(id)) {
    throw new ZohoProviderError(
      "malformed",
      "Zoho record ids must be numeric strings (1..32 digits).",
    );
  }
}

function classifyResponseStatus(status: number, zohoCode?: string): {
  category: ZohoErrorCategory;
  message: string;
} {
  if (status === 401 || status === 403) {
    return {
      category: "auth",
      message:
        "Zoho rejected the access token. Check Settings → Integrations → Zoho CRM and reconnect if needed.",
    };
  }
  if (status === 404) {
    return { category: "not_found", message: "Zoho resource not found." };
  }
  if (status === 429) {
    return {
      category: "rate_limit",
      message: "Zoho rate limit hit. Try again shortly.",
    };
  }
  if (status >= 500) {
    return { category: "server", message: `Zoho upstream error (HTTP ${status}).` };
  }
  if (status >= 400) {
    const suffix = zohoCode ? ` [${zohoCode}]` : "";
    return {
      category: "malformed",
      message: `Zoho rejected the request (HTTP ${status})${suffix}.`,
    };
  }
  return { category: "unknown", message: `Unexpected Zoho status ${status}.` };
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

interface ZohoRequestOpts {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Force a token refresh before this call (used by the 401-retry path). */
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

/**
 * Encapsulates per-config request state. Created once per client instance
 * so the access-token cache survives across calls.
 */
class ZohoRequester {
  private cache: AccessTokenCacheEntry | null = null;
  private inflightRefresh: Promise<string> | null = null;
  private readonly config: ZohoClientConfig;

  constructor(config: ZohoClientConfig) {
    this.config = config;
  }

  /**
   * Return a valid access token, refreshing if the cache is empty or
   * about to expire. Coalesces concurrent refresh attempts so a burst
   * of tool calls doesn't trigger a burst of refreshes.
   */
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
    const accountsHost = resolveAccountsHost(this.config);
    const tokenUrl = `${accountsHost}/oauth/v2/token`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.material.clientId,
      client_secret: this.config.material.clientSecret,
      refresh_token: this.config.material.refreshToken,
    });

    const fetcher = this.config.fetchImpl ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? ZOHO_DEFAULT_TIMEOUT_MS;
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
          throw new ZohoProviderError(
            "auth",
            "Zoho rejected the refresh token. Reconnect from Settings → Integrations → Zoho CRM.",
            { status: res.status },
          );
        }
        throw new ZohoProviderError(
          "auth",
          `Zoho refresh-token grant failed: ${safe}.`,
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
      if (err instanceof ZohoProviderError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ZohoProviderError(
          "timeout",
          `Zoho token refresh timed out after ${timeoutMs}ms.`,
        );
      }
      throw new ZohoProviderError(
        "network",
        "Could not reach Zoho accounts server for token refresh.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async request<T>(opts: ZohoRequestOpts): Promise<{ data: T; latencyMs: number }> {
    const apiDomain = resolveApiDomain(this.config);
    const fetcher = this.config.fetchImpl ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? ZOHO_DEFAULT_TIMEOUT_MS;

    const url = new URL(`${apiDomain}${opts.path}`);
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
    let triedRefresh = !!opts.forceRefresh;
    let lastErr: ZohoProviderError | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Force-refresh on the retry pass (attempt > 0) OR when the caller
      // explicitly asked. First-attempt forceRefresh covers the case where
      // an upstream caller already knows the cached token is stale.
      const forceRefresh = attempt > 0 || (opts.forceRefresh === true && attempt === 0);
      const accessToken = await this.getAccessToken(forceRefresh);
      headers.Authorization = `Zoho-oauthtoken ${accessToken}`;

      const internal = new AbortController();
      const timer = setTimeout(() => internal.abort(), timeoutMs);
      const signal = opts.signal
        ? linkSignals(opts.signal, internal.signal)
        : internal.signal;
      try {
        const response = await fetcher(url, {
          method: opts.method,
          headers,
          body: bodyInit,
          signal,
        });
        const text = await response.text();
        const parsed: unknown = text ? safeJsonParse(text) : {};
        if (response.status === 204 || text.length === 0) {
          return {
            data: {} as T,
            latencyMs: (this.config.now ?? Date.now)() - started,
          };
        }
        if (!response.ok) {
          const zohoCode =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? typeof (parsed as Record<string, unknown>).code === "string"
                ? ((parsed as Record<string, unknown>).code as string)
                : undefined
              : undefined;
          const { category, message } = classifyResponseStatus(response.status, zohoCode);
          const err = new ZohoProviderError(category, message, {
            status: response.status,
            zohoCode,
          });
          // 401 once → force-refresh then retry. Don't retry on 401 with a
          // ZohoProviderError category of `auth` from refresh itself —
          // that path already throws above.
          if (response.status === 401 && !triedRefresh) {
            triedRefresh = true;
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
        if (err instanceof ZohoProviderError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new ZohoProviderError(
            "timeout",
            `Zoho request timed out after ${timeoutMs}ms.`,
          );
        }
        throw new ZohoProviderError(
          "network",
          "Could not reach Zoho. Verify network connectivity from the NoralOS server.",
        );
      } finally {
        clearTimeout(timer);
      }
    }

    // Unreachable in practice — the loop either returns or throws — but
    // typed defensively for the second-attempt path.
    throw lastErr ?? new ZohoProviderError("unknown", "Zoho request failed.");
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Field-shaping helpers
// ---------------------------------------------------------------------------

function readRecord(raw: unknown): ZohoRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return null;
  const name = typeof o.Full_Name === "string"
    ? o.Full_Name
    : typeof o.Last_Name === "string"
      ? o.Last_Name
      : typeof o.Name === "string"
        ? o.Name
        : typeof o.Account_Name === "string"
          ? o.Account_Name
          : typeof o.Deal_Name === "string"
            ? o.Deal_Name
            : null;
  return { id, name, fields: o };
}

function readModule(raw: unknown): ZohoModuleSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const apiName = typeof o.api_name === "string" ? o.api_name : null;
  if (!apiName) return null;
  const displayName =
    typeof o.plural_label === "string"
      ? o.plural_label
      : typeof o.singular_label === "string"
        ? o.singular_label
        : apiName;
  return {
    apiName,
    displayName,
    generatedByCustomization: o.generated_type === "custom",
    viewable: o.viewable === true,
    creatable: o.creatable === true,
    editable: o.editable === true,
  };
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

export function createZohoClient(config: ZohoClientConfig) {
  // Validate up front so a misconfigured client surfaces immediately
  // rather than on the first network call.
  if (
    !config.material?.clientId ||
    !config.material?.clientSecret ||
    !config.material?.refreshToken
  ) {
    throw new ZohoProviderError(
      "misconfigured",
      "Zoho credential material is missing clientId, clientSecret, or refreshToken.",
    );
  }
  if (!ZOHO_API_HOST_BY_DC[config.dataCenter]) {
    throw new ZohoProviderError(
      "misconfigured",
      `Zoho dataCenter '${config.dataCenter}' is not recognised (expected: us, eu, in, au, jp, ca).`,
    );
  }
  const requester = new ZohoRequester(config);

  async function listModules(opts?: { signal?: AbortSignal }) {
    const { data, latencyMs } = await requester.request<{ modules?: unknown[] }>({
      method: "GET",
      path: "/crm/v7/settings/modules",
      signal: opts?.signal,
    });
    const list = Array.isArray(data.modules) ? data.modules : [];
    const modules = list
      .map(readModule)
      .filter((m): m is ZohoModuleSummary => m !== null);
    return { modules, latencyMs };
  }

  async function searchRecords(req: SearchRecordsRequest): Promise<SearchRecordsResult> {
    validateModule(req.module);
    const filters = [req.criteria, req.word, req.email, req.phone].filter(
      (v) => typeof v === "string" && v.length > 0,
    );
    if (filters.length === 0) {
      throw new ZohoProviderError(
        "malformed",
        "zoho_search_records requires at least one of: criteria, word, email, phone.",
      );
    }
    if (filters.length > 1) {
      throw new ZohoProviderError(
        "malformed",
        "zoho_search_records accepts only one of: criteria, word, email, phone — pick one.",
      );
    }
    const limit = Math.min(Math.max(req.limit ?? 20, 1), 200);
    const page = Math.max(req.page ?? 1, 1);
    const query: Record<string, string | number | undefined> = {
      per_page: limit,
      page,
    };
    if (req.criteria) query.criteria = req.criteria;
    if (req.word) query.word = req.word;
    if (req.email) query.email = req.email;
    if (req.phone) query.phone = req.phone;

    const { data, latencyMs } = await requester.request<{
      data?: unknown[];
      info?: { more_records?: boolean };
    }>({
      method: "GET",
      path: `/crm/v7/${req.module}/search`,
      query,
      signal: req.signal,
    });
    const records = (Array.isArray(data.data) ? data.data : [])
      .map(readRecord)
      .filter((r): r is ZohoRecord => r !== null);
    return {
      records,
      moreRecords: data.info?.more_records === true,
      latencyMs,
    };
  }

  async function getRecord(
    module: string,
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ZohoRecord> {
    validateModule(module);
    validateId(id);
    const { data } = await requester.request<{ data?: unknown[] }>({
      method: "GET",
      path: `/crm/v7/${module}/${id}`,
      signal: opts?.signal,
    });
    const first = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : null;
    const record = readRecord(first);
    if (!record) {
      throw new ZohoProviderError(
        "not_found",
        `Zoho returned no record for ${module}/${id}.`,
      );
    }
    return record;
  }

  async function createRecord(req: CreateRecordRequest): Promise<ZohoRecord> {
    validateModule(req.module);
    if (!req.values || typeof req.values !== "object" || Array.isArray(req.values)) {
      throw new ZohoProviderError(
        "malformed",
        "zoho_create_record.values must be a non-empty object.",
      );
    }
    if (Object.keys(req.values).length === 0) {
      throw new ZohoProviderError(
        "malformed",
        "zoho_create_record.values must include at least one field.",
      );
    }
    const { data } = await requester.request<{ data?: unknown[] }>({
      method: "POST",
      path: `/crm/v7/${req.module}`,
      body: { data: [req.values] },
      signal: req.signal,
    });
    const first = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : null;
    return interpretMutationResult(first, req.module);
  }

  async function updateRecord(req: UpdateRecordRequest): Promise<ZohoRecord> {
    validateModule(req.module);
    validateId(req.id);
    if (!req.values || typeof req.values !== "object" || Array.isArray(req.values)) {
      throw new ZohoProviderError(
        "malformed",
        "zoho_update_record.values must be a non-empty object.",
      );
    }
    if (Object.keys(req.values).length === 0) {
      throw new ZohoProviderError(
        "malformed",
        "zoho_update_record.values must include at least one field.",
      );
    }
    const { data } = await requester.request<{ data?: unknown[] }>({
      method: "PATCH",
      path: `/crm/v7/${req.module}/${req.id}`,
      body: { data: [{ id: req.id, ...req.values }] },
      signal: req.signal,
    });
    const first = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : null;
    return interpretMutationResult(first, req.module, req.id);
  }

  return {
    listModules,
    searchRecords,
    getRecord,
    createRecord,
    updateRecord,
    /** Test seam — lets tests assert that token caching works. */
    _internals: { requester },
  };
}

function interpretMutationResult(
  raw: unknown,
  module: string,
  fallbackId?: string,
): ZohoRecord {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const status = typeof o.status === "string" ? o.status : null;
    if (status && status !== "success") {
      const message = typeof o.message === "string" ? o.message : "Zoho rejected the write.";
      const code = typeof o.code === "string" ? o.code : undefined;
      throw new ZohoProviderError(
        code === "DUPLICATE_DATA" ? "malformed" : code === "MANDATORY_NOT_FOUND" ? "malformed" : "malformed",
        `Zoho ${module}: ${message}`,
        { zohoCode: code },
      );
    }
    const details = o.details && typeof o.details === "object" && !Array.isArray(o.details)
      ? (o.details as Record<string, unknown>)
      : null;
    const id =
      typeof details?.id === "string"
        ? (details.id as string)
        : fallbackId ?? null;
    if (!id) {
      throw new ZohoProviderError(
        "malformed",
        `Zoho ${module}: write succeeded but no id was returned.`,
      );
    }
    return { id, name: null, fields: details ?? {} };
  }
  throw new ZohoProviderError(
    "malformed",
    `Zoho ${module}: unexpected write response shape.`,
  );
}

export type ZohoClient = ReturnType<typeof createZohoClient>;
