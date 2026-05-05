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
