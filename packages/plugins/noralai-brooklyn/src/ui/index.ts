/**
 * Browser-safe UI surface for the Brooklyn LLM adapter.
 *
 * This entry point is imported by the dashboard bundle (`ui/src/adapters/
 * noralai-brooklyn/`) and MUST stay free of node-only imports so the Vite
 * build can tree-shake it cleanly.
 *
 * The React form component that uses these helpers lives in the dashboard
 * package, not here — that boundary mirrors how every other adapter
 * (claude-local, gemini-local, openclaw-gateway) splits parse/build into
 * the adapter package and React into `ui/src/adapters/`.
 */

export { buildBrooklynConfig } from "./build-config.js";
export { parseBrooklynStdoutLine } from "./parse-stdout.js";
