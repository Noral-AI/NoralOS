import type { ProviderTestInput } from "../provider-registry.js";
import {
  failFromException,
  failFromStatus,
  okResult,
  timedFetch,
  type TestResult,
} from "./types.js";

/**
 * Google Cloud Text-to-Speech credential test.
 *
 * Calls the public `voices` list endpoint with the provided API key. A 200
 * response with a non-empty voices array is treated as ok. Anything else is
 * mapped to a sanitised error code via `failFromStatus`. The response body
 * is intentionally never read on the failure path so provider error text
 * cannot leak into our logs or API response.
 */
export async function testGoogleTts(
  input: ProviderTestInput,
): Promise<TestResult> {
  const url = `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(
    input.secretValue,
  )}`;
  let res: Response;
  try {
    res = await timedFetch(url, { method: "GET" });
  } catch (err) {
    return failFromException(err);
  }
  if (res.status !== 200) {
    return failFromStatus(res.status);
  }
  // Body inspection here is the ONE place we read provider data — only the
  // length of `voices[]` is read, no other field is surfaced anywhere.
  try {
    const json = (await res.json()) as { voices?: unknown[] };
    if (!Array.isArray(json.voices) || json.voices.length === 0) {
      return failFromStatus(200);
    }
  } catch {
    return failFromStatus(200);
  }
  return okResult(res.status);
}
