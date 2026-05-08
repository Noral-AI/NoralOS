import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

import { buildVersionPayload, versionRoutes } from "../routes/version.ts";

describe("buildVersionPayload (pure)", () => {
  it("returns version + short SHA only when unauthenticated", () => {
    const result = buildVersionPayload({
      version: "1.2.3",
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      gitShaShort: "abcdef1",
      buildTime: "2026-05-08T17:36:53Z",
      authenticated: false,
    });
    expect(result).toEqual({ version: "1.2.3", gitShaShort: "abcdef1" });
    // Defensive: full SHA must NOT leak through the unauth tier even though it
    // was passed in. This is the load-bearing assertion of the auth model.
    expect(JSON.stringify(result)).not.toContain("abcdef1234567890abcdef1234567890abcdef12");
    expect(JSON.stringify(result)).not.toContain("2026-05-08T17:36:53Z");
  });

  it("returns full payload when authenticated", () => {
    const result = buildVersionPayload({
      version: "1.2.3",
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      gitShaShort: "abcdef1",
      buildTime: "2026-05-08T17:36:53Z",
      authenticated: true,
    });
    expect(result).toEqual({
      version: "1.2.3",
      gitShaShort: "abcdef1",
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      buildTime: "2026-05-08T17:36:53Z",
      imageRevision: "abcdef1234567890abcdef1234567890abcdef12",
      imageCreated: "2026-05-08T17:36:53Z",
    });
  });

  it("normalises null SHA / build time consistently across tiers", () => {
    const unauth = buildVersionPayload({
      version: "1.2.3",
      gitSha: null,
      gitShaShort: null,
      buildTime: null,
      authenticated: false,
    });
    expect(unauth).toEqual({ version: "1.2.3", gitShaShort: null });

    const auth = buildVersionPayload({
      version: "1.2.3",
      gitSha: null,
      gitShaShort: null,
      buildTime: null,
      authenticated: true,
    });
    expect(auth).toEqual({
      version: "1.2.3",
      gitShaShort: null,
      gitSha: null,
      buildTime: null,
      imageRevision: null,
      imageCreated: null,
    });
  });
});

describe("GET /api/version (route)", () => {
  function createApp(actor?: { type: "board" | "agent" }) {
    const app = express();
    // Mimic the actor middleware that lives in production app.ts so the
    // route can read req.actor.type. We attach a no-op actor for unauth
    // and a board/agent actor for the authed path.
    app.use((req, _res, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).actor = actor ?? { type: "none" };
      next();
    });
    app.use("/api", versionRoutes());
    return app;
  }

  it("returns 200 with the unauth shape when no actor is attached", async () => {
    const res = await request(createApp()).get("/api/version");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["gitShaShort", "version"]);
    expect(typeof res.body.version).toBe("string");
    // gitShaShort is null in the local-test environment because the
    // NORALOS_GIT_SHA env var is unset; this also documents that the
    // route degrades gracefully outside Docker.
    expect(res.body.gitShaShort === null || typeof res.body.gitShaShort === "string").toBe(true);
  });

  it("returns the full shape when the actor is a board user", async () => {
    const res = await request(createApp({ type: "board" })).get("/api/version");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["buildTime", "gitSha", "gitShaShort", "imageCreated", "imageRevision", "version"].sort(),
    );
  });

  it("returns the full shape for agent tokens too", async () => {
    const res = await request(createApp({ type: "agent" })).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("gitSha");
    expect(res.body).toHaveProperty("buildTime");
    expect(res.body).toHaveProperty("imageRevision");
    expect(res.body).toHaveProperty("imageCreated");
  });

  it("never echoes a full git SHA in the unauth response (smoke regression test)", async () => {
    // Even if the runtime has a real git SHA loaded, the unauthenticated
    // shape must omit anything longer than 7 chars at the gitShaShort key.
    const res = await request(createApp()).get("/api/version");
    expect(res.status).toBe(200);
    if (typeof res.body.gitShaShort === "string") {
      expect(res.body.gitShaShort.length).toBeLessThanOrEqual(7);
    }
    // No `gitSha`, `buildTime`, `imageRevision`, or `imageCreated` keys.
    expect(res.body).not.toHaveProperty("gitSha");
    expect(res.body).not.toHaveProperty("buildTime");
    expect(res.body).not.toHaveProperty("imageRevision");
    expect(res.body).not.toHaveProperty("imageCreated");
  });
});
