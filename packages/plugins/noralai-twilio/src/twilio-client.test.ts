import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TwilioProviderError,
  isRetryable,
  sendSms,
  type TwilioClientConfig,
} from "./twilio-client.js";

const cfg: TwilioClientConfig = {
  accountSid: "AC_fake_test_sid_xx_not_a_real_account",
  authToken: "very_secret_token_value_do_not_log",
  timeoutMs: 1_000,
  maxRetries: 1,
};

const sampleReq = {
  to: "+15551234567",
  from: "+15557654321",
  body: "Hello from a vitest fixture.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  // Speed up retry-backoff so the test suite stays fast. The client
  // calls setTimeout for its jitter sleep; resolve it immediately.
  vi.spyOn(global, "setTimeout").mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fn: any) => {
      Promise.resolve().then(() => fn());
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendSms — success path", () => {
  it("returns sid + status from a 201 response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ sid: "SM1234567890", status: "queued" }, 201),
    );
    const result = await sendSms(cfg, sampleReq);
    expect(result.sid).toBe("SM1234567890");
    expect(result.status).toBe("queued");
    expect(result.attempts).toBe(1);
  });

  it("sends form-urlencoded with Basic auth header and POST to the Messages endpoint", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ sid: "SM1234567890", status: "queued" }, 201),
    );
    await sendSms(cfg, sampleReq);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/2010-04-01\/Accounts\/AC.+\/Messages\.json$/);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Authorization"]).toMatch(/^Basic [A-Za-z0-9+/=]+$/);

    const body = (init.body as string) ?? "";
    const params = new URLSearchParams(body);
    expect(params.get("To")).toBe(sampleReq.to);
    expect(params.get("From")).toBe(sampleReq.from);
    expect(params.get("Body")).toBe(sampleReq.body);
  });
});

describe("sendSms — error categorization", () => {
  it("401 → auth", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ code: 20003, message: "Authentication Error" }, 401),
    );
    await expect(sendSms(cfg, sampleReq)).rejects.toMatchObject({
      name: "TwilioProviderError",
      category: "auth",
      status: 401,
      twilioCode: 20003,
    });
  });

  it("400 with twilio code 21211 → invalid_phone_number", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ code: 21211, message: "Invalid 'To' Phone Number" }, 400),
    );
    await expect(sendSms(cfg, sampleReq)).rejects.toMatchObject({
      category: "invalid_phone_number",
      status: 400,
      twilioCode: 21211,
    });
  });

  it("400 with unknown twilio code → malformed", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ code: 19999, message: "Whatever" }, 400),
    );
    await expect(sendSms(cfg, sampleReq)).rejects.toMatchObject({
      category: "malformed",
      status: 400,
    });
  });

  it("404 → misconfigured", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404));
    await expect(sendSms(cfg, sampleReq)).rejects.toMatchObject({
      category: "misconfigured",
      status: 404,
    });
  });

  it("429 → rate_limit (and triggers retry)", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ code: 20429, message: "Too Many Requests" }, 429))
      .mockResolvedValueOnce(jsonResponse({ sid: "SM_retry", status: "queued" }, 201));
    const result = await sendSms(cfg, sampleReq);
    expect(result.attempts).toBe(2);
    expect(result.sid).toBe("SM_retry");
  });

  it("500 → server (and triggers retry)", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ message: "Internal Server Error" }, 500))
      .mockResolvedValueOnce(jsonResponse({ sid: "SM_retry", status: "queued" }, 201));
    const result = await sendSms(cfg, sampleReq);
    expect(result.attempts).toBe(2);
  });

  it("network error → network category (no retry when maxRetries=0)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(
      sendSms({ ...cfg, maxRetries: 0 }, sampleReq),
    ).rejects.toMatchObject({ category: "network" });
  });

  it("AbortError → timeout category", async () => {
    const ab = new Error("aborted");
    ab.name = "AbortError";
    fetchSpy.mockRejectedValueOnce(ab).mockRejectedValueOnce(ab);
    await expect(sendSms(cfg, sampleReq)).rejects.toMatchObject({
      category: "timeout",
    });
  });
});

describe("sendSms — input validation", () => {
  it("throws misconfigured if accountSid is empty", async () => {
    await expect(
      sendSms({ ...cfg, accountSid: "" }, sampleReq),
    ).rejects.toMatchObject({ category: "misconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws misconfigured if authToken is empty", async () => {
    await expect(
      sendSms({ ...cfg, authToken: "" }, sampleReq),
    ).rejects.toMatchObject({ category: "misconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws malformed if to/from/body missing", async () => {
    await expect(sendSms(cfg, { ...sampleReq, to: "" })).rejects.toMatchObject({
      category: "malformed",
    });
    await expect(sendSms(cfg, { ...sampleReq, body: "" })).rejects.toMatchObject({
      category: "malformed",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendSms — secret hygiene", () => {
  it("never echoes the auth token in error messages", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { code: 20003, message: `bad token: ${cfg.authToken}` },
        401,
      ),
    );
    try {
      await sendSms(cfg, sampleReq);
    } catch (err) {
      if (err instanceof TwilioProviderError) {
        expect(err.message).not.toContain(cfg.authToken);
      } else {
        throw err;
      }
    }
  });

  it("never echoes the body or recipient number in error messages", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { code: 21211, message: `bad: ${sampleReq.to} ${sampleReq.body}` },
        400,
      ),
    );
    try {
      await sendSms(cfg, sampleReq);
    } catch (err) {
      if (err instanceof TwilioProviderError) {
        expect(err.message).not.toContain(sampleReq.to);
        expect(err.message).not.toContain(sampleReq.body);
      } else {
        throw err;
      }
    }
  });

  it("does not include the auth token in any fetch URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ sid: "SM_x", status: "queued" }, 201),
    );
    await sendSms(cfg, sampleReq);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(cfg.authToken);
    // The accountSid IS in the URL — that's how Twilio's Messages
    // endpoint addresses an account. Don't assert against it.
    expect(url).toContain(cfg.accountSid);
  });
});

describe("isRetryable", () => {
  it("retries transient categories only", () => {
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("rate_limit")).toBe(true);
    expect(isRetryable("server")).toBe(true);
    expect(isRetryable("auth")).toBe(false);
    expect(isRetryable("invalid_phone_number")).toBe(false);
    expect(isRetryable("malformed")).toBe(false);
    expect(isRetryable("misconfigured")).toBe(false);
    expect(isRetryable("unknown")).toBe(false);
  });
});
