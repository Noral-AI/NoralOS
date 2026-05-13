import type { Request } from "express";

/**
 * Compute the absolute redirect URI we register with OAuth providers.
 *
 * Order of precedence:
 *   1. `NORALOS_PUBLIC_URL` env var (production: must match what the
 *      admin registered in the provider's API console).
 *   2. The request's `x-forwarded-proto` + `x-forwarded-host` (when the
 *      app sits behind a trusted reverse proxy that strips TLS).
 *   3. The request's `Host` header with the connection's protocol
 *      (development fallback).
 *
 * The provider-side OAuth app MUST whitelist the exact URI we return
 * here. Mismatches fail at the provider with `redirect_uri_mismatch`
 * before NoralOS ever sees the callback, which is the intended
 * behavior — we don't try to mask provider configuration errors.
 */
export function resolveOAuthRedirectUri(req: Request, providerId: string): string {
  const path = `/api/integrations/oauth/${providerId}/callback`;

  const explicit = process.env.NORALOS_PUBLIC_URL?.trim();
  if (explicit && /^https?:\/\//.test(explicit)) {
    return explicit.replace(/\/+$/, "") + path;
  }

  // Headers behind a reverse proxy. Trust only `x-forwarded-*` because
  // Express is configured with `trust proxy` in prod (see app.ts).
  const xfp = req.get("x-forwarded-proto");
  const xfh = req.get("x-forwarded-host");
  const proto = (xfp ?? req.protocol).split(",")[0].trim();
  const host = (xfh ?? req.get("host") ?? "").split(",")[0].trim();
  if (host) return `${proto}://${host}${path}`;

  throw new Error("Could not resolve absolute base URL for OAuth callback");
}
