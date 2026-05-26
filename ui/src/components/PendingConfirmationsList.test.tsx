// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingConfirmationListItem, RequestConfirmationInteraction } from "@noralos/shared";
import { PendingConfirmationsList } from "./PendingConfirmationsList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

function createConfirmation(
  overrides: {
    interaction?: Partial<RequestConfirmationInteraction>;
    issue?: Partial<PendingConfirmationListItem["issue"]>;
  } = {},
): PendingConfirmationListItem {
  const baseInteraction: RequestConfirmationInteraction = {
    id: "interaction-1",
    companyId: "company-1",
    issueId: "issue-uuid-1",
    kind: "request_confirmation",
    status: "pending",
    continuationPolicy: "wake_assignee",
    idempotencyKey: null,
    sourceCommentId: null,
    sourceRunId: null,
    title: "Confirm A",
    summary: "Apply plan A?",
    createdByAgentId: "agent-1",
    createdByUserId: null,
    resolvedByAgentId: null,
    resolvedByUserId: null,
    payload: { version: 1, prompt: "Apply plan A?" },
    result: null,
    resolvedAt: null,
    createdAt: new Date("2026-05-17T12:00:00.000Z"),
    updatedAt: new Date("2026-05-17T12:00:00.000Z"),
    ...overrides.interaction,
  };

  return {
    interaction: baseInteraction,
    issue: {
      id: "issue-uuid-1",
      identifier: "NOR-100",
      title: "First issue",
      ...overrides.issue,
    },
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  container = null;
  root = null;
});

function render(confirmations: PendingConfirmationListItem[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<PendingConfirmationsList confirmations={confirmations} />);
  });
  return container;
}

describe("PendingConfirmationsList", () => {
  it("renders nothing when the list is empty", () => {
    const host = render([]);
    expect(host.textContent).toBe("");
    expect(host.querySelector("a")).toBeNull();
  });

  it("renders a section heading and one deep-linked row per confirmation", () => {
    const host = render([
      createConfirmation(),
      createConfirmation({
        interaction: { id: "interaction-2", title: "Confirm B", summary: "Apply plan B?" },
        issue: { id: "issue-uuid-2", identifier: "NOR-101", title: "Second issue" },
      }),
    ]);

    expect(host.textContent).toContain("Agent confirmations");

    const links = host.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("/issues/NOR-100");
    expect(links[0]?.textContent).toContain("Confirm A");
    expect(links[0]?.textContent).toContain("NOR-100");
    expect(links[0]?.textContent).toContain("First issue");
    expect(links[1]?.getAttribute("href")).toBe("/issues/NOR-101");
    expect(links[1]?.textContent).toContain("Confirm B");
    expect(links[1]?.textContent).toContain("NOR-101");
    expect(links[1]?.textContent).toContain("Second issue");
  });

  it("falls back to a default label and the issue UUID when title and identifier are missing", () => {
    const host = render([
      createConfirmation({
        interaction: { id: "interaction-3", title: null },
        issue: {
          id: "11111111-2222-3333-4444-555555555555",
          identifier: null,
          title: "Untitled issue",
        },
      }),
    ]);

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/issues/11111111-2222-3333-4444-555555555555");
    expect(link?.textContent).toContain("Confirmation requested");
    expect(link?.textContent).toContain("11111111");
    expect(link?.textContent).toContain("Untitled issue");
  });
});
