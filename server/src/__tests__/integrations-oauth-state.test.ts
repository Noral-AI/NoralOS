import { beforeAll, describe, expect, it } from "vitest";
import {
  signOAuthState,
  verifyOAuthState,
} from "../services/integrations/oauth-state.js";

const companyId = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const credentialId = "00000000-0000-4000-8000-cccccccccccc";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-oauth-state-secret-please-do-not-reuse";
});

describe("integrations-oauth state JWT", () => {
  it("round-trips signed claims for an initial connect", () => {
    const token = signOAuthState({
      companyId,
      credentialId,
      provider: "zoho",
      mode: "initial",
    });
    const result = verifyOAuthState(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.companyId).toBe(companyId);
    expect(result.claims.credentialId).toBe(credentialId);
    expect(result.claims.provider).toBe("zoho");
    expect(result.claims.mode).toBe("initial");
    // A nonce defends against attacker-chosen state replay across credentials.
    expect(typeof result.claims.nonce).toBe("string");
    expect(result.claims.nonce.length).toBeGreaterThan(0);
    expect(result.claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("round-trips reconnect mode", () => {
    const token = signOAuthState({
      companyId,
      credentialId,
      provider: "zoho",
      mode: "reconnect",
    });
    const result = verifyOAuthState(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.mode).toBe("reconnect");
  });

  it("rejects tampered payload", () => {
    const token = signOAuthState({
      companyId,
      credentialId,
      provider: "zoho",
      mode: "initial",
    });
    const [h, p, s] = token.split(".");
    // Re-encode the payload with a different credentialId and reuse the
    // original signature — should fail signature verification.
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        companyId,
        credentialId: "deadbeef-0000-4000-8000-aaaaaaaaaaaa",
        provider: "zoho",
        mode: "initial",
        nonce: "x",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      "utf8",
    ).toString("base64url");
    const result = verifyOAuthState(`${h}.${tamperedPayload}.${s}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad signature");
  });

  it("rejects expired tokens", () => {
    const token = signOAuthState({
      companyId,
      credentialId,
      provider: "zoho",
      mode: "initial",
      ttlSeconds: -10,
    });
    const result = verifyOAuthState(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects malformed input", () => {
    expect(verifyOAuthState("").ok).toBe(false);
    expect(verifyOAuthState("not-a-jwt").ok).toBe(false);
    expect(verifyOAuthState("aaa.bbb").ok).toBe(false);
    expect(verifyOAuthState("aaa.bbb.ccc").ok).toBe(false);
  });

  it("rejects an alg=none header", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        companyId,
        credentialId,
        provider: "zoho",
        mode: "initial",
        nonce: "x",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString("base64url");
    const result = verifyOAuthState(`${header}.${payload}.`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad alg");
  });
});
