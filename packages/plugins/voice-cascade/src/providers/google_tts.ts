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

// ---------------------------------------------------------------------------
// Voice catalogue
// ---------------------------------------------------------------------------

const GOOGLE_VOICES_URL = "https://texttospeech.googleapis.com/v1/voices";

export interface GoogleTtsVoiceRow {
  name: string;
  languageCodes: string[];
  ssmlGender: "MALE" | "FEMALE" | "NEUTRAL" | "SSML_VOICE_GENDER_UNSPECIFIED";
}

export async function listGoogleTtsVoices(
  apiKey: string,
  languageCode: string | null,
  fetchImpl: SimpleFetch = fetch,
): Promise<GoogleTtsVoiceRow[]> {
  // languageCode is optional; passing it filters server-side. Caller passes
  // null to mean "all languages".
  const qs = languageCode
    ? `?languageCode=${encodeURIComponent(languageCode)}&key=${encodeURIComponent(apiKey)}`
    : `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(`${GOOGLE_VOICES_URL}${qs}`, { method: "GET" });

  if (!res.ok) {
    const body = await res.text();
    const err: ProviderError = new Error(
      `google_tts voices HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
    if (res.status === 429) err.rateLimited = true;
    throw err;
  }

  const json = (await res.json()) as { voices?: GoogleTtsVoiceRow[] };
  return Array.isArray(json.voices) ? json.voices : [];
}

// Derive a coarse "tier" (Neural2 / Wavenet / Studio / Standard / Chirp3-HD)
// from the voice name. Used as Voice.style. Pure string parsing — no API call.
export function googleVoiceStyle(name: string): string | null {
  const m = name.match(/-(Chirp3-HD|Neural2|Wavenet|Studio|Standard|Polyglot|News|Casual|Journey)-/);
  return m ? m[1] : null;
}

// Normalize a /voices row into Voice-Picker fields (voiceId for synthesis,
// displayName for the UI, style for the row caption).
//
// Background: most Google voices are returned with a fully namespaced name
// like "en-US-Neural2-F" that /text:synthesize accepts as-is. The newer
// Chirp3-HD generation is returned with a bare "star name" like "Achernar"
// or "Aoede" — synthesizing with that bare name fails with HTTP 400
// "This voice requires a model name to be specified." For Chirp3-HD the
// synthesize-ready id is `${language}-Chirp3-HD-${bare}`.
//
// Detection: a name that already starts with `xx-XX-` is a fully namespaced
// voice; anything else is treated as a Chirp3-HD bare name. The language
// prefix is taken from the row's languageCodes (which Google fills in for
// every voice it returns), defaulting to "en-US" if absent.
export function normalizeGoogleVoiceForList(row: GoogleTtsVoiceRow): {
  voiceId: string;
  displayName: string;
  style: string | null;
} {
  const looksNamespaced = /^[a-z]{2}-[A-Z]{2}-/.test(row.name);
  if (!looksNamespaced) {
    const lang = row.languageCodes?.[0] ?? "en-US";
    return {
      voiceId: `${lang}-Chirp3-HD-${row.name}`,
      displayName: row.name,
      style: "Chirp3-HD",
    };
  }
  return {
    voiceId: row.name,
    displayName: row.name,
    style: googleVoiceStyle(row.name),
  };
}

export function normalizeGoogleGender(
  ssml: GoogleTtsVoiceRow["ssmlGender"],
): "male" | "female" | "neutral" | null {
  switch (ssml) {
    case "MALE":
      return "male";
    case "FEMALE":
      return "female";
    case "NEUTRAL":
      return "neutral";
    default:
      return null;
  }
}
