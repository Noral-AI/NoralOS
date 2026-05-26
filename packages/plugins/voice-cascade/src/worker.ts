import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginApiResponse,
  type PluginContext,
} from "@noralos/plugin-sdk";
import {
  API_ROUTE_KEYS,
  DEFAULT_GOOGLE_TTS_LANGUAGE_CODE,
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_TEXT_CHARS,
  EVENT_KEYS,
  PLUGIN_ID,
  PREVIEW_MAX_CHARS,
  PREVIEW_TEXT,
  PROVIDERS,
  SURFACES,
  TTS_MODES,
  VOICE_CONFIG_API_BASE,
  VOICE_CONFIG_EVENTS,
  type NoAudioReason,
  type Provider,
  type Surface,
  type TtsMode,
} from "./constants.js";
import type {
  AudioResult,
  EffectiveOrFailClosed,
  EffectiveVoiceConfig,
  HealthResult,
  ListVoicesResult,
  NoAudioResult,
  PreviewResult,
  ProviderHealth,
  SynthesisResult,
  Voice,
} from "./types.js";
import { scanForSecrets } from "./exfiltrationGuard.js";
import {
  elevenLabsStyle,
  listElevenLabsVoices,
  normalizeElevenLabsGender,
  synthesizeElevenLabs,
} from "./providers/elevenlabs.js";
import {
  listGoogleTtsVoices,
  normalizeGoogleGender,
  normalizeGoogleVoiceForList,
  synthesizeGoogleTts,
} from "./providers/google_tts.js";

// ---------------------------------------------------------------------------
// Module-scope context (kitchen-sink pattern — set in setup, read elsewhere).
// ---------------------------------------------------------------------------

let currentContext: PluginContext | null = null;

interface PluginConfig {
  voiceConfigAgentTokenRef?: string;
  elevenLabsApiKeyRef?: string;
  googleTtsApiKeyRef?: string;
  googleTtsDefaultLanguageCode?: string;
  ttsMode?: TtsMode;
  maxTextChars?: number;
  maxAudioBytes?: number;
  fallbackEnabled?: boolean;
  fallbackProvider?: Provider;
  voiceConfigBaseUrl?: string;
}

// Local cache of effective voice configs.
// Populated by `plugin.noralos.voice-config.changed` events; HTTP-fetched on miss.
const effectiveCache = new Map<string, EffectiveOrFailClosed>();
function cacheKey(companyId: string, agentId: string) {
  return `${companyId}:${agentId}`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing or invalid field: ${field}`);
  }
  return value;
}

function asSurface(value: unknown): Surface {
  if (typeof value !== "string" || !SURFACES.includes(value as Surface)) {
    throw new ValidationError(`Invalid surface: ${String(value)}`);
  }
  return value as Surface;
}

function asObjectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Expected JSON object body");
  }
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function noAudio(
  agentId: string,
  surface: Surface,
  reason: NoAudioReason,
  message: string,
  providerAttempted?: Provider,
): NoAudioResult {
  const out: NoAudioResult = { ok: false, agentId, surface, reason, message };
  if (providerAttempted) out.providerAttempted = providerAttempted;
  return out;
}

// ---------------------------------------------------------------------------
// Config resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective TTS mode.
 *
 * SAFETY RULE: live TTS requires an EXPLICIT `ttsMode: "live"` opt-in.
 * Provider keys alone never activate live mode — an operator must
 * deliberately set `ttsMode: "live"` after acknowledging that synthesize
 * calls will spend on the configured providers.
 *
 * This means a fresh install with provider keys present still runs in
 * dry_run mode until someone explicitly flips the toggle. The cost of
 * an extra config touch is much lower than the cost of accidental
 * billable provider calls.
 */
function resolveTtsMode(config: PluginConfig): TtsMode {
  return config.ttsMode === "live" ? "live" : "dry_run";
}

function resolveMaxTextChars(config: PluginConfig): number {
  const v = config.maxTextChars;
  return typeof v === "number" && v > 0 ? v : DEFAULT_MAX_TEXT_CHARS;
}

function resolveMaxAudioBytes(config: PluginConfig): number {
  const v = config.maxAudioBytes;
  return typeof v === "number" && v > 0 ? v : DEFAULT_MAX_AUDIO_BYTES;
}

// ---------------------------------------------------------------------------
// voice-config integration
// ---------------------------------------------------------------------------

async function resolveEffective(
  ctx: PluginContext,
  config: PluginConfig,
  companyId: string,
  agentId: string,
): Promise<EffectiveOrFailClosed | null> {
  const key = cacheKey(companyId, agentId);
  const cached = effectiveCache.get(key);
  if (cached) return cached;

  const baseUrl = config.voiceConfigBaseUrl ?? "http://localhost:3100";
  const tokenRef = config.voiceConfigAgentTokenRef;

  if (!tokenRef) {
    ctx.logger.error("voiceConfigAgentTokenRef not configured", { companyId, agentId });
    return null;
  }

  let token: string;
  try {
    token = await ctx.secrets.resolve(tokenRef);
  } catch (err) {
    ctx.logger.error("failed to resolve voiceConfigAgentTokenRef", {
      companyId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const url = `${baseUrl}${VOICE_CONFIG_API_BASE}/agents/${encodeURIComponent(agentId)}/effective-config?companyId=${encodeURIComponent(companyId)}`;
  let res: Response;
  try {
    // Use global fetch (not ctx.http.fetch) for in-process voice-config calls.
    // ctx.http.fetch enforces a public-IP allowlist for outbound HTTP, which
    // (correctly) blocks localhost. The SDK explicitly permits plain fetch
    // for cases like this — voice-config and voice-cascade live in the same
    // host process tree, so this is an in-process RPC, not external traffic.
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    ctx.logger.error("voice-config HTTP call failed", {
      companyId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!res.ok) {
    ctx.logger.error("voice-config returned non-OK", {
      companyId,
      agentId,
      status: res.status,
    });
    return null;
  }

  const body = (await res.json()) as EffectiveOrFailClosed;
  effectiveCache.set(key, body);
  return body;
}

function surfaceEnabled(cfg: EffectiveVoiceConfig, surface: Surface): boolean {
  switch (surface) {
    case "dashboard":
      return cfg.dashboardVoiceEnabled;
    case "conference_room":
      return cfg.conferenceRoomEnabled;
    case "slack":
      return cfg.slackVoiceEnabled;
    case "phone":
      return cfg.phoneVoiceEnabled;
  }
}

// ---------------------------------------------------------------------------
// Synthesize handler
// ---------------------------------------------------------------------------

async function handleSynthesize(
  ctx: PluginContext,
  companyId: string,
  body: Record<string, unknown>,
): Promise<SynthesisResult> {
  const agentId = asString(body.agentId, "agentId");
  const text = asString(body.text, "text");
  const surface = asSurface(body.surface);

  const config = (await ctx.config.get()) as PluginConfig;
  const ttsMode = resolveTtsMode(config);
  const maxTextChars = resolveMaxTextChars(config);
  const maxAudioBytes = resolveMaxAudioBytes(config);

  // 1. Cheap input-size guardrail. Runs before voice-config / scan / provider
  //    so an absurd payload never burns network or scan time.
  if (text.length > maxTextChars) {
    await emitSuppressed(ctx, companyId, agentId, surface, "text-too-long");
    return noAudio(
      agentId,
      surface,
      "text-too-long",
      `text length ${text.length} exceeds maxTextChars=${maxTextChars}`,
    );
  }

  // 2. Resolve voice-config and apply gates.
  const eff = await resolveEffective(ctx, config, companyId, agentId);
  if (!eff) {
    await emitSuppressed(ctx, companyId, agentId, surface, "config-missing");
    return noAudio(agentId, surface, "config-missing", "voice-config could not be reached");
  }
  if (!eff.resolved) {
    await emitSuppressed(ctx, companyId, agentId, surface, "voice-config-fail-closed");
    return noAudio(agentId, surface, "voice-config-fail-closed", "voice-config returned fail-closed");
  }
  if (!eff.voiceEnabled) {
    await emitSuppressed(ctx, companyId, agentId, surface, "voice-config-disabled");
    return noAudio(agentId, surface, "voice-config-disabled", "voice not enabled for agent");
  }
  if (eff.effectiveVisibility === "hidden") {
    await emitSuppressed(ctx, companyId, agentId, surface, "voice-config-hidden");
    return noAudio(agentId, surface, "voice-config-hidden", "agent hidden from voice surfaces");
  }
  if (!eff.ttsRepliesEnabled) {
    await emitSuppressed(ctx, companyId, agentId, surface, "voice-config-disabled");
    return noAudio(agentId, surface, "voice-config-disabled", "TTS replies disabled for agent");
  }
  if (!surfaceEnabled(eff, surface)) {
    await emitSuppressed(ctx, companyId, agentId, surface, "surface-disabled");
    return noAudio(agentId, surface, "surface-disabled", `surface ${surface} disabled for agent`);
  }
  if (!eff.voiceId) {
    await emitSuppressed(ctx, companyId, agentId, surface, "no-voice-id");
    return noAudio(agentId, surface, "no-voice-id", "agent has no voiceId configured");
  }

  // 3. Pre-TTS exfiltration scan (block-on-match, never sends to provider).
  //    Runs even in dry_run mode so callers can validate the gate works.
  const matches = scanForSecrets(text);
  if (matches.length > 0) {
    const matchTypes = matches.map((m) => m.type);
    await ctx.activity.log({
      companyId,
      message: `voice-cascade blocked TTS: exfiltration risk on agent ${agentId} (${matches.length} match(es): ${matchTypes.join(", ")})`,
      entityType: "agent",
      entityId: agentId,
      metadata: {
        kind: "voice.cascade.exfiltration_blocked",
        matchTypes,
        // Intentionally omit raw text and full previews from audit metadata.
      },
    });
    await emitSuppressed(ctx, companyId, agentId, surface, "exfiltration-blocked");
    return noAudio(
      agentId,
      surface,
      "exfiltration-blocked",
      `Blocked due to ${matches.length} secret-like match(es): ${matchTypes.join(", ")}`,
    );
  }

  // 4. Dry-run mode short-circuits before any provider call.
  if (ttsMode === "dry_run") {
    await emitSuppressed(ctx, companyId, agentId, surface, "dry-run");
    return noAudio(
      agentId,
      surface,
      "dry-run",
      `ttsMode=dry_run; would have synthesized via ${eff.effectiveProvider} with voiceId="${eff.voiceId}"`,
      eff.effectiveProvider,
    );
  }

  // 5. Provider call. Serial only, never parallel.
  const primary = eff.effectiveProvider as Provider;
  const tryOrder: Provider[] = [primary];
  if (
    config.fallbackEnabled &&
    config.fallbackProvider &&
    PROVIDERS.includes(config.fallbackProvider) &&
    config.fallbackProvider !== primary
  ) {
    tryOrder.push(config.fallbackProvider);
  }

  let lastErr: { provider: Provider; rateLimited: boolean; message: string } | null = null;
  for (const provider of tryOrder) {
    try {
      const out = await callProvider(ctx, config, provider, eff.voiceId, text);

      // 6. Output-size guardrail. Runs AFTER the provider returns since we
      //    only know the size at that point. Rejects oversized audio with a
      //    distinct reason so callers can size-tune their prompts.
      const audioByteSize = Math.floor((out.audioBase64.length * 3) / 4);
      if (audioByteSize > maxAudioBytes) {
        await emitSuppressed(ctx, companyId, agentId, surface, "audio-too-large");
        return noAudio(
          agentId,
          surface,
          "audio-too-large",
          `audio size ${audioByteSize} bytes exceeds maxAudioBytes=${maxAudioBytes}`,
          provider,
        );
      }

      const result: AudioResult = {
        ok: true,
        agentId,
        surface,
        providerUsed: provider,
        voiceId: eff.voiceId,
        mimeType: out.mimeType,
        audioBase64: out.audioBase64,
        durationMs: null, // not computed in v1
      };
      await emitSynthesized(ctx, companyId, agentId, surface, provider);
      return result;
    } catch (err) {
      const rateLimited = (err as Error & { rateLimited?: boolean }).rateLimited === true;
      const message = err instanceof Error ? err.message : String(err);
      lastErr = { provider, rateLimited, message };
      ctx.logger.warn("voice-cascade provider failed", {
        provider,
        agentId,
        surface,
        message,
        rateLimited,
      });
      // continue to next provider in tryOrder
    }
  }

  // 7. All providers failed.
  const failure = lastErr!;
  const reason: NoAudioReason = failure.rateLimited ? "provider-rate-limited" : "provider-failed";
  await emitFailed(ctx, companyId, agentId, surface, failure.provider, failure.message);
  return noAudio(agentId, surface, reason, failure.message, failure.provider);
}

async function callProvider(
  ctx: PluginContext,
  config: PluginConfig,
  provider: Provider,
  voiceId: string,
  text: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (provider === "elevenlabs") {
    if (!config.elevenLabsApiKeyRef) {
      throw new Error("elevenLabsApiKeyRef not configured");
    }
    const apiKey = await ctx.secrets.resolve(config.elevenLabsApiKeyRef);
    return synthesizeElevenLabs(apiKey, voiceId, text, (url, init) => ctx.http.fetch(url, init));
  }
  if (provider === "google_tts") {
    if (!config.googleTtsApiKeyRef) {
      throw new Error("googleTtsApiKeyRef not configured");
    }
    const apiKey = await ctx.secrets.resolve(config.googleTtsApiKeyRef);
    const lang = config.googleTtsDefaultLanguageCode ?? DEFAULT_GOOGLE_TTS_LANGUAGE_CODE;
    return synthesizeGoogleTts(apiKey, voiceId, lang, text, (url, init) => ctx.http.fetch(url, init));
  }
  throw new Error(`Unknown provider: ${String(provider)}`);
}

// ---------------------------------------------------------------------------
// Health handler
// ---------------------------------------------------------------------------

async function handleHealth(ctx: PluginContext): Promise<HealthResult> {
  const config = (await ctx.config.get()) as PluginConfig;

  const elevenlabs = await probeProvider(ctx, config.elevenLabsApiKeyRef);
  const google_tts = await probeProvider(ctx, config.googleTtsApiKeyRef);
  const ttsMode = resolveTtsMode(config);

  const okCount = (elevenlabs === "ok" ? 1 : 0) + (google_tts === "ok" ? 1 : 0);
  const status: HealthResult["status"] =
    okCount === 2 ? "ok" : okCount === 1 ? "degraded" : "unavailable";

  return { status, providers: { elevenlabs, google_tts }, ttsMode };
}

async function probeProvider(
  ctx: PluginContext,
  ref: string | undefined,
): Promise<ProviderHealth> {
  if (!ref) return "missing-key";
  try {
    const value = await ctx.secrets.resolve(ref);
    return value ? "ok" : "missing-key";
  } catch {
    return "missing-key";
  }
  // Note: v1 does not emit an outbound probe to provider endpoints to avoid
  // per-health-check cost. "unreachable" is reserved for a future deeper check.
}

// ---------------------------------------------------------------------------
// Event emission helpers
// ---------------------------------------------------------------------------

async function emitSynthesized(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  surface: Surface,
  provider: Provider,
) {
  await ctx.events.emit(EVENT_KEYS.synthesized, companyId, {
    companyId,
    agentId,
    surface,
    provider,
  });
}

async function emitSuppressed(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  surface: Surface,
  reason: string,
) {
  await ctx.events.emit(EVENT_KEYS.suppressed, companyId, {
    companyId,
    agentId,
    surface,
    reason,
  });
}

async function emitFailed(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  surface: Surface,
  provider: Provider,
  error: string,
) {
  await ctx.events.emit(EVENT_KEYS.failed, companyId, {
    companyId,
    agentId,
    surface,
    provider,
    error,
  });
}

// ---------------------------------------------------------------------------
// Voice Picker handlers (read-only catalogue + bounded preview)
// ---------------------------------------------------------------------------

function asProvider(value: unknown): Provider {
  if (typeof value !== "string" || !PROVIDERS.includes(value as Provider)) {
    throw new ValidationError(`Invalid provider: ${String(value)}`);
  }
  return value as Provider;
}

async function handleListVoices(
  ctx: PluginContext,
  rawProvider: unknown,
  rawLanguageCode: unknown,
): Promise<ListVoicesResult> {
  const provider = asProvider(rawProvider);
  const config = (await ctx.config.get()) as PluginConfig;
  const ttsMode = resolveTtsMode(config);

  // languageCode is google_tts-only; "all" or absent means no server-side
  // filter. ElevenLabs does not filter server-side; we ignore the param.
  const languageCode =
    typeof rawLanguageCode === "string" && rawLanguageCode && rawLanguageCode !== "all"
      ? rawLanguageCode
      : null;

  const ref =
    provider === "google_tts" ? config.googleTtsApiKeyRef : config.elevenLabsApiKeyRef;
  if (!ref) {
    return {
      ok: false,
      provider,
      reason: "provider-key-missing",
      message:
        provider === "google_tts"
          ? "Google Cloud TTS key is not configured yet."
          : "ElevenLabs key is not configured yet.",
      ttsMode,
    };
  }

  let apiKey: string;
  try {
    apiKey = await ctx.secrets.resolve(ref);
  } catch (err) {
    ctx.logger.warn("listVoices: secret resolution failed", {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      provider,
      reason: "provider-key-missing",
      message: "Provider key reference could not be resolved.",
      ttsMode,
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      provider,
      reason: "provider-key-missing",
      message:
        provider === "google_tts"
          ? "Google Cloud TTS key is not configured yet."
          : "ElevenLabs key is not configured yet.",
      ttsMode,
    };
  }

  try {
    if (provider === "google_tts") {
      const rows = await listGoogleTtsVoices(
        apiKey,
        languageCode ?? config.googleTtsDefaultLanguageCode ?? DEFAULT_GOOGLE_TTS_LANGUAGE_CODE,
        (url, init) => ctx.http.fetch(url, init),
      );
      const voices: Voice[] = rows.map((r) => {
        const normalized = normalizeGoogleVoiceForList(r);
        return {
          voiceId: normalized.voiceId,
          displayName: normalized.displayName,
          provider: "google_tts",
          languageCodes: r.languageCodes ?? [],
          gender: normalizeGoogleGender(r.ssmlGender),
          style: normalized.style,
          previewUrl: null,
        };
      });
      return { ok: true, provider, voices, ttsMode };
    }

    // elevenlabs
    const rows = await listElevenLabsVoices(apiKey, (url, init) => ctx.http.fetch(url, init));
    const voices: Voice[] = rows.map((r) => ({
      voiceId: r.voice_id,
      displayName: r.name || r.voice_id,
      provider: "elevenlabs",
      // ElevenLabs voices are mostly multilingual and the API doesn't
      // declare language-codes per voice in a stable way. We surface an
      // empty array; the modal renders "multi" when length === 0.
      languageCodes: r.fine_tuning?.language ? [r.fine_tuning.language] : [],
      gender: normalizeElevenLabsGender(r.labels),
      style: elevenLabsStyle(r.labels),
      previewUrl: r.preview_url ?? null,
    }));
    return { ok: true, provider, voices, ttsMode };
  } catch (err) {
    const rateLimited =
      typeof err === "object" && err !== null && "rateLimited" in err
        ? Boolean((err as { rateLimited?: boolean }).rateLimited)
        : false;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn("listVoices: provider call failed", { provider, error: message });
    return {
      ok: false,
      provider,
      reason: rateLimited ? "rate-limited" : "provider-unreachable",
      message,
      ttsMode,
    };
  }
}

async function handlePreviewVoice(
  ctx: PluginContext,
  body: Record<string, unknown>,
): Promise<PreviewResult> {
  const provider = asProvider(body.provider);
  const voiceId = asString(body.voiceId, "voiceId");

  // Server-owned text. Caller cannot inject; even if PREVIEW_TEXT is later
  // changed to something that incorporates user input, PREVIEW_MAX_CHARS
  // caps the size before the provider call.
  const text = PREVIEW_TEXT.slice(0, PREVIEW_MAX_CHARS);

  // Run the same exfiltration guard as /synthesize so a future
  // PREVIEW_TEXT containing secret-shaped content can't leak.
  const matches = scanForSecrets(text);
  if (matches.length > 0) {
    return {
      ok: false,
      provider,
      voiceId,
      reason: "exfiltration-blocked",
      message: `Preview text blocked by exfiltration guard (${matches
        .map((m) => m.type)
        .join(", ")})`,
    };
  }

  const config = (await ctx.config.get()) as PluginConfig;

  // Preview deliberately bypasses the dry_run gate that protects /synthesize.
  // Rationale: previews are constrained to a fixed server-owned phrase
  // (PREVIEW_TEXT, capped by PREVIEW_MAX_CHARS, run through the exfiltration
  // guard above). The browser cannot inject text. Letting admins audition
  // voices without flipping ttsMode globally is the explicit goal — this
  // route is the only safe way to produce audio while Conference Room and
  // every other surface served by /synthesize remain dry_run.

  const ref =
    provider === "google_tts" ? config.googleTtsApiKeyRef : config.elevenLabsApiKeyRef;
  if (!ref) {
    return {
      ok: false,
      provider,
      voiceId,
      reason: "provider-key-missing",
      message:
        provider === "google_tts"
          ? "Google Cloud TTS key is not configured yet."
          : "ElevenLabs key is not configured yet.",
    };
  }

  try {
    const audio = await callProvider(ctx, config, provider, voiceId, text);
    return {
      ok: true,
      provider,
      providerUsed: provider,
      voiceId,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
    };
  } catch (err) {
    const rateLimited =
      typeof err === "object" && err !== null && "rateLimited" in err
        ? Boolean((err as { rateLimited?: boolean }).rateLimited)
        : false;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn("previewVoice: provider call failed", { provider, voiceId, error: message });
    return {
      ok: false,
      provider,
      voiceId,
      reason: rateLimited ? "provider-rate-limited" : "provider-failed",
      message,
    };
  }
}

// ---------------------------------------------------------------------------
// API request dispatch
// ---------------------------------------------------------------------------

async function dispatchApi(
  ctx: PluginContext,
  input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  const companyId = input.companyId;

  switch (input.routeKey) {
    case API_ROUTE_KEYS.synthesize: {
      if (!companyId) return { status: 400, body: { error: "missing companyId" } };
      try {
        const body = asObjectBody(input.body);
        const result = await handleSynthesize(ctx, companyId, body);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: { error: err.message } };
        }
        ctx.logger.error("synthesize failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: { error: "Internal error" } };
      }
    }

    case API_ROUTE_KEYS.health: {
      const result = await handleHealth(ctx);
      return { status: 200, body: result };
    }

    case API_ROUTE_KEYS.listVoices: {
      if (!companyId) return { status: 400, body: { error: "missing companyId" } };
      try {
        const result = await handleListVoices(
          ctx,
          input.query?.provider,
          input.query?.languageCode,
        );
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: { error: err.message } };
        }
        ctx.logger.error("listVoices failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: { error: "Internal error" } };
      }
    }

    case API_ROUTE_KEYS.previewVoice: {
      if (!companyId) return { status: 400, body: { error: "missing companyId" } };
      try {
        const body = asObjectBody(input.body);
        const result = await handlePreviewVoice(ctx, body);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: { error: err.message } };
        }
        ctx.logger.error("previewVoice failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: { error: "Internal error" } };
      }
    }

    default:
      return { status: 404, body: { error: `Unknown route: ${input.routeKey}` } };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    currentContext = ctx;
    ctx.logger.info(`${PLUGIN_ID} starting`);

    // Cache maintenance from voice-config events.
    // payload shape from voice-config worker:
    //   { companyId, agentId, effective: EffectiveOrFailClosed }
    ctx.events.on(VOICE_CONFIG_EVENTS.changed, async (event) => {
      const payload = event.payload as
        | { companyId?: string; agentId?: string; effective?: EffectiveOrFailClosed }
        | null;
      if (payload?.companyId && payload.agentId && payload.effective) {
        effectiveCache.set(cacheKey(payload.companyId, payload.agentId), payload.effective);
      }
    });

    // On company-defaults changes, derived (no-row) configs may shift; flush.
    ctx.events.on(VOICE_CONFIG_EVENTS.defaultsChanged, async () => {
      effectiveCache.clear();
    });
  },

  async onApiRequest(input: PluginApiRequestInput): Promise<PluginApiResponse> {
    const ctx = currentContext;
    if (!ctx) return { status: 503, body: { error: "Plugin not initialized" } };
    try {
      return await dispatchApi(ctx, input);
    } catch (err) {
      ctx.logger.error("voice-cascade: api handler failed", {
        routeKey: input.routeKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: 500, body: { error: "Internal error" } };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
