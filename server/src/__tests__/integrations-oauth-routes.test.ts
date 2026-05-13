// Route-level tests for /api/integrations/oauth/:provider/{authorize,callback}.
//
// We mock the credential + secret services and the activity logger so
// the test exercises only routing, authz, state-JWT verification, code
// exchange, and the post-success redirect contract.

import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const credentialId = "00000000-0000-4000-8000-cccccccccccc";
const selfUserId = "user-self";

const mockCredentialService = vi.hoisted(() => ({
  loadCredentialRow: vi.fn(async () => ({
    id: credentialId,
    companyId,
    secretId: "secret-1",
    provider: "zoho",
    category: "crm",
    credentialType: "oauth_refresh_token",
    displayName: "Zoho CRM Prod",
    description: null,
    environment: "production",
    status: "needs_attention",
    maskedSuffix: "****abcd",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    rotationNotes: null,
    metadata: { fields: { dataCenter: "us" } },
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  setOAuthTokens: vi.fn(async () => ({
    id: credentialId,
    provider: "zoho",
    category: "crm",
    credentialType: "oauth_refresh_token",
    displayName: "Zoho CRM Prod",
    description: null,
    environment: "production",
    status: "active",
    maskedSuffix: "****REFRESH",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    rotationNotes: null,
    metadata: { fields: { dataCenter: "us" }, apiDomain: "https://www.zohoapis.com", oauth: { connected: true } },
    hasMaterial: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByUserId: null,
    updatedByUserId: null,
    assignments: [],
  })),
}));

const mockSecretService = vi.hoisted(() => ({
  resolveSecretValue: vi.fn(async () =>
    JSON.stringify({ clientId: "1000.ABC", clientSecret: "shhhh" }),
  ),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

function registerMocks() {
  vi.doMock("../services/integrations/credentials.js", () => ({
    integrationCredentialService: () => mockCredentialService,
  }));
  vi.doMock("../services/secrets.js", () => ({
    secretService: () => mockSecretService,
  }));
  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));
}

type Role = "owner" | "admin" | "operator" | "viewer" | "agent" | "unauthenticated";

function buildActor(kind: Role): Record<string, unknown> {
  if (kind === "unauthenticated") return { type: "none", source: "none" };
  if (kind === "agent") {
    return { type: "agent", agentId: "agent-1", companyId, source: "agent_key" };
  }
  return {
    type: "board",
    userId: selfUserId,
    source: "session",
    isInstanceAdmin: false,
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: kind, status: "active" }],
  };
}

async function createApp(kind: Role, fetchImpl?: typeof fetch) {
  const [{ errorHandler }, { integrationOAuthRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/integrations-oauth.js")>(
      "../routes/integrations-oauth.js",
    ),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = buildActor(kind);
    (req as unknown as { actor: typeof actor }).actor = {
      ...actor,
      companyIds: Array.isArray((actor as { companyIds?: unknown }).companyIds)
        ? [...((actor as { companyIds?: unknown[] }).companyIds ?? [])]
        : (actor as { companyIds?: unknown }).companyIds,
    } as never;
    next();
  });
  app.use("/api", integrationOAuthRoutes({} as never, { fetchImpl }));
  app.use(errorHandler);
  return app;
}

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-oauth-routes-secret";
  process.env.NORALOS_PUBLIC_URL = "https://noralos.example";
});

describe.sequential("integrations-oauth routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/integrations/credentials.js");
    vi.doUnmock("../services/secrets.js");
    vi.doUnmock("../services/activity-log.js");
    registerMocks();
    mockCredentialService.loadCredentialRow.mockClear();
    mockCredentialService.setOAuthTokens.mockClear();
    mockSecretService.resolveSecretValue.mockClear();
    mockLogActivity.mockClear();
  });

  // ---------------------------------------------------------------------
  // GET /authorize — reconnect entry point
  // ---------------------------------------------------------------------
  describe("GET /integrations/oauth/zoho/authorize", () => {
    it("admin gets a 302 to the Zoho authorize URL", async () => {
      const app = await createApp("admin");
      const res = await request(app)
        .get(`/api/integrations/oauth/zoho/authorize?credentialId=${credentialId}&mode=reconnect`)
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("accounts.zoho.com/oauth/v2/auth");
      expect(res.headers.location).toContain("client_id=1000.ABC");
      // redirect_uri should resolve from NORALOS_PUBLIC_URL.
      expect(res.headers.location).toContain(
        encodeURIComponent("https://noralos.example/api/integrations/oauth/zoho/callback"),
      );
    });

    it.each([["operator"], ["viewer"], ["agent"]] as const)(
      "%s is rejected with 403",
      async ([role]) => {
        const app = await createApp(role);
        const res = await request(app)
          .get(`/api/integrations/oauth/zoho/authorize?credentialId=${credentialId}`)
          .redirects(0);
        expect(res.status).toBe(403);
      },
    );

    it("unauthenticated is rejected with 401", async () => {
      const app = await createApp("unauthenticated");
      const res = await request(app)
        .get(`/api/integrations/oauth/zoho/authorize?credentialId=${credentialId}`)
        .redirects(0);
      expect(res.status).toBe(401);
    });

    it("unknown provider renders a 400 page", async () => {
      const app = await createApp("admin");
      const res = await request(app)
        .get(`/api/integrations/oauth/not_a_provider/authorize?credentialId=${credentialId}`)
        .redirects(0);
      expect(res.status).toBe(400);
      expect(res.text).toContain("Unknown OAuth provider");
    });
  });

  // ---------------------------------------------------------------------
  // GET /callback — provider redirects back here after consent
  // ---------------------------------------------------------------------
  describe("GET /integrations/oauth/zoho/callback", () => {
    function buildFetch(resp: unknown, status = 200) {
      return vi.fn(async () =>
        new Response(JSON.stringify(resp), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch;
    }

    async function signState(mode: "initial" | "reconnect" = "initial") {
      const { signOAuthState } = await vi.importActual<
        typeof import("../services/integrations/oauth-state.js")
      >("../services/integrations/oauth-state.js");
      return signOAuthState({
        companyId,
        credentialId,
        provider: "zoho",
        mode,
      });
    }

    it("exchanges code, persists refresh token, redirects to settings", async () => {
      const fetchImpl = buildFetch({
        access_token: "ACCESS",
        refresh_token: "REFRESH",
        expires_in: 3600,
        api_domain: "https://www.zohoapis.com",
      });
      const app = await createApp("admin", fetchImpl);
      const state = await signState("initial");
      const res = await request(app)
        .get(
          `/api/integrations/oauth/zoho/callback?code=AUTHCODE&state=${encodeURIComponent(
            state,
          )}&accounts-server=https://accounts.zoho.com`,
        )
        .redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        `/company/settings/integrations?connected=${encodeURIComponent(
          credentialId,
        )}&provider=zoho`,
      );
      expect(mockCredentialService.setOAuthTokens).toHaveBeenCalledOnce();
      const call = mockCredentialService.setOAuthTokens.mock.calls[0];
      // Args: (companyId, credentialId, { refreshToken, apiDomain, accountsServer }, actor)
      expect(call[0]).toBe(companyId);
      expect(call[1]).toBe(credentialId);
      expect(call[2]).toMatchObject({
        refreshToken: "REFRESH",
        apiDomain: "https://www.zohoapis.com",
        accountsServer: "https://accounts.zoho.com",
      });
      expect(mockLogActivity).toHaveBeenCalled();
      expect(mockLogActivity.mock.calls[0][1]).toMatchObject({
        action: "integration.credential.oauth.connected",
      });
    });

    it("rejects callback with an unsigned/bad state", async () => {
      const fetchImpl = buildFetch({});
      const app = await createApp("admin", fetchImpl);
      const res = await request(app)
        .get(`/api/integrations/oauth/zoho/callback?code=AUTHCODE&state=not-a-jwt`)
        .redirects(0);
      expect(res.status).toBe(400);
      expect(res.text).toContain("Could not verify OAuth state");
      expect(mockCredentialService.setOAuthTokens).not.toHaveBeenCalled();
    });

    it("rejects callback when session admin scope no longer matches state's company", async () => {
      const fetchImpl = buildFetch({});
      // Operator on the company encoded in state — fails the admin gate
      // even though state JWT is valid.
      const app = await createApp("operator", fetchImpl);
      const state = await signState();
      const res = await request(app)
        .get(`/api/integrations/oauth/zoho/callback?code=AUTHCODE&state=${encodeURIComponent(state)}`)
        .redirects(0);
      expect(res.status).toBe(403);
      expect(mockCredentialService.setOAuthTokens).not.toHaveBeenCalled();
    });

    it("surfaces provider-side errors without calling setOAuthTokens", async () => {
      // The provider redirects back with `?error=access_denied` when the user cancels.
      const fetchImpl = buildFetch({});
      const app = await createApp("admin", fetchImpl);
      const state = await signState();
      const res = await request(app)
        .get(
          `/api/integrations/oauth/zoho/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        )
        .redirects(0);
      expect(res.status).toBe(400);
      expect(res.text).toContain("access_denied");
      expect(mockCredentialService.setOAuthTokens).not.toHaveBeenCalled();
    });
  });
});
