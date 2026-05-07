import { describe, expect, it, vi } from "vitest";

// Cheap unit test for the maskSuffix helper. The credentialService
// constructor pulls in heavy module side-effects via `secretService`, so
// we mock the secret-service entry point and only exercise the
// `_maskSuffix` helper that the service exposes. Anything that touches a
// real DB lives in the embedded-postgres integration tests.
vi.mock("../services/secrets.js", () => ({
  secretService: () => ({
    getById: async () => null,
    getByName: async () => null,
    resolveSecretValue: async () => "",
    create: async () => null,
    rotate: async () => null,
  }),
}));

import { integrationCredentialService } from "../services/integrations/credentials.js";

describe("integrationCredentialService._maskSuffix", () => {
  const svc = integrationCredentialService({} as never);

  it("returns the last four characters prefixed with `****`", () => {
    expect(svc._maskSuffix("sk-test-1234567890abcd")).toBe("****abcd");
    expect(svc._maskSuffix("XYZqr")).toBe("****YZqr");
  });

  it("never reveals the value when it is four chars or shorter", () => {
    expect(svc._maskSuffix("abcd")).toBe("****");
    expect(svc._maskSuffix("ab")).toBe("****");
    expect(svc._maskSuffix("")).toBe("****");
  });

  it("trims whitespace before computing the tail", () => {
    expect(svc._maskSuffix("   sk_live_AAAA1234   ")).toBe("****1234");
  });
});
