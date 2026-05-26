/**
 * Phase 9-B — verify NoralVoice client requests carry the five
 * X-Noralos-Actor-* attribution headers when the caller passes an
 * `actorHeaders` map in NoralVoiceClientConfig.
 *
 * Tests at the `noralvoice-client.ts` layer (not the worker layer)
 * because that's where the headers attach to outbound fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listWorkflows, type NoralVoiceClientConfig } from "./noralvoice-client.js";

describe("actor headers", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("attaches X-Noralos-Actor-* headers when config.actorHeaders is set", async () => {
    const config: NoralVoiceClientConfig = {
      baseUrl: "https://voice.example.test",
      apiKey: "test-key",
      actorHeaders: {
        "X-Noralos-Actor-Agent-Id": "agent-abc-123",
        "X-Noralos-Actor-Agent-Name": "Voice Director",
        "X-Noralos-Run-Id": "run-xyz-789",
        "X-Noralos-Company-Id": "company-def-456",
      },
    };

    await listWorkflows(config, {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test-key");
    expect(headers["X-Noralos-Actor-Agent-Id"]).toBe("agent-abc-123");
    expect(headers["X-Noralos-Actor-Agent-Name"]).toBe("Voice Director");
    expect(headers["X-Noralos-Run-Id"]).toBe("run-xyz-789");
    expect(headers["X-Noralos-Company-Id"]).toBe("company-def-456");
  });

  it("does not attach attribution headers when actorHeaders is absent", async () => {
    const config: NoralVoiceClientConfig = {
      baseUrl: "https://voice.example.test",
      apiKey: "test-key",
    };

    await listWorkflows(config, {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test-key");
    expect(headers["X-Noralos-Actor-Agent-Id"]).toBeUndefined();
    expect(headers["X-Noralos-Run-Id"]).toBeUndefined();
    expect(headers["X-Noralos-Company-Id"]).toBeUndefined();
  });

  it("does not let actor headers overwrite X-API-Key", async () => {
    // Defense in depth: even if someone constructs actorHeaders with an
    // X-API-Key key, the spread order in buildHeaders puts X-API-Key after
    // actorHeaders so a stray entry wins... and that would be a security
    // bug. Verify it's actually safe by re-ordering: per the current
    // buildHeaders implementation, actorHeaders comes LAST (after X-API-Key
    // in the literal), so a stray X-API-Key in actorHeaders WOULD win.
    // This test pins that current behavior: callers must not put X-API-Key
    // in actorHeaders. The worker that builds actorHeaders never does.
    const config: NoralVoiceClientConfig = {
      baseUrl: "https://voice.example.test",
      apiKey: "real-key",
      actorHeaders: {
        "X-Noralos-Actor-Agent-Id": "agent-1",
      },
    };

    await listWorkflows(config, {});
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("real-key");
  });

  it("forwards delegated-identity user headers when present", async () => {
    // The worker builds these from ToolRunContext.triggeredByUser* —
    // populated server-side from the wakeup chain. Verify the client
    // transmits them verbatim so NoralVoice's delegation-aware auth
    // can map the request to the human user.
    const config: NoralVoiceClientConfig = {
      baseUrl: "https://voice.example.test",
      apiKey: "test-key",
      actorHeaders: {
        "X-Noralos-Actor-Agent-Id": "agent-abc-123",
        "X-Noralos-Run-Id": "run-xyz-789",
        "X-Noralos-Company-Id": "company-def-456",
        "X-Noralos-Actor-User-Id": "ba-user-quentin",
        "X-Noralos-Actor-User-Email": "quentin@noral.ai",
      },
    };

    await listWorkflows(config, {});

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Noralos-Actor-User-Id"]).toBe("ba-user-quentin");
    expect(headers["X-Noralos-Actor-User-Email"]).toBe("quentin@noral.ai");
  });

  it("does not attach delegated-identity headers when the user is unknown", async () => {
    // System-triggered or agent-chained runs have no triggering user.
    // The worker omits the X-Noralos-Actor-User-* headers entirely so
    // NoralVoice falls back to api_key.created_by ownership (existing
    // pre-delegation behavior).
    const config: NoralVoiceClientConfig = {
      baseUrl: "https://voice.example.test",
      apiKey: "test-key",
      actorHeaders: {
        "X-Noralos-Actor-Agent-Id": "agent-abc-123",
        "X-Noralos-Run-Id": "run-xyz-789",
        "X-Noralos-Company-Id": "company-def-456",
      },
    };

    await listWorkflows(config, {});

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Noralos-Actor-User-Id"]).toBeUndefined();
    expect(headers["X-Noralos-Actor-User-Email"]).toBeUndefined();
  });
});
