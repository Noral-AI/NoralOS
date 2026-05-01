import fs from "node:fs";
import { paperclipConfigSchema, type NoralosConfig } from "@noralos/shared";
import { resolveNoralosConfigPath } from "./paths.js";

export function readConfigFile(): NoralosConfig | null {
  const configPath = resolveNoralosConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return paperclipConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
