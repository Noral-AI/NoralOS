import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageService } from "../storage/types.js";

const companyId = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const otherUserId = "user-other";
const selfUserId = "user-self";

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDependencyReadiness: vi.fn(async () => new Map()),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

function registerRouteMocks() {
  vi.doMock("@noralos/shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));

  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
    ISSUE_LIST_DEFAULT_LIMIT: 500,
    ISSUE_LIST_MAX_LIMIT: 1000,
    clampIssueListLimit: (limit: number) => Math.min(1000, Math.max(1, Math.floor(limit))),
  }));

  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => ({ canUser: vi.fn(), hasPermission: vi.fn() }),
    agentService: () => ({ getById: vi.fn() }),
    companyService: () => ({ getById: vi.fn(async () => ({ id: companyId })) }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(),
    }),
    goalService: () => ({}),
    heartbeatService: () => ({
      wakeup: vi.fn(),
      reportRunActivity: vi.fn(),
      getRun: vi.fn(),
      getActiveRunForAgent: vi.fn(),
      cancelRun: vi.fn(),
    }),
    instanceSettingsService: () => ({
      get: vi.fn(async () => ({ id: "instance-settings-1", general: {} })),
      listCompanyIds: vi.fn(async () => [companyId]),
    }),
    issueApprovalService: () => ({}),
    issueReferenceService: () => ({
      deleteDocumentSource: async () => undefined,
      diffIssueReferenceSummary: () => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      }),
      emptySummary: () => ({ outbound: [], inbound: [] }),
      listIssueReferenceSummary: async () => ({ outbound: [], inbound: [] }),
      syncComment: async () => undefined,
      syncDocument: async () => undefined,
      syncIssue: async () => undefined,
    }),
    issueService: () => mockIssueService,
    ISSUE_LIST_DEFAULT_LIMIT: 500,
    ISSUE_LIST_MAX_LIMIT: 1000,
    clampIssueListLimit: (limit: number) => Math.min(1000, Math.max(1, Math.floor(limit))),
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({ syncRunStatusForIssue: vi.fn() }),
    workProductService: () => ({}),
  }));
}

function createStorageService(): StorageService {
  return {
    provider: "local_disk",
    putFile: vi.fn(),
    getObject: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
  } as any;
}

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      ...actor,
      companyIds: Array.isArray(actor.companyIds) ? [...actor.companyIds] : actor.companyIds,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, createStorageService()));
  app.use(errorHandler);
  return app;
}

describe.sequential("issues list visibility gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@noralos/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../middleware/index.js");
    registerRouteMocks();
    vi.resetAllMocks();
    mockIssueService.list.mockReset();
    mockIssueService.list.mockResolvedValue([]);
    mockLogActivity.mockReset();
  });

  it("owner sees the unfiltered company list (no touchedByUserId default)", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list).toHaveBeenCalledTimes(1);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBeUndefined();
    expect(mockIssueService.list.mock.calls[0]?.[1]?.assigneeUserId).toBeUndefined();
  });

  it("admin sees the unfiltered company list", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "admin", status: "active" }],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBeUndefined();
  });

  it("instance admin sees the unfiltered company list even with no membership", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
      memberships: [],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBeUndefined();
  });

  it("operator gets touchedByUserId defaulted to self when no user filter is given", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "operator", status: "active" }],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBe(selfUserId);
  });

  it("viewer gets touchedByUserId defaulted to self when no user filter is given", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "viewer", status: "active" }],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBe(selfUserId);
  });

  it("operator passing touchedByUserId=me resolves to self via the existing alias", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "operator", status: "active" }],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues?touchedByUserId=me`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBe(selfUserId);
  });

  it("operator cannot peek at another user's touched issues", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "operator", status: "active" }],
    });

    const res = await request(app).get(
      `/api/companies/${companyId}/issues?touchedByUserId=${otherUserId}`,
    );

    expect(res.status).toBe(403);
    expect(mockIssueService.list).not.toHaveBeenCalled();
  });

  it("operator cannot peek at another user's assignee issues", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "operator", status: "active" }],
    });

    const res = await request(app).get(
      `/api/companies/${companyId}/issues?assigneeUserId=${otherUserId}`,
    );

    expect(res.status).toBe(403);
    expect(mockIssueService.list).not.toHaveBeenCalled();
  });

  it("operator with assigneeUserId=me does not get touchedByUserId defaulted on top", async () => {
    const app = await createApp({
      type: "board",
      userId: selfUserId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "operator", status: "active" }],
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues?assigneeUserId=me`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.assigneeUserId).toBe(selfUserId);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBeUndefined();
  });

  it("agent in the same company sees the unfiltered list", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId,
      source: "agent_key",
    });

    const res = await request(app).get(`/api/companies/${companyId}/issues`);

    expect(res.status).toBe(200);
    expect(mockIssueService.list.mock.calls[0]?.[1]?.touchedByUserId).toBeUndefined();
  });
});
