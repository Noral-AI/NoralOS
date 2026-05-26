import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  renderTemplate,
  clearAccessTokenCache,
} from "../services/integrations/oauth.js";

describe("integrations-oauth service", () => {
  afterEach(() => {
    clearAccessTokenCache();
    vi.restoreAllMocks();
  });

  describe("renderTemplate", () => {
    it("substitutes single-pass {var} placeholders", () => {
      expect(renderTemplate("a={a}&b={b}", { a: "1", b: "2" })).toBe("a=1&b=2");
    });
    it("throws when a placeholder is missing — surfaces config bugs early", () => {
      expect(() => renderTemplate("x={missing}", {})).toThrow();
    });
    it("ignores non-placeholder braces in literal text", () => {
      expect(renderTemplate("hello", {})).toBe("hello");
    });
  });

  describe("buildAuthorizeUrl for zoho", () => {
    it("renders the Zoho authorize URL with correct TLD and scopes", () => {
      const url = buildAuthorizeUrl({
        providerId: "zoho",
        fields: { dataCenter: "us" },
        clientId: "1000.ABC",
        redirectUri: "https://noralos.example/api/integrations/oauth/zoho/callback",
        state: "STATE.JWT",
      });
      expect(url).toContain("accounts.zoho.com/oauth/v2/auth");
      expect(url).toContain("client_id=1000.ABC");
      expect(url).toContain("redirect_uri=" + encodeURIComponent(
        "https://noralos.example/api/integrations/oauth/zoho/callback",
      ));
      expect(url).toContain("state=STATE.JWT");
      expect(url).toContain("access_type=offline");
      expect(url).toContain("prompt=consent");
      // Zoho scope set should be in the URL (comma-joined).
      expect(url).toContain("ZohoCRM.modules.ALL");
    });

    it("routes EU customers to accounts.zoho.eu", () => {
      const url = buildAuthorizeUrl({
        providerId: "zoho",
        fields: { dataCenter: "eu" },
        clientId: "1000.ABC",
        redirectUri: "https://noralos.example/cb",
        state: "STATE.JWT",
      });
      expect(url).toContain("accounts.zoho.eu/oauth/v2/auth");
    });

    it("throws for an unknown provider", () => {
      expect(() =>
        buildAuthorizeUrl({
          providerId: "not_a_real_provider",
          fields: {},
          clientId: "x",
          redirectUri: "x",
          state: "x",
        }),
      ).toThrow();
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("posts code to the per-DC token endpoint and returns canonical tokens", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: "ACCESS",
            refresh_token: "REFRESH",
            expires_in: 3600,
            api_domain: "https://www.zohoapis.com",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const result = await exchangeCodeForTokens({
        providerId: "zoho",
        code: "AUTHCODE",
        fields: { dataCenter: "us" },
        clientId: "1000.ABC",
        clientSecret: "shhhh",
        redirectUri: "https://noralos.example/cb",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      // The accounts-server resolution should pick the US server.
      expect(calledUrl).toBe("https://accounts.zoho.com/oauth/v2/token");
      const body = String((calledInit as RequestInit).body);
      expect(body).toContain("grant_type=authorization_code");
      expect(body).toContain("code=AUTHCODE");
      // Ensure client_secret is sent in the body, not anywhere it could
      // leak (the request URL).
      expect(calledUrl).not.toContain("shhhh");
      expect(body).toContain("client_secret=shhhh");
      expect(result.accessToken).toBe("ACCESS");
      expect(result.refreshToken).toBe("REFRESH");
      expect(result.raw.api_domain).toBe("https://www.zohoapis.com");
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it("rejects when the provider response has no refresh token — prevents saving an unusable credential", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "ACCESS", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await expect(
        exchangeCodeForTokens({
          providerId: "zoho",
          code: "AUTHCODE",
          fields: { dataCenter: "us" },
          clientId: "x",
          clientSecret: "y",
          redirectUri: "https://noralos.example/cb",
          fetchImpl: fetchMock as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/did not return a refresh token/);
    });

    it("surfaces provider errors as safe messages", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Code already used" }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );
      await expect(
        exchangeCodeForTokens({
          providerId: "zoho",
          code: "AUTHCODE",
          fields: { dataCenter: "us" },
          clientId: "x",
          clientSecret: "y",
          redirectUri: "https://noralos.example/cb",
          fetchImpl: fetchMock as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/Code already used/);
    });
  });

  describe("refreshAccessToken", () => {
    it("hits the token endpoint with grant_type=refresh_token", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "NEW", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const result = await refreshAccessToken({
        providerId: "zoho",
        refreshToken: "OLD_REFRESH",
        clientId: "1000.ABC",
        clientSecret: "shhhh",
        fields: { dataCenter: "us" },
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=OLD_REFRESH");
      expect(result.accessToken).toBe("NEW");
    });
  });
});
