import { describe, expect, it } from "vitest";

import { findUIAdapter, listUIAdapters } from "../registry";
import { isEnabledAdapterType, listAdapterOptions } from "../metadata";
import { getAdapterDisplay } from "../adapter-display-registry";

describe("noralai_brooklyn adapter is wired into the dashboard", () => {
  it("is present in the UI adapter registry", () => {
    const adapter = findUIAdapter("noralai_brooklyn");
    expect(adapter).not.toBeNull();
    expect(adapter?.type).toBe("noralai_brooklyn");
    expect(adapter?.label).toBe("NoralAI");
  });

  it("appears in the agent-create adapter dropdown options", () => {
    const opts = listAdapterOptions();
    const brooklyn = opts.find((o) => o.value === "noralai_brooklyn");
    expect(brooklyn).toBeDefined();
    // Must not be marked coming-soon — otherwise the picker disables it.
    expect(brooklyn?.comingSoon).toBe(false);
  });

  it("is enabled (not coming-soon) and uses the NoralAI display label", () => {
    expect(isEnabledAdapterType("noralai_brooklyn")).toBe(true);
    expect(getAdapterDisplay("noralai_brooklyn").label).toBe("NoralAI");
  });

  it("shows up alongside the rest of the built-in adapters, exactly once", () => {
    const types = listUIAdapters().map((a) => a.type);
    const count = types.filter((t) => t === "noralai_brooklyn").length;
    expect(count).toBe(1);
  });
});
