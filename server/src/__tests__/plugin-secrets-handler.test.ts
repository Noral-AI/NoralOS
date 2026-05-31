import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@noralos/db";
import { companySecretVersions, companySecrets, pluginConfig } from "@noralos/db";
import * as providerRegistry from "../secrets/provider-registry.js";
import * as pluginRegistry from "../services/plugin-registry.js";
import { createPluginSecretsHandler } from "../services/plugin-secrets-handler.js";

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111";
const SECRET_REF = "77777777-7777-4777-8777-777777777777";

/**
 * Minimal chainable Drizzle stub: `db.select().from(table).where(...).then(cb)`
 * resolves with the rows registered for `table`. Only the access pattern the
 * handler uses is modelled.
 */
function makeDb(rowsByTable: Map<unknown, unknown[]>): Db {
  return {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                then<T>(cb: (rows: unknown[]) => T): Promise<T> {
                  return Promise.resolve(cb(rowsByTable.get(table) ?? []));
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Db;
}

function stubRegistry(plugin: unknown): void {
  vi.spyOn(pluginRegistry, "pluginRegistryService").mockReturnValue({
    getById: async () => plugin,
  } as unknown as ReturnType<typeof pluginRegistry.pluginRegistryService>);
}

describe("createPluginSecretsHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a secret that is wired into the plugin's config", async () => {
    stubRegistry({ manifestJson: null });
    const resolveVersion = vi.fn(async () => "resolved-api-key");
    vi.spyOn(providerRegistry, "getSecretProvider").mockReturnValue({
      resolveVersion,
    } as unknown as ReturnType<typeof providerRegistry.getSecretProvider>);

    const db = makeDb(
      new Map<unknown, unknown[]>([
        [pluginConfig, [{ configJson: { apiKeyRef: SECRET_REF } }]],
        [
          companySecrets,
          [{ id: SECRET_REF, provider: "local_encrypted", latestVersion: 7, externalRef: null }],
        ],
        [
          companySecretVersions,
          [{ secretId: SECRET_REF, version: 7, material: { ciphertext: "x" } }],
        ],
      ]),
    );

    const handler = createPluginSecretsHandler({ db, pluginId: PLUGIN_ID });
    await expect(handler.resolve({ secretRef: SECRET_REF })).resolves.toBe("resolved-api-key");
    expect(resolveVersion).toHaveBeenCalledTimes(1);
  });

  it("refuses to resolve a secret that is not referenced in the plugin's config", async () => {
    // Scope boundary: a UUID the operator never bound into this plugin's config
    // must not resolve — even if it exists for some other plugin/company.
    stubRegistry({ manifestJson: null });

    const db = makeDb(new Map<unknown, unknown[]>([[pluginConfig, [{ configJson: {} }]]]));

    const handler = createPluginSecretsHandler({ db, pluginId: PLUGIN_ID });
    await expect(handler.resolve({ secretRef: SECRET_REF })).rejects.toThrow(/secret not found/i);
  });

  it("rejects malformed secret refs before any lookup", async () => {
    stubRegistry({ manifestJson: null });
    const handler = createPluginSecretsHandler({ db: {} as Db, pluginId: PLUGIN_ID });
    await expect(handler.resolve({ secretRef: "not-a-uuid" })).rejects.toThrow(
      /invalid secret reference/i,
    );
  });
});
