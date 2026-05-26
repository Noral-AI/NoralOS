import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolveNoralosHomeDir,
  resolveNoralosInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

<<<<<<< v2026.525.0
  it("defaults to ~/.paperclip and default instance", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-home-paths-"));
    process.env.PAPERCLIP_HOME = home;
    delete process.env.PAPERCLIP_INSTANCE_ID;
=======
  it("defaults to ~/.noralos and default instance", () => {
    delete process.env.NORALOS_HOME;
    delete process.env.NORALOS_INSTANCE_ID;
>>>>>>> master

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(home);
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(home, "instances", "default", "config.json"));
  });

  it("supports NORALOS_HOME and explicit instance ids", () => {
    process.env.NORALOS_HOME = "~/noralos-home";

    const home = resolveNoralosHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "paperclip-home"));
    expect(resolveNoralosInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
<<<<<<< v2026.525.0
    expect(() => resolvePaperclipInstanceId("bad/id")).toThrow(/Invalid PAPERCLIP_INSTANCE_ID/);
=======
    expect(() => resolveNoralosInstanceId("bad/id")).toThrow(/Invalid instance id/);
>>>>>>> master
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
