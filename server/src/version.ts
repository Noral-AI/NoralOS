/**
 * Server build / version metadata.
 *
 * `serverVersion` reflects the npm `package.json` version (semver) and is
 * always available. `gitSha` and `buildTime` are populated at container
 * build-time via Docker `ARG` / `ENV` plumbing (see Dockerfile and
 * .github/workflows/docker.yml). For local dev runs, both are typically
 * empty strings; this module normalises them to `null` so callers can do a
 * simple truthiness check without re-implementing the same coercion.
 */
import { createRequire } from "node:module";

type PackageJson = {
  version?: string;
};

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as PackageJson;

export const serverVersion = pkg.version ?? "0.0.0";

function nonEmptyEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Full git commit SHA the running server was built from. `null` when the
 * image was built without `--build-arg GIT_SHA`, e.g. ad-hoc local builds.
 */
export const gitSha: string | null = nonEmptyEnv("NORALOS_GIT_SHA");

/**
 * Short (7-char) form of `gitSha`, suitable for unauthenticated display.
 * Truncating server-side keeps the unauth API contract narrow even if the
 * caller passes a non-standard SHA length.
 */
export const gitShaShort: string | null = gitSha ? gitSha.slice(0, 7) : null;

/**
 * ISO-8601 build timestamp recorded at image-build time. `null` when the
 * image was built without `--build-arg BUILD_TIME`.
 */
export const buildTime: string | null = nonEmptyEnv("NORALOS_BUILD_TIME");
