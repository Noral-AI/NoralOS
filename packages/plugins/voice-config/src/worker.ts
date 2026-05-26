import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginApiResponse,
  type PluginContext,
} from "@noralos/plugin-sdk";
import {
  API_ROUTE_KEYS,
  DATA_KEYS,
  EVENT_KEYS,
  PLUGIN_DB_SCHEMA,
  PLUGIN_ID,
  PROVIDERS,
  TIERS,
  VISIBILITIES,
  type Provider,
  type Tier,
  type Visibility,
} from "./constants.js";
import type {
  AgentVoiceConfig,
  CompanyVoiceDefaults,
  EffectiveOrFailClosed,
  EffectiveVoiceConfig,
  FailClosedVoiceConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Module-scope context — kitchen-sink pattern. Set in setup(), read by
// onApiRequest and other lifecycle hooks. Plugin's setup() is guaranteed to
// run before any onApiRequest dispatch.
// ---------------------------------------------------------------------------

let currentContext: PluginContext | null = null;

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing or invalid field: ${field}`);
  }
  return value;
}

function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ValidationError(`Missing or invalid field: ${field}`);
  return value;
}

function asProvider(value: unknown): Provider {
  if (typeof value !== "string" || !PROVIDERS.includes(value as Provider)) {
    throw new ValidationError(`Invalid provider: ${String(value)}`);
  }
  return value as Provider;
}

function asTierOrNull(value: unknown): Tier | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !TIERS.includes(value as Tier)) {
    throw new ValidationError(`Invalid tier override: ${String(value)}`);
  }
  return value as Tier;
}

function asVisibilityOrNull(value: unknown): Visibility | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !VISIBILITIES.includes(value as Visibility)) {
    throw new ValidationError(`Invalid visibility override: ${String(value)}`);
  }
  return value as Visibility;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function asObjectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Expected JSON object body");
  }
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Row I/O
// ---------------------------------------------------------------------------

type AgentRow = {
  company_id: string;
  agent_id: string;
  voice_enabled: boolean;
  provider: Provider;
  voice_id: string;
  dashboard_voice_enabled: boolean;
  conference_room_enabled: boolean;
  slack_voice_enabled: boolean;
  phone_voice_enabled: boolean;
  tts_replies_enabled: boolean;
  tier_override: Tier | null;
  visibility_override: Visibility | null;
  updated_by_principal_id: string | null;
  updated_by_kind: "board" | "agent" | "plugin" | null;
  created_at: string;
  updated_at: string;
};

type CompanyDefaultsRow = {
  company_id: string;
  default_provider: "elevenlabs" | "google_tts";
  default_dashboard_voice_enabled: boolean;
  default_conference_room_enabled: boolean;
  default_slack_voice_enabled: boolean;
  default_phone_voice_enabled: boolean;
  default_tts_replies_enabled: boolean;
  created_at: string;
  updated_at: string;
};

function rowToAgentConfig(row: AgentRow): AgentVoiceConfig {
  return {
    companyId: row.company_id,
    agentId: row.agent_id,
    voiceEnabled: row.voice_enabled,
    provider: row.provider,
    voiceId: row.voice_id,
    dashboardVoiceEnabled: row.dashboard_voice_enabled,
    conferenceRoomEnabled: row.conference_room_enabled,
    slackVoiceEnabled: row.slack_voice_enabled,
    phoneVoiceEnabled: row.phone_voice_enabled,
    ttsRepliesEnabled: row.tts_replies_enabled,
    tierOverride: row.tier_override,
    visibilityOverride: row.visibility_override,
    updatedByPrincipalId: row.updated_by_principal_id,
    updatedByKind: row.updated_by_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCompanyDefaults(row: CompanyDefaultsRow): CompanyVoiceDefaults {
  return {
    companyId: row.company_id,
    defaultProvider: row.default_provider,
    defaultDashboardVoiceEnabled: row.default_dashboard_voice_enabled,
    defaultConferenceRoomEnabled: row.default_conference_room_enabled,
    defaultSlackVoiceEnabled: row.default_slack_voice_enabled,
    defaultPhoneVoiceEnabled: row.default_phone_voice_enabled,
    defaultTtsRepliesEnabled: row.default_tts_replies_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Tier derivation (against public.agents)
// ---------------------------------------------------------------------------

async function deriveTier(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
): Promise<Tier> {
  const agentRows = await ctx.db.query<{ role: string }>(
    `SELECT role FROM public.agents WHERE id = $1 AND company_id = $2`,
    [agentId, companyId],
  );
  if (agentRows.length === 0) throw new Error("Agent not found");
  if (agentRows[0].role === "ceo") return "exec";

  const reportRows = await ctx.db.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
       FROM public.agents
       WHERE reports_to = $1 AND company_id = $2`,
    [agentId, companyId],
  );
  return Number(reportRows[0]?.count ?? 0) > 0 ? "manager" : "worker";
}

// ---------------------------------------------------------------------------
// DB queries — own namespace
// ---------------------------------------------------------------------------

async function loadAgentRow(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
): Promise<AgentVoiceConfig | null> {
  const rows = await ctx.db.query<AgentRow>(
    `SELECT * FROM ${PLUGIN_DB_SCHEMA}.agent_voice_config
       WHERE company_id = $1 AND agent_id = $2`,
    [companyId, agentId],
  );
  return rows[0] ? rowToAgentConfig(rows[0]) : null;
}

async function loadCompanyDefaults(
  ctx: PluginContext,
  companyId: string,
): Promise<CompanyVoiceDefaults | null> {
  const rows = await ctx.db.query<CompanyDefaultsRow>(
    `SELECT * FROM ${PLUGIN_DB_SCHEMA}.company_voice_defaults WHERE company_id = $1`,
    [companyId],
  );
  return rows[0] ? rowToCompanyDefaults(rows[0]) : null;
}

const FALLBACK_DEFAULTS: Omit<CompanyVoiceDefaults, "companyId" | "createdAt" | "updatedAt"> = {
  defaultProvider: "elevenlabs",
  defaultDashboardVoiceEnabled: true,
  defaultConferenceRoomEnabled: true,
  defaultSlackVoiceEnabled: false,
  defaultPhoneVoiceEnabled: false, // phone calling requires explicit admin enablement
  defaultTtsRepliesEnabled: true,
};

// ---------------------------------------------------------------------------
// Effective config resolution
// ---------------------------------------------------------------------------

async function resolveEffective(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
): Promise<EffectiveOrFailClosed> {
  try {
    const derivedTier = await deriveTier(ctx, companyId, agentId);
    const row = await loadAgentRow(ctx, companyId, agentId);
    const defaults = (await loadCompanyDefaults(ctx, companyId)) ?? {
      companyId,
      ...FALLBACK_DEFAULTS,
      createdAt: "",
      updatedAt: "",
    };

    const effectiveTier: Tier = row?.tierOverride ?? derivedTier;
    const effectiveVisibility: Visibility =
      row?.visibilityOverride ?? (effectiveTier === "worker" ? "hidden" : "shown");

    if (row) {
      const effectiveProvider =
        row.provider === "default" ? defaults.defaultProvider : row.provider;
      return buildEffective({
        companyId,
        agentId,
        derivedTier,
        effectiveTier,
        effectiveVisibility,
        voiceEnabled: row.voiceEnabled,
        effectiveProvider,
        voiceId: row.voiceId,
        dashboardVoiceEnabled: row.dashboardVoiceEnabled,
        conferenceRoomEnabled: row.conferenceRoomEnabled,
        slackVoiceEnabled: row.slackVoiceEnabled,
        phoneVoiceEnabled: row.phoneVoiceEnabled,
        ttsRepliesEnabled: row.ttsRepliesEnabled,
      });
    }

    // No row: tier-based defaults. Workers default-disabled and hidden;
    // admins can opt-in by writing a row with non-null overrides.
    const enabledByTier = effectiveTier === "exec";
    const eligible = effectiveTier !== "worker";
    return buildEffective({
      companyId,
      agentId,
      derivedTier,
      effectiveTier,
      effectiveVisibility,
      voiceEnabled: enabledByTier,
      effectiveProvider: defaults.defaultProvider,
      voiceId: "",
      dashboardVoiceEnabled: enabledByTier && eligible ? defaults.defaultDashboardVoiceEnabled : false,
      conferenceRoomEnabled: enabledByTier && eligible ? defaults.defaultConferenceRoomEnabled : false,
      slackVoiceEnabled: enabledByTier && eligible ? defaults.defaultSlackVoiceEnabled : false,
      phoneVoiceEnabled: enabledByTier && eligible ? defaults.defaultPhoneVoiceEnabled : false,
      ttsRepliesEnabled: enabledByTier && eligible ? defaults.defaultTtsRepliesEnabled : false,
    });
  } catch (err) {
    ctx.logger.error("voice-config: resolve failed, returning fail-closed", {
      companyId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return failClosed(companyId, agentId, err instanceof Error ? err.message : "unknown");
  }
}

function buildEffective(input: Omit<EffectiveVoiceConfig, "resolved">): EffectiveVoiceConfig {
  return { resolved: true, ...input };
}

function failClosed(companyId: string, agentId: string, reason: string): FailClosedVoiceConfig {
  return {
    companyId,
    agentId,
    resolved: false,
    reason,
    voiceEnabled: false,
    effectiveVisibility: "hidden",
    dashboardVoiceEnabled: false,
    conferenceRoomEnabled: false,
    slackVoiceEnabled: false,
    phoneVoiceEnabled: false,
    ttsRepliesEnabled: false,
  };
}

// ---------------------------------------------------------------------------
// Write helpers — called from API route handlers only
// ---------------------------------------------------------------------------

interface WriteActor {
  principalId: string;
  kind: "board" | "agent" | "plugin";
}

function actorFrom(input: PluginApiRequestInput): WriteActor {
  return {
    principalId: input.actor.actorId,
    kind: input.actor.actorType === "user" ? "board" : "agent",
  };
}

async function upsertAgentConfig(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  body: Record<string, unknown>,
  actor: WriteActor,
): Promise<EffectiveOrFailClosed> {
  const voiceEnabled = asBool(body.voiceEnabled, "voiceEnabled");
  const provider = asProvider(body.provider);
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
  const dashboardVoiceEnabled = asBool(body.dashboardVoiceEnabled, "dashboardVoiceEnabled");
  const conferenceRoomEnabled = asBool(body.conferenceRoomEnabled, "conferenceRoomEnabled");
  const slackVoiceEnabled = asBool(body.slackVoiceEnabled, "slackVoiceEnabled");
  const phoneVoiceEnabled = asBool(body.phoneVoiceEnabled, "phoneVoiceEnabled");
  const ttsRepliesEnabled = asBool(body.ttsRepliesEnabled, "ttsRepliesEnabled");
  const tierOverride = asTierOrNull(body.tierOverride);
  const visibilityOverride = asVisibilityOrNull(body.visibilityOverride);

  await ctx.db.execute(
    `INSERT INTO ${PLUGIN_DB_SCHEMA}.agent_voice_config (
       company_id, agent_id,
       voice_enabled, provider, voice_id,
       dashboard_voice_enabled, conference_room_enabled,
       slack_voice_enabled, phone_voice_enabled, tts_replies_enabled,
       tier_override, visibility_override,
       updated_by_principal_id, updated_by_kind,
       created_at, updated_at
     ) VALUES (
       $1, $2,
       $3, $4, $5,
       $6, $7,
       $8, $9, $10,
       $11, $12,
       $13, $14,
       now(), now()
     )
     ON CONFLICT (company_id, agent_id) DO UPDATE SET
       voice_enabled           = EXCLUDED.voice_enabled,
       provider                = EXCLUDED.provider,
       voice_id                = EXCLUDED.voice_id,
       dashboard_voice_enabled = EXCLUDED.dashboard_voice_enabled,
       conference_room_enabled = EXCLUDED.conference_room_enabled,
       slack_voice_enabled     = EXCLUDED.slack_voice_enabled,
       phone_voice_enabled     = EXCLUDED.phone_voice_enabled,
       tts_replies_enabled     = EXCLUDED.tts_replies_enabled,
       tier_override           = EXCLUDED.tier_override,
       visibility_override     = EXCLUDED.visibility_override,
       updated_by_principal_id = EXCLUDED.updated_by_principal_id,
       updated_by_kind         = EXCLUDED.updated_by_kind,
       updated_at              = now()`,
    [
      companyId,
      agentId,
      voiceEnabled,
      provider,
      voiceId,
      dashboardVoiceEnabled,
      conferenceRoomEnabled,
      slackVoiceEnabled,
      phoneVoiceEnabled,
      ttsRepliesEnabled,
      tierOverride,
      visibilityOverride,
      actor.principalId,
      actor.kind,
    ],
  );

  const effective = await resolveEffective(ctx, companyId, agentId);
  await ctx.events.emit(EVENT_KEYS.agentConfigChanged, companyId, { companyId, agentId, effective });
  await ctx.activity.log({
    companyId,
    message: `Voice settings updated for agent ${agentId} by ${actor.kind}:${actor.principalId}`,
    entityType: "agent",
    entityId: agentId,
    metadata: { kind: "voice.config.updated" },
  });
  return effective;
}

async function deleteAgentConfig(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  actor: WriteActor,
): Promise<EffectiveOrFailClosed> {
  await ctx.db.execute(
    `DELETE FROM ${PLUGIN_DB_SCHEMA}.agent_voice_config
       WHERE company_id = $1 AND agent_id = $2`,
    [companyId, agentId],
  );
  const effective = await resolveEffective(ctx, companyId, agentId);
  await ctx.events.emit(EVENT_KEYS.agentConfigChanged, companyId, { companyId, agentId, effective });
  await ctx.activity.log({
    companyId,
    message: `Voice settings reset for agent ${agentId} by ${actor.kind}:${actor.principalId}`,
    entityType: "agent",
    entityId: agentId,
    metadata: { kind: "voice.config.reset" },
  });
  return effective;
}

async function upsertCompanyDefaults(
  ctx: PluginContext,
  companyId: string,
  body: Record<string, unknown>,
  actor: WriteActor,
): Promise<CompanyVoiceDefaults | null> {
  const provider = body.defaultProvider;
  if (provider !== "elevenlabs" && provider !== "google_tts") {
    throw new ValidationError("defaultProvider must be 'elevenlabs' or 'google_tts'");
  }
  const dashboard = asBool(body.defaultDashboardVoiceEnabled, "defaultDashboardVoiceEnabled");
  const conf = asBool(body.defaultConferenceRoomEnabled, "defaultConferenceRoomEnabled");
  const slack = asBool(body.defaultSlackVoiceEnabled, "defaultSlackVoiceEnabled");
  const phone = asBool(body.defaultPhoneVoiceEnabled, "defaultPhoneVoiceEnabled");
  const tts = asBool(body.defaultTtsRepliesEnabled, "defaultTtsRepliesEnabled");

  await ctx.db.execute(
    `INSERT INTO ${PLUGIN_DB_SCHEMA}.company_voice_defaults (
       company_id, default_provider,
       default_dashboard_voice_enabled, default_conference_room_enabled,
       default_slack_voice_enabled, default_phone_voice_enabled,
       default_tts_replies_enabled,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (company_id) DO UPDATE SET
       default_provider                = EXCLUDED.default_provider,
       default_dashboard_voice_enabled = EXCLUDED.default_dashboard_voice_enabled,
       default_conference_room_enabled = EXCLUDED.default_conference_room_enabled,
       default_slack_voice_enabled     = EXCLUDED.default_slack_voice_enabled,
       default_phone_voice_enabled     = EXCLUDED.default_phone_voice_enabled,
       default_tts_replies_enabled     = EXCLUDED.default_tts_replies_enabled,
       updated_at                      = now()`,
    [companyId, provider, dashboard, conf, slack, phone, tts],
  );

  const updated = await loadCompanyDefaults(ctx, companyId);
  await ctx.events.emit(EVENT_KEYS.companyDefaultsChanged, companyId, { companyId, defaults: updated });
  await ctx.activity.log({
    companyId,
    message: `Company voice defaults updated by ${actor.kind}:${actor.principalId}`,
    metadata: { kind: "voice.config.defaults.updated" },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// API route dispatcher
// ---------------------------------------------------------------------------

async function handleApiRequest(
  ctx: PluginContext,
  input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  const companyId = input.companyId;
  const agentId = input.params.agentId;

  switch (input.routeKey) {
    case API_ROUTE_KEYS.effectiveConfig: {
      // Always returns 200; the body discriminates with `resolved: true|false`.
      if (!agentId || !companyId) {
        return {
          status: 200,
          body: failClosed(companyId ?? "", agentId ?? "", "missing companyId or agentId"),
        };
      }
      const effective = await resolveEffective(ctx, companyId, agentId);
      return { status: 200, body: effective };
    }

    case API_ROUTE_KEYS.updateAgentConfig: {
      if (!agentId) return validationFail("missing agentId in path");
      if (!companyId) return validationFail("missing companyId in query");
      try {
        const body = asObjectBody(input.body);
        const result = await upsertAgentConfig(ctx, companyId, agentId, body, actorFrom(input));
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) return validationFail(err.message);
        throw err;
      }
    }

    case API_ROUTE_KEYS.resetAgentConfig: {
      if (!agentId) return validationFail("missing agentId in path");
      if (!companyId) return validationFail("missing companyId in query");
      const result = await deleteAgentConfig(ctx, companyId, agentId, actorFrom(input));
      return { status: 200, body: result };
    }

    case API_ROUTE_KEYS.updateCompanyDefaults: {
      if (!companyId) return validationFail("missing companyId in query");
      const pathCompanyId = input.params.companyId;
      if (pathCompanyId && pathCompanyId !== companyId) {
        return validationFail("path companyId must match query companyId");
      }
      try {
        const body = asObjectBody(input.body);
        const result = await upsertCompanyDefaults(ctx, companyId, body, actorFrom(input));
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) return validationFail(err.message);
        throw err;
      }
    }

    default:
      return { status: 404, body: { error: `Unknown route: ${input.routeKey}` } };
  }
}

function validationFail(message: string): PluginApiResponse {
  return { status: 400, body: { error: message } };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    currentContext = ctx;
    ctx.logger.info(`${PLUGIN_ID} starting`, { schema: PLUGIN_DB_SCHEMA });

    // Read-only data handlers — safe; no actor identity needed.
    ctx.data.register(DATA_KEYS.voiceSettings, async (params) => {
      const companyId = asString(params.companyId, "companyId");
      const agentId = asString(params.agentId, "agentId");

      const [raw, derivedTier, effective, companyDefaults] = await Promise.all([
        loadAgentRow(ctx, companyId, agentId),
        deriveTier(ctx, companyId, agentId).catch(() => null),
        resolveEffective(ctx, companyId, agentId),
        loadCompanyDefaults(ctx, companyId),
      ]);
      return { raw, derivedTier, effective, companyDefaults };
    });

    ctx.data.register(DATA_KEYS.companyDefaults, async (params) => {
      const companyId = asString(params.companyId, "companyId");
      return await loadCompanyDefaults(ctx, companyId);
    });

    // Re-emit on agent.created / agent.updated — reports_to or role changes
    // can flip an agent's tier, which changes downstream voice eligibility.
    ctx.events.on("agent.updated", async (event) => {
      const companyId = event.companyId;
      const agentId = event.entityId;
      if (!companyId || !agentId) return;
      const effective = await resolveEffective(ctx, companyId, agentId);
      await ctx.events.emit(EVENT_KEYS.agentConfigChanged, companyId, { companyId, agentId, effective });
    });

    ctx.events.on("agent.created", async (event) => {
      const companyId = event.companyId;
      const agentId = event.entityId;
      if (!companyId || !agentId) return;
      const effective = await resolveEffective(ctx, companyId, agentId);
      await ctx.events.emit(EVENT_KEYS.agentConfigChanged, companyId, { companyId, agentId, effective });
    });

    // No write action handlers are registered. All mutations go through the
    // host-authenticated API routes in onApiRequest below.
  },

  async onApiRequest(input: PluginApiRequestInput): Promise<PluginApiResponse> {
    const ctx = currentContext;
    if (!ctx) {
      return { status: 503, body: { error: "Plugin not initialized" } };
    }
    try {
      return await handleApiRequest(ctx, input);
    } catch (err) {
      ctx.logger.error("voice-config: api handler failed", {
        routeKey: input.routeKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: 500, body: { error: "Internal error" } };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
