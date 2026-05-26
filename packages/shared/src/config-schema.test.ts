import { describe, expect, it } from "vitest";
import { noralosConfigSchema } from "./config-schema.js";

describe("noralos config schema", () => {
  it("defaults omitted runtime paths to legacy instance-root locations", () => {
    const parsed = noralosConfigSchema.parse({
      $meta: {
        version: 1,
        updatedAt: "2026-05-10T00:00:00.000Z",
        source: "configure",
      },
      database: {
        mode: "embedded-postgres",
      },
      logging: {
        mode: "file",
      },
      server: {},
    });

    expect(parsed.database.embeddedPostgresDataDir).toBe("~/.noralos/instances/default/db");
    expect(parsed.database.backup.dir).toBe("~/.noralos/instances/default/data/backups");
    expect(parsed.logging.logDir).toBe("~/.noralos/instances/default/logs");
    expect(parsed.storage.localDisk.baseDir).toBe("~/.noralos/instances/default/data/storage");
    expect(parsed.secrets.localEncrypted.keyFilePath).toBe("~/.noralos/instances/default/secrets/master.key");
  });
});
