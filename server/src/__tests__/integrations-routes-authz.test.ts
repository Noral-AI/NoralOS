// Explicit route-level authorization matrix for /companies/.../integrations.
//
// The integrations surface lets an admin paste encrypted secret material,
// list it back with metadata + masked suffixes, and bind credentials to
// plugin config slots. That makes both reads (which expose what's
// configured) and writes (which can swap a credential under a running
// plugin) security-sensitive enough to require owner/admin on every
// endpoint. This test pins the matrix.
//
//   actor             | list | create | import | assign | unassign
//   ------------------+------+--------+--------+--------+---------
//   owner             |  200 |   201  |   201  |   200  |   200
//   admin             |  200 |   201  |   201  |   200  |   200
//   operator          |  403 |   403  |   403  |   403  |   403
//   viewer            |  403 |   403  |   403  |   403  |   403
//   agent             |  403 |   403  |   403  |   403  |   403
//   unauthenticated   |  401 |   401  |   401  |   401  |   401
//
// We mock the service layer so the test exercises only routing + auth.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const otherCompanyId = "00000000-0000-4000-8000-bbbbbbbbbbbb";
const selfUserId = "user-self";
const credentialId = "00000000-0000-4000-8000-cccccccccccc";
const assignmentId = "00000000-0000-4000-8000-dddddddddddd";
const targetPluginId = "00000000-0000-4000-8000-eeeeeeeeeeee";

const mockCredentialService = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listUnmanaged: vi.fn(async () => []),
  loadCredentialRow: vi.fn(async () => ({
    id: credentialId,
    companyId,
    secretId: "secret-1",
    provider: "google_tts",
    category: "voice",
    credentialType: "api_key",
    displayName: "Google TTS",
    description: null,
    environment: "production",
    status: "active",
    maskedSuffix: "****abcd",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    rotationNotes: null,
    metadata: {},
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  create: vi.fn(async () => ({
    id: credentialId,
    provider: "google_tts",
    category: "voice",
    credentialType: "api_key",
    displayName: "Google TTS",
    description: null,
    environment: "production",
    status: "active",
    maskedSuffix: "****abcd",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    rotationNotes: null,
    metadata: {},
    hasMaterial: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByUserId: null,
    updatedByUserId: null,
    assignments: [],
  })),
  importExistingSecret: vi.fn(async () => ({
    id: credentialId,
    provider: "google_tts",
    category: "voice",
    credentialType: "api_key",
    displayName: "Imported",
    description: null,
    environment: "production",
    status: "active",
    maskedSuffix: "****abcd",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    rotationNotes: null,
    metadata: {},
    hasMaterial: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByUserId: null,
    updatedByUserId: null,
    assignments: [],
  })),
  getById: vi.fn(),
  buildCredentialDto: vi.fn(),
  resolvePlaintext: vi.fn(),
  recordTestResult: vi.fn(),
  rotate: vi.fn(),
  updateMetadata: vi.fn(),
  disable: vi.fn(),
  remove: vi.fn(),
  _maskSuffix: () => "****abcd",
}));

const mockAssignmentService = vi.hoisted(() => ({
  listAssignmentBoard: vi.fn(async () => []),
  listForCompany: vi.fn(async () => []),
  assign: vi.fn(async () => ({
    id: credentialId,
    provider: "google_tts",
    category: "voice",
    credentialType: "api_key",
    displayName: "Google TTS",
    description: null,
    environment: "production",
    status: "active",
    maskedSuffix: "****abcd",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    rotationNotes: null,
    metadata: {},
    hasMaterial: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByUserId: null,
    updatedByUserId: null,
    assignments: [],
  })),
  unassign: vi.fn(async () => ({ credentialId })),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

function registerMocks() {
  vi.doMock("../services/integrations/credentials.js", () => ({
    integrationCredentialService: () => mockCredentialService,
  }));
  vi.doMock("../services/integrations/assignments.js", () => ({
    integrationAssignmentService: () => mockAssignmentService,
  }));
  vi.doMock("../services/integrations/provider-tests.js", () => ({
    runProviderTest: vi.fn(async () => ({ ok: true, statusCode: 200, safeMessage: "OK" })),
  }));
  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));
  vi.doMock("@noralos/db", () => ({
    integrationCredentialAssignments: { id: "id", companyId: "company_id" },
  }));
}

type ActorOpts =
  | "owner"
  | "admin"
  | "operator"
  | "viewer"
  | "agent"
  | "unauthenticated";

function buildActor(kind: ActorOpts): Record<string, unknown> {
  if (kind === "unauthenticated") return { type: "none", source: "none" };
  if (kind === "agent") {
    return {
      type: "agent",
      agentId: "agent-1",
      companyId,
      source: "agent_key",
    };
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

async function createApp(kind: ActorOpts) {
  const [{ errorHandler }, { integrationRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/integrations.js")>("../routes/integrations.js"),
  ]);
  const app = express();
  app.use(express.json());
  // Stub the assignment-id lookup that DELETE /integrations/assignments/:id
  // performs against `integrationCredentialAssignments`. We bypass by
  // wrapping the route input with a tiny shim that injects the row via
  // app-locals. Simpler: have the test only exercise the auth path —
  // when the auth path returns 403 the row lookup never runs anyway.
  // For the owner/admin happy path we provide a minimal db stub that
  // returns a matching assignment row.
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([
          { id: assignmentId, companyId, credentialId, targetKind: "plugin_config", targetPluginId, targetConfigPath: "googleTtsApiKeyRef", assignedAt: new Date() },
        ]),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
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
  app.use("/api", integrationRoutes(db as never));
  app.use(errorHandler);
  return app;
}

describe.sequential("integrations routes authorization matrix", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/integrations/credentials.js");
    vi.doUnmock("../services/integrations/assignments.js");
    vi.doUnmock("../services/integrations/provider-tests.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../routes/integrations.js");
    vi.doUnmock("../middleware/index.js");
    registerMocks();
    mockCredentialService.list.mockClear();
    mockCredentialService.create.mockClear();
    mockCredentialService.importExistingSecret.mockClear();
    mockAssignmentService.assign.mockClear();
    mockAssignmentService.unassign.mockClear();
    mockLogActivity.mockClear();
  });

  // --------------------------------------------------------------------
  // GET /credentials — list
  // --------------------------------------------------------------------
  describe("GET /companies/:companyId/integrations/credentials", () => {
    it.each([
      ["owner", 200] as const,
      ["admin", 200] as const,
    ])("%s gets 200", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app).get(`/api/companies/${companyId}/integrations/credentials`);
      expect(res.status).toBe(expected);
    });

    it.each([
      ["operator", 403] as const,
      ["viewer", 403] as const,
      ["agent", 403] as const,
    ])("%s is rejected with 403", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app).get(`/api/companies/${companyId}/integrations/credentials`);
      expect(res.status).toBe(expected);
      expect(mockCredentialService.list).not.toHaveBeenCalled();
    });

    it("unauthenticated is rejected with 401", async () => {
      const app = await createApp("unauthenticated");
      const res = await request(app).get(`/api/companies/${companyId}/integrations/credentials`);
      expect(res.status).toBe(401);
      expect(mockCredentialService.list).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // POST /credentials — create
  // --------------------------------------------------------------------
  describe("POST /companies/:companyId/integrations/credentials", () => {
    const body = {
      provider: "google_tts",
      displayName: "Test",
      environment: "production",
      value: "AIzaSyTest1234",
    };
    it.each([
      ["owner", 201] as const,
      ["admin", 201] as const,
    ])("%s gets %i", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app)
        .post(`/api/companies/${companyId}/integrations/credentials`)
        .send(body);
      expect(res.status).toBe(expected);
    });

    it.each([
      ["operator", 403] as const,
      ["viewer", 403] as const,
      ["agent", 403] as const,
    ])("%s is rejected with 403", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app)
        .post(`/api/companies/${companyId}/integrations/credentials`)
        .send(body);
      expect(res.status).toBe(expected);
      expect(mockCredentialService.create).not.toHaveBeenCalled();
    });

    it("unauthenticated is rejected with 401", async () => {
      const app = await createApp("unauthenticated");
      const res = await request(app)
        .post(`/api/companies/${companyId}/integrations/credentials`)
        .send(body);
      expect(res.status).toBe(401);
      expect(mockCredentialService.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // POST /credentials/import — import existing secret
  // --------------------------------------------------------------------
  describe("POST /companies/:companyId/integrations/credentials/import", () => {
    const body = {
      secretId: "00000000-0000-4000-8000-fffffffffff0",
      provider: "google_tts",
      displayName: "Imported Google",
      environment: "production",
      category: "voice",
      credentialType: "api_key",
    };
    it.each([
      ["owner", 201] as const,
      ["admin", 201] as const,
    ])("%s gets %i", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app)
        .post(`/api/companies/${companyId}/integrations/credentials/import`)
        .send(body);
      expect(res.status).toBe(expected);
    });

    it.each([
      ["operator", 403] as const,
      ["viewer", 403] as const,
      ["agent", 403] as const,
    ])("%s is rejected with 403", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app)
        .post(`/api/companies/${companyId}/integrations/credentials/import`)
        .send(body);
      expect(res.status).toBe(expected);
      expect(mockCredentialService.importExistingSecret).not.toHaveBeenCalled();
    });

    it("unauthenticated is rejected with 401", async () => {
      const app = await createApp("unauthenticated");
      const res = await request(app)
        .post(`/api/companies/${companyId}/integrations/credentials/import`)
        .send(body);
      expect(res.status).toBe(401);
      expect(mockCredentialService.importExistingSecret).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // POST /credentials/:id/assignments — assign
  // --------------------------------------------------------------------
  describe("POST /integrations/credentials/:id/assignments", () => {
    const body = {
      targetKind: "plugin_config",
      targetPluginId,
      targetConfigPath: "googleTtsApiKeyRef",
    };
    it.each([
      ["owner", 200] as const,
      ["admin", 200] as const,
    ])("%s gets 200", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app)
        .post(`/api/integrations/credentials/${credentialId}/assignments`)
        .send(body);
      expect(res.status).toBe(expected);
    });

    it.each([
      ["operator", 403] as const,
      ["viewer", 403] as const,
      ["agent", 403] as const,
    ])("%s is rejected with 403", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app)
        .post(`/api/integrations/credentials/${credentialId}/assignments`)
        .send(body);
      expect(res.status).toBe(expected);
      expect(mockAssignmentService.assign).not.toHaveBeenCalled();
    });

    it("unauthenticated is rejected with 401", async () => {
      const app = await createApp("unauthenticated");
      const res = await request(app)
        .post(`/api/integrations/credentials/${credentialId}/assignments`)
        .send(body);
      expect(res.status).toBe(401);
      expect(mockAssignmentService.assign).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // DELETE /assignments/:id — unassign
  // --------------------------------------------------------------------
  describe("DELETE /integrations/assignments/:assignmentId", () => {
    it.each([
      ["owner", 200] as const,
      ["admin", 200] as const,
    ])("%s gets 200", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app).delete(`/api/integrations/assignments/${assignmentId}`);
      expect(res.status).toBe(expected);
    });

    it.each([
      ["operator", 403] as const,
      ["viewer", 403] as const,
      ["agent", 403] as const,
    ])("%s is rejected with 403", async (role, expected) => {
      const app = await createApp(role);
      const res = await request(app).delete(`/api/integrations/assignments/${assignmentId}`);
      expect(res.status).toBe(expected);
      expect(mockAssignmentService.unassign).not.toHaveBeenCalled();
    });

    it("unauthenticated is rejected with 401", async () => {
      const app = await createApp("unauthenticated");
      const res = await request(app).delete(`/api/integrations/assignments/${assignmentId}`);
      expect(res.status).toBe(401);
      expect(mockAssignmentService.unassign).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------
  // Cross-company access — owner of one company cannot reach another
  // --------------------------------------------------------------------
  describe("cross-company access", () => {
    it("owner of A is rejected with 403 when targeting company B", async () => {
      const app = await createApp("owner");
      const res = await request(app).get(
        `/api/companies/${otherCompanyId}/integrations/credentials`,
      );
      expect(res.status).toBe(403);
      expect(mockCredentialService.list).not.toHaveBeenCalled();
    });
  });
});
