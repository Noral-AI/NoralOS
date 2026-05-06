// ElevenLabs HTTP TTS provider.
// Endpoint docs: https://elevenlabs.io/docs/api-reference/text-to-speech

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

export interface ProviderError extends Error {
  rateLimited?: boolean;
}

export type SimpleFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function synthesizeElevenLabs(
  apiKey: string,
  voiceId: string,
  text: string,
  fetchImpl: SimpleFetch = fetch,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (!voiceId) throw new Error("Missing ElevenLabs voiceId");
  const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      output_format: "mp3_44100_128",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err: ProviderError = new Error(
      `ElevenLabs HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
    if (res.status === 429) err.rateLimited = true;
    throw err;
  }

  const buf = await res.arrayBuffer();
  const audioBase64 = Buffer.from(buf).toString("base64");
  return { audioBase64, mimeType: "audio/mpeg" };
}

// ---------------------------------------------------------------------------
// Voice catalogue
// ---------------------------------------------------------------------------

const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v1/voices";

export interface ElevenLabsVoiceRow {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  // ElevenLabs returns a free-form labels map. Common keys: "gender",
  // "accent", "age", "descriptive", "use_case". Values are strings.
  labels?: Record<string, string> | null;
  // Some voices declare available languages; many don't. When absent,
  // ElevenLabs voices default to multilingual.
  fine_tuning?: {
    language?: string;
    finetuning_state?: string;
  } | null;
}

export async function listElevenLabsVoices(
  apiKey: string,
  fetchImpl: SimpleFetch = fetch,
): Promise<ElevenLabsVoiceRow[]> {
  const res = await fetchImpl(ELEVENLABS_VOICES_URL, {
    method: "GET",
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text();
    const err: ProviderError = new Error(
      `ElevenLabs voices HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
    if (res.status === 429) err.rateLimited = true;
    throw err;
  }

  const json = (await res.json()) as { voices?: ElevenLabsVoiceRow[] };
  return Array.isArray(json.voices) ? json.voices : [];
}

export function normalizeElevenLabsGender(
  labels: Record<string, string> | null | undefined,
): "male" | "female" | "neutral" | null {
  const g = labels?.gender?.toLowerCase();
  if (g === "male") return "male";
  if (g === "female") return "female";
  if (g === "neutral" || g === "non-binary") return "neutral";
  return null;
}

export function elevenLabsStyle(
  labels: Record<string, string> | null | undefined,
): string | null {
  // Prefer descriptive (e.g. "warm", "calm"); fall back to use_case or accent.
  return labels?.descriptive ?? labels?.use_case ?? labels?.accent ?? null;
}
