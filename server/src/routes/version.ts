/**
 * `GET /api/version` — build/runtime provenance for the running server.
 *
 * Two-tier output:
 *
 *  - Unauthenticated callers receive a deliberately narrow shape
 *    (`{ version, gitShaShort }`). This is enough for ops tooling to
 *    detect "is the deployed image at the expected commit" without
 *    handing fingerprints to the public internet.
 *
 *  - Authenticated callers (any board user or agent token) additionally
 *    receive the full SHA and the image build timestamp. Anyone with a
 *    valid session is already trusted with far more sensitive information
 *    elsewhere in the API; a 40-char hash of the public source tree is
 *    not load-bearing for security.
 *
 * This endpoint is intentionally separate from `/api/health`. Health
 * answers "is the system up?", which is checked aggressively by load
 * balancers and uptime monitors and must remain cheap and stable.
 * Version answers "what code is up?", which is checked rarely and is
 * subject to change as we add image labels / build provenance fields
 * over time.
 *
 * Auth model rationale: this route does NOT call `assertAuthenticated`
 * because the unauth shape is intentionally serviceable. Instead, the
 * handler reads `req.actor` (populated by the actor middleware in
 * `app.ts`) and decides shape on the fly.
 */
import { Router } from "express";
import {
  buildTime,
  gitSha,
  gitShaShort,
  serverVersion,
} from "../version.js";

export interface PublicVersionPayload {
  version: string;
  gitShaShort: string | null;
}

export interface AuthenticatedVersionPayload extends PublicVersionPayload {
  gitSha: string | null;
  buildTime: string | null;
  imageRevision: string | null;
  imageCreated: string | null;
}

export type VersionPayload = PublicVersionPayload | AuthenticatedVersionPayload;

/**
 * Pure, environment-agnostic builder. Exists as a standalone export so it
 * can be unit-tested without standing up an Express app.
 */
export function buildVersionPayload(input: {
  version: string;
  gitSha: string | null;
  gitShaShort: string | null;
  buildTime: string | null;
  authenticated: boolean;
}): VersionPayload {
  if (!input.authenticated) {
    return {
      version: input.version,
      gitShaShort: input.gitShaShort,
    };
  }
  return {
    version: input.version,
    gitShaShort: input.gitShaShort,
    gitSha: input.gitSha,
    buildTime: input.buildTime,
    // OCI image labels are sourced from the same env vars as the runtime
    // values (Dockerfile sets both from the same ARG), so on a properly
    // built image these match. Surfacing them under their OCI-spec names
    // makes the response self-documenting for tooling that already knows
    // the standard label names.
    imageRevision: input.gitSha,
    imageCreated: input.buildTime,
  };
}

function isAuthenticated(req: { actor?: { type?: string } }): boolean {
  const t = req.actor?.type;
  return t === "board" || t === "agent";
}

export function versionRoutes() {
  const router = Router();

  router.get("/version", (req, res) => {
    const payload = buildVersionPayload({
      version: serverVersion,
      gitSha,
      gitShaShort,
      buildTime,
      authenticated: isAuthenticated(req),
    });
    res.json(payload);
  });

  return router;
}
