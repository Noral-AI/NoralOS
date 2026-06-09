import { afterEach, describe, expect, it } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import { getCookies } from "better-auth/cookies";
import {
  buildBetterAuthAdvancedOptions,
  createBetterAuthInstance,
  deriveAuthCookiePrefix,
  deriveAuthTrustedOrigins,
  resolveCrossSubDomainCookieDomain,
  shouldDisableSecureAuthCookies,
} from "../auth/better-auth.js";

const ORIGINAL_INSTANCE_ID = process.env.NORALOS_INSTANCE_ID;
const ORIGINAL_COOKIE_DOMAIN = process.env.BETTER_AUTH_COOKIE_DOMAIN;

afterEach(() => {
  if (ORIGINAL_INSTANCE_ID === undefined) delete process.env.NORALOS_INSTANCE_ID;
  else process.env.NORALOS_INSTANCE_ID = ORIGINAL_INSTANCE_ID;
  if (ORIGINAL_COOKIE_DOMAIN === undefined) delete process.env.BETTER_AUTH_COOKIE_DOMAIN;
  else process.env.BETTER_AUTH_COOKIE_DOMAIN = ORIGINAL_COOKIE_DOMAIN;
});

describe("Better Auth cookie scoping", () => {
  it("derives an instance-scoped cookie prefix", () => {
    expect(deriveAuthCookiePrefix("default")).toBe("noralos-default");
    expect(deriveAuthCookiePrefix("PAP-1601-worktree")).toBe("noralos-PAP-1601-worktree");
  });

  it("uses NORALOS_INSTANCE_ID for the Better Auth cookie prefix", () => {
    process.env.NORALOS_INSTANCE_ID = "sat-worktree";

    const advanced = buildBetterAuthAdvancedOptions({ disableSecureCookies: false });

    expect(advanced).toEqual({
      cookiePrefix: "noralos-sat-worktree",
    });
    expect(getCookies({ advanced } as BetterAuthOptions).sessionToken.name).toBe(
      "noralos-sat-worktree.session_token",
    );
  });

  it("keeps local http auth cookies non-secure while preserving the scoped prefix", () => {
    process.env.NORALOS_INSTANCE_ID = "pap-worktree";

    expect(buildBetterAuthAdvancedOptions({ disableSecureCookies: true })).toEqual({
      cookiePrefix: "noralos-pap-worktree",
      useSecureCookies: false,
    });
    expect(getCookies({
      advanced: buildBetterAuthAdvancedOptions({ disableSecureCookies: true }),
    } as BetterAuthOptions).sessionToken.name).toBe("noralos-pap-worktree.session_token");
  });

  it("disables secure cookies for authenticated private auto-origin dev servers", () => {
    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      publicUrl: undefined,
    })).toBe(true);
  });

  it("keeps secure cookies for authenticated public auto-origin servers", () => {
    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      publicUrl: undefined,
    })).toBe(false);
  });

  it("uses an explicit public URL when deciding whether secure cookies are required", () => {
    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      publicUrl: "https://paperclip.example.test",
    })).toBe(false);

    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "http://paperclip.local.test:3100",
      publicUrl: undefined,
    })).toBe(true);
  });

  it("disables secure cookies when no canonical public auth URL is configured", () => {
    delete process.env.PAPERCLIP_PUBLIC_URL;

    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
    } as Parameters<typeof shouldDisableSecureAuthCookies>[0])).toBe(true);
  });

  it("derives secure cookie behavior from the configured public auth URL", () => {
    delete process.env.PAPERCLIP_PUBLIC_URL;

    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "http://paperclip-dev:46259",
    } as Parameters<typeof shouldDisableSecureAuthCookies>[0])).toBe(true);
    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "https://paperclip.example.test",
    } as Parameters<typeof shouldDisableSecureAuthCookies>[0])).toBe(false);
  });

  it("uses the caller-resolved public URL for cookie security", () => {
    process.env.PAPERCLIP_PUBLIC_URL = "https://ignored.example.test";

    expect(shouldDisableSecureAuthCookies({
      deploymentMode: "authenticated",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "https://paperclip.example.test",
      publicUrl: "http://paperclip-dev:46259",
    } as Parameters<typeof shouldDisableSecureAuthCookies>[0])).toBe(true);
  });

  it("adds hostname port variants for authenticated mode on non-default ports", () => {
    const trustedOrigins = deriveAuthTrustedOrigins({
      deploymentMode: "authenticated",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      allowedHostnames: ["Board.Example.Test"],
      port: 3101,
    } as Parameters<typeof deriveAuthTrustedOrigins>[0]);

    expect(trustedOrigins).toEqual(expect.arrayContaining([
      "https://board.example.test",
      "http://board.example.test",
      "https://board.example.test:3101",
      "http://board.example.test:3101",
    ]));
  });

  it("prefers an explicit resolved listen port over the configured port", () => {
    const trustedOrigins = deriveAuthTrustedOrigins({
      deploymentMode: "authenticated",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      allowedHostnames: ["board.example.test"],
      port: 3100,
    } as Parameters<typeof deriveAuthTrustedOrigins>[0], { listenPort: 3101 });

    expect(trustedOrigins).toEqual(expect.arrayContaining([
      "https://board.example.test:3101",
      "http://board.example.test:3101",
    ]));
    expect(trustedOrigins).not.toContain("https://board.example.test:3100");
    expect(trustedOrigins).not.toContain("http://board.example.test:3100");
  });
});

describe("Better Auth cross-subdomain cookie domain (SSO)", () => {
  it("returns undefined when BETTER_AUTH_COOKIE_DOMAIN is unset", () => {
    delete process.env.BETTER_AUTH_COOKIE_DOMAIN;
    expect(resolveCrossSubDomainCookieDomain()).toBeUndefined();
  });

  it("returns the dot-prefixed domain when set", () => {
    process.env.BETTER_AUTH_COOKIE_DOMAIN = ".noral.ai";
    expect(resolveCrossSubDomainCookieDomain()).toBe(".noral.ai");
  });

  it("throws when set without a leading dot", () => {
    process.env.BETTER_AUTH_COOKIE_DOMAIN = "noral.ai";
    expect(() => resolveCrossSubDomainCookieDomain()).toThrow(/leading dot/);
  });

  it("ignores whitespace-only values", () => {
    process.env.BETTER_AUTH_COOKIE_DOMAIN = "   ";
    expect(resolveCrossSubDomainCookieDomain()).toBeUndefined();
  });

  it("does NOT add crossSubDomainCookies when domain is undefined (default behaviour preserved)", () => {
    const advanced = buildBetterAuthAdvancedOptions({ disableSecureCookies: false });
    expect(advanced.crossSubDomainCookies).toBeUndefined();
  });

  it("adds crossSubDomainCookies with the given domain when supplied", () => {
    const advanced = buildBetterAuthAdvancedOptions({
      disableSecureCookies: false,
      crossSubDomainCookieDomain: ".noral.ai",
    });
    expect(advanced.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: ".noral.ai",
    });
  });

  it("renames the cookie prefix when cross-subdomain is set (legacy host-only cookies must not shadow)", () => {
    // Same-name host-only + domain cookies coexist in the browser and the
    // stale host-only one sorts first — that shadowing broke Chrome
    // sign-in when SSO cookies first shipped (VPS disabled 2026-05-29).
    // The `-sso` suffix makes the domain cookies a distinct name.
    process.env.NORALOS_INSTANCE_ID = "test-inst";
    const advanced = buildBetterAuthAdvancedOptions({
      disableSecureCookies: true,
      crossSubDomainCookieDomain: ".noral.ai",
    });
    expect(advanced).toEqual({
      cookiePrefix: "noralos-test-inst-sso",
      useSecureCookies: false,
      crossSubDomainCookies: { enabled: true, domain: ".noral.ai" },
    });
  });

  it("keeps the unsuffixed cookie prefix when cross-subdomain is off", () => {
    process.env.NORALOS_INSTANCE_ID = "test-inst";
    const advanced = buildBetterAuthAdvancedOptions({ disableSecureCookies: false });
    expect(advanced).toEqual({ cookiePrefix: "noralos-test-inst" });
  });

  it("Better Auth cookie computation accepts the cross-subdomain config without errors", () => {
    const advanced = buildBetterAuthAdvancedOptions({
      disableSecureCookies: false,
      crossSubDomainCookieDomain: ".noral.ai",
    });
    // This is the same call Better Auth makes internally when minting cookies —
    // it shouldn't throw on our config shape.
    const cookies = getCookies({ advanced } as BetterAuthOptions);
    expect(cookies.sessionToken.name).toMatch(/session_token$/);
  });

  it("createBetterAuthInstance honours BETTER_AUTH_COOKIE_DOMAIN end-to-end", () => {
    // Regression guard: the #133 paperclip sync dropped the
    // crossSubDomainCookieDomain pass-through at the instance call site,
    // silently turning BETTER_AUTH_COOKIE_DOMAIN into a no-op. Assert on
    // the constructed instance, not just the options builder.
    process.env.NORALOS_INSTANCE_ID = "wired-inst";
    process.env.BETTER_AUTH_COOKIE_DOMAIN = ".noral.ai";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";

    try {
      const auth = createBetterAuthInstance({} as never, {
        deploymentMode: "authenticated",
        deploymentExposure: "public",
        authBaseUrlMode: "explicit",
        authPublicBaseUrl: "https://agent.example.test",
        authDisableSignUp: true,
      } as never, ["https://agent.example.test"]);

      const cookies = getCookies(auth.options as BetterAuthOptions);
      expect(cookies.sessionToken.name).toContain("noralos-wired-inst-sso.session_token");
      expect(cookies.sessionToken.attributes).toMatchObject({ domain: ".noral.ai" });
    } finally {
      delete process.env.BETTER_AUTH_SECRET;
    }
  });
});
