import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(packageRoot, "dist", "ui");

mkdirSync(uiDir, { recursive: true });
writeFileSync(path.join(uiDir, "index.js"), "export {};\n");
