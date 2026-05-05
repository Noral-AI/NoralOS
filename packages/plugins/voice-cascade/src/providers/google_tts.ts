// Google Cloud Text-to-Speech provider (request/response).
//
// This is NOT Gemini Live (real-time native audio inside Pipecat) — that
// path is reserved for a future "gemini_live" provider. Voice-cascade owns
// only the request/response synthesis surface.
//
// Endpoint docs: https://cloud.google.com/text-to-speech/docs/reference/rest

const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export interface ProviderError extends Error {
  rateLimited?: boolean;
}

export type SimpleFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function synthesizeGoogleTts(
  apiKey: string,
  voiceName: string, // e.g. "en-US-Neural2-J"
  defaultLanguageCode: string, // fallback when voiceName lacks a leading "xx-XX-"
  text: string,
  fetchImpl: SimpleFetch = fetch,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (!voiceName) throw new Error("Missing Google Cloud TTS voice name");

  const langMatch = voiceName.match(/^([a-z]{2}-[A-Z]{2})-/);
  const languageCode = langMatch ? langMatch[1] : defaultLanguageCode;

  const url = `${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err: ProviderError = new Error(
      `google_tts HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
    if (res.status === 429) err.rateLimited = true;
    throw err;
  }

  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error("google_tts response missing audioContent");
  return { audioBase64: json.audioContent, mimeType: "audio/mpeg" };
}
