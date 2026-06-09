import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { authRoutes } from "../routes/auth.js";

function createSelectChain(rows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function createDb(rows: Record<string, unknown>[]) {
  return {
    select: () => createSelectChain(rows),
  } as any;
}

function createApp(actor: Express.Request["actor"], rows: Record<string, unknown>[]) {
  const app = express();
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api/auth", authRoutes(createDb(rows)));
  app.use(errorHandler);
  return app;
}

const sessionActor: Express.Request["actor"] = {
  type: "board",
  userId: "user-1",
  source: "session",
};

const baseUser = {
  id: "user-1",
  name: "Jane Example",
  email: "jane@example.com",
  image: null,
};

describe.sequential("GET /api/auth/session/validate", () => {
  const originalSecret = process.env.NORAL_SSO_VALIDATE_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.NORAL_SSO_VALIDATE_SECRET;
    else process.env.NORAL_SSO_VALIDATE_SECRET = originalSecret;
  });

  it("returns the session user's identity for a valid cookie session", async () => {
    delete process.env.NORAL_SSO_VALIDATE_SECRET;
    const app = createApp(sessionActor, [baseUser]);

    const res = await request(app).get("/api/auth/session/validate");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: "user-1", email: "jane@example.com", name: "Jane Example" },
    });
  });

  it("rejects requests without a session", async () => {
    delete process.env.NORAL_SSO_VALIDATE_SECRET;
    const app = createApp({ type: "none", source: "none" }, [baseUser]);

    const res = await request(app).get("/api/auth/session/validate");

    expect(res.status).toBe(401);
  });

  it("only validates cookie sessions, not other board credentials", async () => {
    delete process.env.NORAL_SSO_VALIDATE_SECRET;
    const app = createApp(
      { type: "board", userId: "user-1", source: "board_key" },
      [baseUser],
    );

    const res = await request(app).get("/api/auth/session/validate");

    expect(res.status).toBe(401);
  });

  it("rejects callers missing the internal secret when one is configured", async () => {
    process.env.NORAL_SSO_VALIDATE_SECRET = "internal-secret";
    const app = createApp(sessionActor, [baseUser]);

    const missing = await request(app).get("/api/auth/session/validate");
    expect(missing.status).toBe(401);

    const wrong = await request(app)
      .get("/api/auth/session/validate")
      .set("x-noral-sso-secret", "guess");
    expect(wrong.status).toBe(401);
  });

  it("accepts callers presenting the configured internal secret", async () => {
    process.env.NORAL_SSO_VALIDATE_SECRET = "internal-secret";
    const app = createApp(sessionActor, [baseUser]);

    const res = await request(app)
      .get("/api/auth/session/validate")
      .set("x-noral-sso-secret", "internal-secret");

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("jane@example.com");
  });

  it("rejects a valid-looking session whose user row is gone", async () => {
    delete process.env.NORAL_SSO_VALIDATE_SECRET;
    const app = createApp(sessionActor, []);

    const res = await request(app).get("/api/auth/session/validate");

    expect(res.status).toBe(401);
  });
});
