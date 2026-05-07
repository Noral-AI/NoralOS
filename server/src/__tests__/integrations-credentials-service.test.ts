import { describe, expect, it } from "vitest";
import { computeMaskedSuffix } from "../services/integrations/credentials-service.ts";

describe("computeMaskedSuffix", () => {
  it("uses last four chars when plaintext is at least 4 long", () => {
    expect(computeMaskedSuffix("sk-1234567890")).toBe("••••7890");
    expect(computeMaskedSuffix("abcd")).toBe("••••abcd");
  });

  it("falls back to placeholder for unknown / short / empty values", () => {
    expect(computeMaskedSuffix("")).toBe("••••????");
    expect(computeMaskedSuffix(null)).toBe("••••????");
    expect(computeMaskedSuffix(undefined)).toBe("••••????");
    expect(computeMaskedSuffix("ab")).toBe("••••????");
  });

  it("never returns the full plaintext", () => {
    const secret = "this-is-a-very-long-api-key-with-secret-content";
    const suffix = computeMaskedSuffix(secret);
    expect(suffix.length).toBeLessThanOrEqual(8);
    expect(suffix).not.toContain("very-long-api-key");
  });
});
