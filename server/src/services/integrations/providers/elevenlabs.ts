import type { ProviderTestInput } from "../provider-registry.js";
import {
  failFromException,
  failFromStatus,
  okResult,
  timedFetch,
  type TestResult,
} from "./types.js";

/**
 * ElevenLabs credential test.
 *
 * Calls the `voices` endpoint with the provided API key in the
 * `xi-api-key` header. A 200 response with a non-empty voices array is
 * treated as ok. Anything else is mapped to a sanitised error code; the
 * response body is never logged or returned.
 */
export async function testElevenLabs(
  input: ProviderTestInput,
): Promise<TestResult> {
  let res: Response;
  try {
    res = await timedFetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: {
        "xi-api-key": input.secretValue,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return failFromException(err);
  }
  if (res.status !== 200) {
    return failFromStatus(res.status);
  }
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
