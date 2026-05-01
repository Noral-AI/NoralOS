// One-off screenshot capture for BRAND_VERIFY.md.
// Captures noral.ai (live) + NoralOS (local Vite dev server) at desktop + mobile.
//
// Run from repo root:  node scripts/brand-verify-screenshots.mjs
// Requires: pnpm exec playwright install chromium (already cached at ~/Library/Caches/ms-playwright)
// Vite dev server must be running at http://127.0.0.1:5174

import playwrightPkg from "/private/tmp/noralos-audit/NoralOS/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.js";
const { chromium } = playwrightPkg;
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "BRAND_VERIFY_assets");
const NORAL_AI = "https://www.noral.ai/";
const NORALOS_DEV = "http://127.0.0.1:5174";

const captures = [
  // [label, url, viewport]
  ["noral-ai-home-desktop", NORAL_AI, { width: 1440, height: 900 }],
  ["noral-ai-home-mobile", NORAL_AI, { width: 390, height: 844 }],
  ["noralos-auth-desktop", `${NORALOS_DEV}/auth`, { width: 1440, height: 900 }],
  ["noralos-auth-mobile", `${NORALOS_DEV}/auth`, { width: 390, height: 844 }],
];

(async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  for (const [label, url, viewport] of captures) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    console.log(`[${label}] → ${url} @ ${viewport.width}×${viewport.height}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      // SPA may never reach networkidle; fall back to a fixed wait
      await page.waitForTimeout(4000);
    }
    // Extra wait for the runtime-Babel SPA on noral.ai to compile + render
    await page.waitForTimeout(3000);
    const path = resolve(OUT_DIR, `${label}.png`);
    await page.screenshot({ path, fullPage: false });
    console.log(`  ✓ ${path}`);
    await ctx.close();
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
