import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import type { Db } from "@noralos/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@noralos/db";
import type { Config } from "../config.js";
import { resolveNoralosInstanceId } from "../home-paths.js";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthInstance = ReturnType<typeof betterAuth>;

const AUTH_COOKIE_PREFIX_FALLBACK = "default";
const AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE = /[^a-zA-Z0-9_-]+/g;

export function deriveAuthCookiePrefix(instanceId = resolveNoralosInstanceId()): string {
  const scopedInstanceId = instanceId
    .trim()
    .replace(AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE, "-")
    .replace(/^-+|-+$/g, "") || AUTH_COOKIE_PREFIX_FALLBACK;
  return `noralos-${scopedInstanceId}`;
}

export function buildBetterAuthAdvancedOptions(input: {
  disableSecureCookies: boolean;
  /**
   * When set, configures Better Auth to set the session/CSRF cookies with
   * a leading-dot domain (e.g. `.noral.ai`) so they're sent to every
   * subdomain of the same parent. Enables cross-product SSO between
   * agent.noral.ai and voice.noral.ai (both `*.noral.ai`).
   *
   * MUST start with a leading dot to be valid. Operator opts in via the
   * BETTER_AUTH_COOKIE_DOMAIN env var; default behaviour is unchanged.
   *
   * Side effect: enabling this invalidates existing per-host cookies —
   * already-signed-in users will need to sign in once after the change.
   */
  crossSubDomainCookieDomain?: string;
}) {
  const advanced: Record<string, unknown> = {
    cookiePrefix: deriveAuthCookiePrefix(),
  };
  if (input.disableSecureCookies) {
    advanced.useSecureCookies = false;
  }
  if (input.crossSubDomainCookieDomain) {
    advanced.crossSubDomainCookies = {
      enabled: true,
      domain: input.crossSubDomainCookieDomain,
    };
  }
  return advanced;
}

/**
 * Resolve the cross-subdomain cookie domain from env. Validates it starts
 * with a leading dot. Returns undefined when unset.
 *
 * Examples:
 *   BETTER_AUTH_COOKIE_DOMAIN=.noral.ai → ".noral.ai"
 *   BETTER_AUTH_COOKIE_DOMAIN=noral.ai  → throws (missing leading dot)
 *   BETTER_AUTH_COOKIE_DOMAIN unset     → undefined
 */
export function resolveCrossSubDomainCookieDomain(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.BETTER_AUTH_COOKIE_DOMAIN?.trim();
  if (!raw) return undefined;
  if (!raw.startsWith(".")) {
    throw new Error(
      `BETTER_AUTH_COOKIE_DOMAIN must start with a leading dot for cross-subdomain ` +
      `cookies to work (got '${raw}'). Example: '.noral.ai'.`,
    );
  }
  return raw;
}

export function shouldDisableSecureAuthCookies(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  authBaseUrlMode: Config["authBaseUrlMode"];
  authPublicBaseUrl: string | undefined;
  publicUrl?: string | undefined;
}): boolean {
  const publicUrl = (
    input.publicUrl?.trim() ||
    (input.authBaseUrlMode === "explicit" ? input.authPublicBaseUrl?.trim() : "")
  );
  if (publicUrl) return publicUrl.startsWith("http://");

  return (
    input.deploymentMode === "authenticated" &&
    (
      (input.deploymentExposure === "private" && input.authBaseUrlMode === "auto") ||
      input.deploymentExposure === undefined
    )
  );
}

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

export function deriveAuthTrustedOrigins(config: Config, opts?: { listenPort?: number }): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    const port = opts?.listenPort ?? config.port;
    const needsPortVariants = port !== 80 && port !== 443;
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      trustedOrigins.add(`https://${trimmed}`);
      trustedOrigins.add(`http://${trimmed}`);
      if (needsPortVariants) {
        trustedOrigins.add(`https://${trimmed}:${port}`);
        trustedOrigins.add(`http://${trimmed}:${port}`);
      }
    }
  }

  return Array.from(trustedOrigins);
}

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins: string[]): BetterAuthInstance {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const publicUrl = process.env.NORALOS_PUBLIC_URL?.trim() || baseUrl;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.NORALOS_AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET (or NORALOS_AGENT_JWT_SECRET) must be set. " +
      "For local development, set BETTER_AUTH_SECRET=noralos-dev-secret in your .env file.",
    );
  }
  const disableSecureCookies = shouldDisableSecureAuthCookies({
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    authBaseUrlMode: config.authBaseUrlMode,
    authPublicBaseUrl: config.authPublicBaseUrl,
    publicUrl,
  });

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const googleEnabled = Boolean(googleClientId && googleClientSecret);

  const authConfig: Record<string, unknown> = {
    baseURL: baseUrl,
    secret,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      disableSignUp: config.authDisableSignUp,
    },
    advanced: buildBetterAuthAdvancedOptions({ disableSecureCookies }),
  };

  if (googleEnabled) {
    authConfig.socialProviders = {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    };
    authConfig.account = {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    };
  }

  if (!baseUrl) {
    delete authConfig.baseURL;
  }

  return betterAuth(authConfig as Parameters<typeof betterAuth>[0]);
}

export function createBetterAuthHandler(auth: BetterAuthInstance): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = (auth as unknown as { api?: { getSession?: (input: unknown) => Promise<unknown> } }).api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthInstance,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
