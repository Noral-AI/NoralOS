import type { Db } from "@noralos/db";
import {
  INTEGRATION_PROVIDERS,
  ZOHO_DATA_CENTER_TLD,
  type IntegrationOAuthSpec,
  type IntegrationProvider,
} from "@noralos/shared";
import { unprocessable } from "../../errors.js";
import { secretService } from "../secrets.js";

/**
 * OAuth 2.0 authorization-code service for `integration_credentials`.
 *
 * Responsibilities:
 *   1. Build the provider authorize URL (`buildAuthorizeUrl`).
 *   2. Exchange a returned `code` for a refresh+access token pair
 *      (`exchangeCodeForTokens`).
 *   3. Maintain an in-process access-token cache keyed by credential id,
 *      and mint fresh access tokens by exchanging the persisted refresh
 *      token on demand (`getAccessToken`).
 *
 * The encrypted material for an OAuth credential is a JSON blob:
 *   { clientId, clientSecret, refreshToken? }
 * `refreshToken` is absent for a freshly-created draft and populated by
 * the callback. Access tokens are NEVER persisted — they live in the
 * in-process cache with a per-mint TTL and a small safety skew so we
 * refresh slightly before expiry.
 */

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

export interface OAuthMaterial {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

/** Result of a token exchange or refresh call. */
export interface OAuthTokenResponse {
  accessToken: string;
  /** Unix epoch ms when this access token will expire. */
  expiresAt: number;
  /** Returned by the provider only on initial code exchange; absent on refresh. */
  refreshToken?: string;
  /** Provider-specific extras (e.g. `api_domain`). */
  raw: Record<string, unknown>;
}

interface AccessTokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const accessTokenCache = new Map<string, AccessTokenCacheEntry>();

export function clearAccessTokenCache(credentialId?: string) {
  if (credentialId) accessTokenCache.delete(credentialId);
  else accessTokenCache.clear();
}

export function _peekAccessTokenCache(credentialId: string): AccessTokenCacheEntry | undefined {
  return accessTokenCache.get(credentialId);
}

export function _setAccessTokenCache(credentialId: string, entry: AccessTokenCacheEntry) {
  accessTokenCache.set(credentialId, entry);
}

/** Render a `{var}`-style template against a substitution map. */
export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      throw unprocessable(`OAuth template missing variable: ${key}`);
    }
    return v;
  });
}

function ensureOAuthProvider(providerId: string): {
  provider: IntegrationProvider;
  oauth: IntegrationOAuthSpec;
} {
  const provider = INTEGRATION_PROVIDERS[providerId];
  if (!provider) throw unprocessable(`Unknown integration provider: ${providerId}`);
  if (!provider.oauth) {
    throw unprocessable(`Provider ${providerId} is not an OAuth provider`);
  }
  return { provider, oauth: provider.oauth };
}

/**
 * Resolve the `accountsServer` value for templating. Zoho's authorize
 * endpoint and token endpoint live on the per-data-center accounts
 * server. The data center is captured in `metadata.fields.dataCenter`
 * at credential-create time. On callback Zoho echoes `accounts-server`
 * which can override this if the user's account lives in a different DC
 * than the admin chose at create time (rare but possible).
 */
function resolveAccountsServer(
  oauth: IntegrationOAuthSpec,
  fields: Record<string, string>,
  override: string | undefined,
): string | undefined {
  if (override && /^https:\/\//.test(override)) return override;
  if (!oauth.defaultAccountsServerByField) return undefined;
  for (const [fieldKey, fieldValue] of Object.entries(fields)) {
    const lookup = oauth.defaultAccountsServerByField[`${fieldKey}:${fieldValue}`];
    if (lookup) return lookup;
  }
  return undefined;
}

export interface BuildAuthorizeUrlInput {
  providerId: string;
  /** Non-secret text fields collected at create time (e.g. `{ dataCenter: "us" }`). */
  fields: Record<string, string>;
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const { oauth } = ensureOAuthProvider(input.providerId);

  // Provider-specific synthetic substitutions. Zoho's authorize URL needs
  // the TLD of its accounts server. We don't bake the URL itself in the
  // template because it has structural placeholders (`{clientId}` etc.)
  // that consumers expect to see.
  const dataCenter = input.fields["dataCenter"];
  const dataCenterTld = dataCenter ? ZOHO_DATA_CENTER_TLD[dataCenter] : undefined;

  // RFC 6749 says scopes are space-separated; Zoho historically required
  // commas, so we default to comma for back-compat and let standards-
  // compliant providers (Google, etc.) override via `scopeSeparator`.
  const scopeSeparator = oauth.scopeSeparator ?? ",";
  const vars: Record<string, string | undefined> = {
    clientId: encodeURIComponent(input.clientId),
    redirectUri: encodeURIComponent(input.redirectUri),
    scopes: encodeURIComponent(oauth.scopes.join(scopeSeparator)),
    state: encodeURIComponent(input.state),
    dataCenterTld,
    ...Object.fromEntries(
      Object.entries(input.fields).map(([k, v]) => [k, encodeURIComponent(v)]),
    ),
  };

  let url = renderTemplate(oauth.authorizeUrlTemplate, vars);
  const extras = oauth.extraAuthorizeParams;
  if (extras && Object.keys(extras).length > 0) {
    const qs = Object.entries(extras)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    url += (url.includes("?") ? "&" : "?") + qs;
  }
  return url;
}

export interface ExchangeCodeInput {
  providerId: string;
  code: string;
  fields: Record<string, string>;
  /** From the callback query if the provider echoes one. */
  accountsServerOverride?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Test seam — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface ProviderTokenResponseJson {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_domain?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
}

/**
 * Exchange an authorization code for an access+refresh token pair.
 * Returns the canonicalized response. Throws `unprocessable` with a
 * safe message on any provider-side error (never leaks `client_secret`
 * or `code` into the message).
 */
export async function exchangeCodeForTokens(
  input: ExchangeCodeInput,
): Promise<OAuthTokenResponse> {
  const { oauth } = ensureOAuthProvider(input.providerId);
  const accountsServer = resolveAccountsServer(
    oauth,
    input.fields,
    input.accountsServerOverride,
  );
  if (!accountsServer && oauth.tokenUrlTemplate.includes("{accountsServer}")) {
    throw unprocessable("Could not resolve accounts server for OAuth token exchange");
  }
  const tokenUrl = renderTemplate(oauth.tokenUrlTemplate, {
    accountsServer: accountsServer ?? "",
    ...input.fields,
  });

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });

  const fetcher = input.fetchImpl ?? fetch;
  const res = await fetcher(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => null)) as ProviderTokenResponseJson | null;
  if (!res.ok || !json || !json.access_token) {
    const safe = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw unprocessable(`OAuth token exchange failed: ${safe}`);
  }
  if (!json.refresh_token) {
    // Some providers only mint refresh_token when access_type=offline +
    // prompt=consent are set. Surface a clear failure rather than silently
    // saving an unusable credential.
    throw unprocessable(
      "OAuth provider did not return a refresh token. Make sure offline access and consent are requested.",
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 3600) * 1000),
    raw: json as Record<string, unknown>,
  };
}

export interface RefreshAccessTokenInput {
  providerId: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fields: Record<string, string>;
  accountsServerOverride?: string;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(
  input: RefreshAccessTokenInput,
): Promise<OAuthTokenResponse> {
  const { oauth } = ensureOAuthProvider(input.providerId);
  const accountsServer = resolveAccountsServer(
    oauth,
    input.fields,
    input.accountsServerOverride,
  );
  if (!accountsServer && oauth.tokenUrlTemplate.includes("{accountsServer}")) {
    throw unprocessable("Could not resolve accounts server for OAuth token refresh");
  }
  const tokenUrl = renderTemplate(oauth.tokenUrlTemplate, {
    accountsServer: accountsServer ?? "",
    ...input.fields,
  });

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });

  const fetcher = input.fetchImpl ?? fetch;
  const res = await fetcher(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => null)) as ProviderTokenResponseJson | null;
  if (!res.ok || !json || !json.access_token) {
    const safe = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw unprocessable(`OAuth token refresh failed: ${safe}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 3600) * 1000),
    raw: json as Record<string, unknown>,
  };
}

/**
 * On-demand access-token resolver for plugins that need to call an OAuth
 * provider's API. Looks at the per-credential cache first, returns a
 * cached access token if it still has at least the refresh skew left,
 * otherwise refreshes using the persisted refresh token.
 *
 * NEVER persist the result — it's intentionally in-process.
 */
export function oauthService(db: Db) {
  const secretSvc = secretService(db);

  async function loadMaterial(
    companyId: string,
    secretId: string,
  ): Promise<OAuthMaterial> {
    const raw = await secretSvc.resolveSecretValue(companyId, secretId, "latest");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw unprocessable("OAuth credential material is not valid JSON");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).clientId !== "string" ||
      typeof (parsed as Record<string, unknown>).clientSecret !== "string"
    ) {
      throw unprocessable("OAuth credential material missing clientId/clientSecret");
    }
    return parsed as OAuthMaterial;
  }

  return {
    loadMaterial,

    async getAccessToken(opts: {
      credentialId: string;
      companyId: string;
      secretId: string;
      providerId: string;
      fields: Record<string, string>;
      apiDomain?: string;
      fetchImpl?: typeof fetch;
    }): Promise<string> {
      const cached = accessTokenCache.get(opts.credentialId);
      if (cached && cached.expiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS > Date.now()) {
        return cached.accessToken;
      }
      const material = await loadMaterial(opts.companyId, opts.secretId);
      if (!material.refreshToken) {
        throw unprocessable(
          "OAuth credential has no refresh token. Reconnect from Settings → Integrations.",
        );
      }
      const refreshed = await refreshAccessToken({
        providerId: opts.providerId,
        refreshToken: material.refreshToken,
        clientId: material.clientId,
        clientSecret: material.clientSecret,
        fields: opts.fields,
        fetchImpl: opts.fetchImpl,
      });
      accessTokenCache.set(opts.credentialId, {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      });
      return refreshed.accessToken;
    },
  };
}

export type OAuthService = ReturnType<typeof oauthService>;
