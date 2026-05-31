-- Heal pre-0082 secret-version drift and guard against recurrence.
--
-- Migration 0082 added company_secret_versions.status with DEFAULT 'current'
-- and never demoted pre-existing non-current versions, so secrets created
-- before it ended up with MULTIPLE 'current' versions and a
-- company_secrets.latest_version that could point at a stale/revoked version.
-- That silently broke secret resolution: resolveSecretValueInternal resolves
-- "latest" via latest_version, fetched the stale version, and threw
-- version_inactive ("apiKey resolution failed").
--
-- The runtime write paths (create / rotate / importRemoteSecrets) already keep
-- exactly one 'current' version and an aligned latest_version. This migration
-- repairs any rows 0082 left inconsistent, then enforces the invariant with a
-- partial unique index so the bad state can never be reached again.

-- 1. Collapse duplicate 'current' versions: keep only the highest-versioned
--    'current' per secret; demote the rest to 'previous'.
UPDATE "company_secret_versions" v
SET "status" = 'previous'
WHERE v."status" = 'current'
  AND v."version" < (
    SELECT MAX(v2."version")
    FROM "company_secret_versions" v2
    WHERE v2."secret_id" = v."secret_id" AND v2."status" = 'current'
  );
--> statement-breakpoint
-- 2. Re-point company_secrets.latest_version at the (now single) 'current'
--    version wherever it has drifted away from it.
UPDATE "company_secrets" cs
SET "latest_version" = cur."version", "updated_at" = now()
FROM (
  SELECT "secret_id", MAX("version") AS "version"
  FROM "company_secret_versions"
  WHERE "status" = 'current'
  GROUP BY "secret_id"
) cur
WHERE cs."id" = cur."secret_id" AND cs."latest_version" <> cur."version";
--> statement-breakpoint
-- 3. Enforce the invariant going forward: at most one 'current' version per
--    secret. The runtime paths already uphold this, so this index is a guard,
--    not a behavior change.
CREATE UNIQUE INDEX IF NOT EXISTS "company_secret_versions_one_current_per_secret_uq"
  ON "company_secret_versions" ("secret_id")
  WHERE "status" = 'current';
