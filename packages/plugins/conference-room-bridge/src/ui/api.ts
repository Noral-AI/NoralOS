import { PLUGIN_ID } from "../constants.js";

const BASE = `/api/plugins/${PLUGIN_ID}/api`;

async function call<T>(
  path: string,
  init: RequestInit & { companyId: string },
): Promise<T> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(init.companyId)}`;
  const { companyId: _omit, ...rest } = init;
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const err = new Error(
      `Conference Room API ${path} failed: ${res.status} ${
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : ""
      }`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export type UiState = {
  bridge: {
    status: "ok" | "error";
    voiceConfig: { reachable: boolean };
    voiceCascade: { reachable: boolean };
  };
  voiceCascade: {
    ttsMode: string | null;
    providers: Record<string, string> | null;
  };
};

export type CreateSessionResponse = {
  conferenceSessionId: string;
  status: "active";
  agentId: string;
};

export type SendMessageResponse = {
  status: "accepted";
  conferenceSessionId: string;
  runId: string;
};

export type LastResultResponse = {
  conferenceSessionId: string;
  status: "pending" | "done" | "error";
  runId?: string;
  responseText?: string;
  // Subset of responseText handed to TTS (sentence/word-boundary truncation).
  // Empty when no TTS was attempted.
  spokenText?: string;
  ttsResult?: {
    ok: boolean;
    reason?: string;
    // Present only when ok=true.
    audioBase64?: string;
    mimeType?: string;
    providerUsed?: "elevenlabs" | "google_tts";
    voiceId?: string;
    durationMs?: number | null;
  };
  reason?: string;
};

export const conferenceApi = {
  state: (companyId: string) =>
    call<UiState>("/ui/state", { method: "GET", companyId }),

  createSession: (
    companyId: string,
    body: {
      conferenceSessionId: string;
      transport?: "websocket";
      targetAgentId?: string | null;
      latencyHint?: "interactive" | "thorough";
    },
  ) =>
    call<CreateSessionResponse>("/ui/sessions", {
      method: "POST",
      body: JSON.stringify({
        transport: "websocket",
        ...body,
      }),
      companyId,
    }),

  sendMessage: (
    companyId: string,
    conferenceSessionId: string,
    transcript: string,
  ) =>
    call<SendMessageResponse>(
      `/ui/sessions/${encodeURIComponent(conferenceSessionId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ transcript }),
        companyId,
      },
    ),

  lastResult: (companyId: string, conferenceSessionId: string) =>
    call<LastResultResponse>(
      `/ui/sessions/${encodeURIComponent(conferenceSessionId)}/last-result`,
      { method: "GET", companyId },
    ),

  closeSession: (companyId: string, conferenceSessionId: string) =>
    call<{ ok: true }>(
      `/ui/sessions/${encodeURIComponent(conferenceSessionId)}`,
      { method: "DELETE", companyId },
    ),
};

// ---------------------------------------------------------------------------
// Conference Room team list — already filtered by voice-config visibility on
// the backend. The UI never sees workers, specialists, or system-managed
// service agents.
// ---------------------------------------------------------------------------

export type ConferenceRoomTeamRole = "host" | "director";

export type AgentSummary = {
  id: string;
  name: string;
  /** Long-term explicit role label from voice-config. */
  role: ConferenceRoomTeamRole;
  /** True iff this agent is the room's default target when no pin is set. */
  isDefaultTarget: boolean;
};

export async function fetchAgents(companyId: string): Promise<AgentSummary[]> {
  type Response = { ok: true; team: AgentSummary[] } | { ok: false; reason?: string; message?: string };
  const data = await call<Response>("/ui/team", { method: "GET", companyId });
  if (!data.ok) {
    throw new Error(`fetchAgents failed: ${data.reason ?? "unknown"} ${data.message ?? ""}`.trim());
  }
  return Array.isArray(data.team) ? data.team : [];
}
