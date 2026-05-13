import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed-state token for the OAuth authorization-code flow.
 *
 * Carried across the provider redirect dance as the `state` query param.
 * Signed with HS256 using `BETTER_AUTH_SECRET` (the same secret the
 * platform's other JWTs use). Carries enough context for the callback to
 * (a) reject CSRF/replay attempts, (b) know which company + credential
 * the returning user is wiring up, and (c) decide whether this is the
 * initial connect or a reconnect (which rotates an existing refresh
 * token instead of creating a new credential).
 *
 * **Why not better-auth's session?** The callback has the user's session
 * cookie too, but `state` is the cross-redirect contract: the
 * authorization endpoint requires us to send and verify it. We use the
 * JWT both for its tamper-evidence and to bind the redirect to a single
 * credential — a leaked state from one tab can't be replayed against a
 * different credential the user happens to own.
 */

const STATE_DEFAULT_TTL_SECONDS = 10 * 60;
const ALG = "HS256";

export interface OAuthStateClaims {
  companyId: string;
  credentialId: string;
  provider: string;
  /** `initial` for first-time connect; `reconnect` rotates a refresh token. */
  mode: "initial" | "reconnect";
  /** Random nonce — guards against attacker-chosen state replay. */
  nonce: string;
  iat: number;
  exp: number;
}

function jwtSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || process.env.NORALOS_AGENT_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET (or NORALOS_AGENT_JWT_SECRET) must be set to sign OAuth state tokens.",
    );
  }
  return secret;
}

function base64UrlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function sign(secret: string, signingInput: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

export interface SignStateInput {
  companyId: string;
  credentialId: string;
  provider: string;
  mode: "initial" | "reconnect";
  ttlSeconds?: number;
}

export function signOAuthState(input: SignStateInput): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: OAuthStateClaims = {
    companyId: input.companyId,
    credentialId: input.credentialId,
    provider: input.provider,
    mode: input.mode,
    nonce: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + (input.ttlSeconds ?? STATE_DEFAULT_TTL_SECONDS),
  };
  const header = base64UrlEncode(JSON.stringify({ alg: ALG, typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = sign(jwtSecret(), signingInput);
  return `${signingInput}.${signature}`;
}

export type VerifyStateResult =
  | { ok: true; claims: OAuthStateClaims }
  | { ok: false; reason: string };

export function verifyOAuthState(token: string): VerifyStateResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing state" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed state" };
  const [header, payload, signature] = parts;

  let headerObj: unknown;
  try {
    headerObj = JSON.parse(base64UrlDecode(header).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed header" };
  }
  if (
    !headerObj ||
    typeof headerObj !== "object" ||
    (headerObj as Record<string, unknown>).alg !== ALG
  ) {
    return { ok: false, reason: "bad alg" };
  }

  const expectedSig = sign(jwtSecret(), `${header}.${payload}`);
  // Both are base64url ASCII strings of equal length when computed the
  // same way; timingSafeEqual requires identical Buffer lengths.
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad signature" };
  }

  let claims: OAuthStateClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString("utf8")) as OAuthStateClaims;
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) {
    return { ok: false, reason: "expired" };
  }
  if (claims.mode !== "initial" && claims.mode !== "reconnect") {
    return { ok: false, reason: "bad mode" };
  }
  if (!claims.companyId || !claims.credentialId || !claims.provider) {
    return { ok: false, reason: "missing claims" };
  }
  return { ok: true, claims };
}
