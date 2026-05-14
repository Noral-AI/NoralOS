import { Router, type Request, type Response } from "express";
import type { Db } from "@noralos/db";
import { companies } from "@noralos/db";
import { eq } from "drizzle-orm";
import { INTEGRATION_PROVIDERS } from "@noralos/shared";
import {
  buildAuthorizeUrl,
  clearAccessTokenCache,
  exchangeCodeForTokens,
} from "../services/integrations/oauth.js";
import { signOAuthState, verifyOAuthState } from "../services/integrations/oauth-state.js";
import { resolveOAuthRedirectUri } from "../services/integrations/oauth-redirect-uri.js";
import { integrationCredentialService } from "../services/integrations/credentials.js";
import { secretService } from "../services/secrets.js";
import { logActivity } from "../services/activity-log.js";
import { forbidden } from "../errors.js";
import {
  actorCanViewAllCompanyIssues,
  assertAuthenticated,
  assertBoard,
  assertCompanyAccess,
  getActorInfo,
} from "./authz.js";

/**
 * Public-ish OAuth handshake routes for `integration_credentials`.
 *
 * Lives at `/api/integrations/oauth/:provider/*`. There are two
 * endpoints:
 *
 *   - `GET .../authorize?credentialId=<uuid>&mode=initial|reconnect`
 *     The browser hits this from the Integrations UI. We verify the
 *     caller is owner/admin of the credential's company, mint a signed
 *     state JWT, and `302` to the provider's authorize URL. **Renders
 *     no HTML.** The state binds (companyId, credentialId, provider,
 *     mode, nonce, exp) so a leaked state can't be replayed against a
 *     different credential.
 *
 *   - `GET .../callback?code=...&state=...[&accounts-server=...]`
 *     The provider redirects the user's browser here after consent. We
 *     verify the state JWT, exchange the code for tokens, persist the
 *     refresh token by rotating the credential's encrypted secret, and
 *     `302` back to `/company/settings/integrations?connected=<id>`.
 *
 * Authentication notes:
 *   - Both endpoints require a logged-in session. The provider redirect
 *     preserves cookies, so the user's session is intact on callback.
 *   - We additionally check the session has admin on the credential's
 *     company, even though the state JWT is bound to that company. The
 *     state JWT prevents replay/CSRF; the session check enforces that
 *     the *current* viewer still has authority to finalize the
 *     credential (e.g. an admin could not start the dance and then have
 *     their access revoked mid-flow).
 *   - On unrecoverable errors we render a small HTML error page so the
 *     admin sees what went wrong; we never bounce them back to the
 *     Settings page silently.
 *
 * Secrets handling:
 *   - `client_secret` and `refresh_token` are read out of and written
 *     into the secret store only inside the service layer. This file
 *     never logs them and never includes them in redirects.
 *   - The fetched access token is NOT persisted — only refreshed on
 *     demand by the OAuth service's in-process cache.
 */

export interface OAuthRoutesDeps {
  /** Override fetch in tests. */
  fetchImpl?: typeof fetch;
}

const SETTINGS_PATH = "/company/settings/integrations";

function renderCallbackError(res: Response, opts: { title: string; detail: string }) {
  // Minimal styled HTML — no framework, no inline JS. Surfaces enough
  // for the admin to retry without leaking provider error specifics
  // that might include identifiers (we still keep the safe message
  // short and high-level).
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    opts.title,
  )}</title><style>body{font:14px/1.5 system-ui,sans-serif;padding:2rem;max-width:42rem;margin:0 auto;color:#111}h1{font-size:1.25rem;margin:0 0 0.5rem}p{margin:0.5rem 0}.muted{color:#666}.actions{margin-top:1.5rem}a{color:#2563eb}</style></head><body><h1>${escapeHtml(
    opts.title,
  )}</h1><p>${escapeHtml(opts.detail)}</p><div class="actions"><a href="${SETTINGS_PATH}">Return to Settings → Integrations</a></div></body></html>`;
  res.status(400).type("html").send(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertCompanyAdmin(req: Request, companyId: string) {
  if (!actorCanViewAllCompanyIssues(req, companyId)) {
    throw forbidden("Owner or admin access required to manage integrations");
  }
}

export function integrationOAuthRoutes(db: Db, deps: OAuthRoutesDeps = {}) {
  const router = Router();
  const credentials = integrationCredentialService(db);
  const secrets = secretService(db);

  /**
   * Kick off (or restart, for reconnect) the OAuth handshake for an
   * already-drafted credential. The credential row must already exist
   * — for first-time connect the UI creates the draft via
   * `POST /integrations/credentials-oauth-draft`, which returns the
   * initial authorize URL directly. This endpoint exists primarily for
   * the **Reconnect** button: re-mint state and redirect to the
   * provider without re-collecting the client secret.
   */
  router.get("/integrations/oauth/:provider/authorize", async (req, res, next) => {
    try {
      assertAuthenticated(req);
      assertBoard(req);

      const providerId = req.params.provider as string;
      const provider = INTEGRATION_PROVIDERS[providerId];
      if (!provider?.oauth) {
        renderCallbackError(res, {
          title: "Unknown OAuth provider",
          detail: `No OAuth flow is configured for provider "${providerId}".`,
        });
        return;
      }

      const credentialId = String(req.query.credentialId ?? "").trim();
      const modeRaw = String(req.query.mode ?? "reconnect").trim();
      const mode: "initial" | "reconnect" = modeRaw === "initial" ? "initial" : "reconnect";
      if (!credentialId) {
        renderCallbackError(res, {
          title: "Missing credential id",
          detail: "The authorize URL must include a `credentialId` query parameter.",
        });
        return;
      }

      // Load the credential to recover the clientId + fields needed to
      // build the authorize URL. We do NOT read the client secret here
      // (not needed for the redirect, and unnecessary plaintext exposure).
      const row = await credentials.loadCredentialRow(credentialId);
      if (!row) {
        renderCallbackError(res, {
          title: "Credential not found",
          detail: "That integration credential does not exist or has been deleted.",
        });
        return;
      }
      if (row.provider !== providerId) {
        renderCallbackError(res, {
          title: "Provider mismatch",
          detail: "The credential belongs to a different provider.",
        });
        return;
      }
      assertCompanyAccess(req, row.companyId);
      assertCompanyAdmin(req, row.companyId);

      if (!row.secretId) {
        renderCallbackError(res, {
          title: "Credential is not initialized",
          detail: "Re-create the credential from the Add Credential drawer.",
        });
        return;
      }

      const material = await secrets.resolveSecretValue(row.companyId, row.secretId, "latest");
      let parsed: { clientId?: string };
      try {
        parsed = JSON.parse(material);
      } catch {
        renderCallbackError(res, {
          title: "Credential material is malformed",
          detail: "Delete and re-create the credential.",
        });
        return;
      }
      if (!parsed.clientId) {
        renderCallbackError(res, {
          title: "Credential is missing client id",
          detail: "Delete and re-create the credential.",
        });
        return;
      }

      const metaFields =
        ((row.metadata as Record<string, unknown> | null)?.fields as Record<string, string>) ?? {};

      const state = signOAuthState({
        companyId: row.companyId,
        credentialId: row.id,
        provider: providerId,
        mode,
      });
      const redirectUri = resolveOAuthRedirectUri(req, providerId);
      const authorizeUrl = buildAuthorizeUrl({
        providerId,
        fields: metaFields,
        clientId: parsed.clientId,
        redirectUri,
        state,
      });

      res.redirect(302, authorizeUrl);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Provider redirects the user's browser here after consent. We verify
   * the state JWT, exchange the code for tokens, and persist them. On
   * success the user lands back at `/company/settings/integrations` with
   * `?connected=<credentialId>` so the UI can flash a confirmation.
   */
  router.get("/integrations/oauth/:provider/callback", async (req, res, next) => {
    try {
      const providerId = req.params.provider as string;
      const provider = INTEGRATION_PROVIDERS[providerId];
      if (!provider?.oauth) {
        renderCallbackError(res, {
          title: "Unknown OAuth provider",
          detail: `No OAuth flow is configured for provider "${providerId}".`,
        });
        return;
      }

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const stateToken = typeof req.query.state === "string" ? req.query.state : "";
      const providerError = typeof req.query.error === "string" ? req.query.error : "";
      // Zoho sends `accounts-server`. We also accept `accountsServer` in
      // case other providers normalize. The key uses a dash so Express
      // exposes it as-is on `req.query`.
      const accountsServerOverride =
        (typeof req.query["accounts-server"] === "string" ? req.query["accounts-server"] : "") ||
        (typeof req.query["accountsServer"] === "string" ? (req.query["accountsServer"] as string) : "");

      if (providerError) {
        renderCallbackError(res, {
          title: "Provider declined the connection",
          detail: `The provider returned an error: ${providerError}. You can retry from Settings → Integrations.`,
        });
        return;
      }
      if (!code || !stateToken) {
        renderCallbackError(res, {
          title: "Missing OAuth response",
          detail: "The provider did not return both `code` and `state`. Retry the connect flow.",
        });
        return;
      }

      const verified = verifyOAuthState(stateToken);
      if (!verified.ok) {
        renderCallbackError(res, {
          title: "Could not verify OAuth state",
          detail: `State token rejected: ${verified.reason}. Retry the connect flow.`,
        });
        return;
      }
      const claims = verified.claims;
      if (claims.provider !== providerId) {
        renderCallbackError(res, {
          title: "State / provider mismatch",
          detail: "The state token was minted for a different provider. Retry the connect flow.",
        });
        return;
      }

      // Re-verify session authz against the company encoded in the state.
      // The state JWT prevents tampering; the session check enforces
      // *current* authority to finalize.
      assertAuthenticated(req);
      assertBoard(req);
      assertCompanyAccess(req, claims.companyId);
      assertCompanyAdmin(req, claims.companyId);

      const row = await credentials.loadCredentialRow(claims.credentialId);
      if (!row || row.companyId !== claims.companyId) {
        renderCallbackError(res, {
          title: "Credential not found",
          detail: "The credential being connected no longer exists. Retry from Settings → Integrations.",
        });
        return;
      }
      if (!row.secretId) {
        renderCallbackError(res, {
          title: "Credential is not initialized",
          detail: "Delete and re-create the credential from the Add Credential drawer.",
        });
        return;
      }

      // We need clientId + clientSecret to exchange the code. They're
      // already encrypted in the secret store — pull, exchange, never log.
      const materialRaw = await secrets.resolveSecretValue(
        claims.companyId,
        row.secretId,
        "latest",
      );
      let material: { clientId?: string; clientSecret?: string };
      try {
        material = JSON.parse(materialRaw);
      } catch {
        renderCallbackError(res, {
          title: "Credential material is malformed",
          detail: "Delete and re-create the credential.",
        });
        return;
      }
      if (!material.clientId || !material.clientSecret) {
        renderCallbackError(res, {
          title: "Credential is missing client id or secret",
          detail: "Delete and re-create the credential.",
        });
        return;
      }

      const metaFields =
        ((row.metadata as Record<string, unknown> | null)?.fields as Record<string, string>) ?? {};
      const redirectUri = resolveOAuthRedirectUri(req, providerId);

      const tokenResp = await exchangeCodeForTokens({
        providerId,
        code,
        fields: metaFields,
        accountsServerOverride: accountsServerOverride || undefined,
        clientId: material.clientId,
        clientSecret: material.clientSecret,
        redirectUri,
        fetchImpl: deps.fetchImpl,
      });

      const apiDomainField = provider.oauth.apiDomainResponseField;
      const apiDomain =
        apiDomainField && typeof tokenResp.raw[apiDomainField] === "string"
          ? (tokenResp.raw[apiDomainField] as string)
          : undefined;

      const actorInfo = getActorInfo(req);
      await credentials.setOAuthTokens(
        claims.companyId,
        claims.credentialId,
        {
          refreshToken: tokenResp.refreshToken ?? "",
          apiDomain,
          accountsServer: accountsServerOverride || undefined,
        },
        {
          userId: actorInfo.actorType === "user" ? actorInfo.actorId : null,
          agentId: actorInfo.agentId,
        },
      );
      // Make sure any cached access token from a prior connect attempt
      // is purged so the very next API call refreshes against the new
      // refresh token.
      clearAccessTokenCache(claims.credentialId);

      await logActivity(db, {
        companyId: claims.companyId,
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        action:
          claims.mode === "reconnect"
            ? "integration.credential.oauth.reconnected"
            : "integration.credential.oauth.connected",
        entityType: "integration_credential",
        entityId: claims.credentialId,
        details: {
          provider: providerId,
          apiDomain: apiDomain ?? null,
        },
      });

      // Routes in this app are company-prefixed (e.g. `/NOR/company/...`).
      // The prefix is the company's `issuePrefix` (the same short token
      // used for issue IDs). Look it up so the user lands on the actual
      // Integrations page with the success banner instead of falling
      // back to a generic landing page. If the lookup fails for any
      // reason we still redirect — to the unprefixed path as before —
      // so a deployed app without a matching prefix route still gets
      // the connected=<id> query string for the UI to act on.
      const prefixRow = await db
        .select({ issuePrefix: companies.issuePrefix })
        .from(companies)
        .where(eq(companies.id, claims.companyId))
        .then((rows) => rows[0] ?? null);
      const prefix = prefixRow?.issuePrefix ?? "";
      const settingsPath = prefix
        ? `/${encodeURIComponent(prefix)}${SETTINGS_PATH}`
        : SETTINGS_PATH;
      const destination =
        `${settingsPath}?connected=${encodeURIComponent(claims.credentialId)}` +
        `&provider=${encodeURIComponent(providerId)}`;
      res.redirect(302, destination);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
