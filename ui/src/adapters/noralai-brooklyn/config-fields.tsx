import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AdapterConfigFieldsProps } from "../types";
import { DraftInput, Field } from "../../components/agent-config-primitives";
import { useCompany } from "../../context/CompanyContext";
import { integrationsApi } from "../../api/integrations";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

const selectClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm";

const BROOKLYN_PROVIDER_ID = "noralai_brooklyn";
const SECRET_REF_PREFIX = "company-secret:";

const baseUrlHint =
  'OpenAI-compatible chat endpoint for this agent. Examples: "https://api.runpod.ai/v2/<endpoint-id>/openai/v1" (NoralAI default) or "https://api.deepseek.com" (DeepSeek). Required.';
const upstreamModelHint =
  'Optional override for the technical model id sent in the request body. Leave blank to use the deployment default (currently "Qwen/Qwen3-32B-FP8"). For a DeepSeek-backed agent use "deepseek-v4-flash" or "deepseek-v4-pro".';
const apiKeyRefHint =
  "Pick a NoralAI credential added under Settings → Integrations. The reference is resolved to a plaintext key server-side at execute time and never exposed to the browser.";

function readSchemaString(
  values: AdapterConfigFieldsProps["values"],
  key: string,
): string {
  const v = values?.adapterSchemaValues?.[key];
  return typeof v === "string" ? v : "";
}

function writeSchemaValue(
  values: AdapterConfigFieldsProps["values"],
  set: AdapterConfigFieldsProps["set"],
  key: string,
  next: string,
) {
  if (!set || !values) return;
  const prior = values.adapterSchemaValues ?? {};
  const updated = { ...prior };
  if (next) {
    updated[key] = next;
  } else {
    delete updated[key];
  }
  set({ adapterSchemaValues: updated });
}

export function BrooklynConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  const { selectedCompanyId } = useCompany();

  const credentialsQuery = useQuery({
    queryKey: ["integrations", "credentials", selectedCompanyId],
    queryFn: () => integrationsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const brooklynCredentials = useMemo(
    () =>
      (credentialsQuery.data ?? []).filter(
        (c) => c.provider === BROOKLYN_PROVIDER_ID,
      ),
    [credentialsQuery.data],
  );

  const baseUrlValue = isCreate
    ? (values?.url ?? "")
    : eff<string>("adapterConfig", "baseUrl", String(config.baseUrl ?? ""));

  const upstreamModelValue = isCreate
    ? readSchemaString(values, "upstreamModel")
    : eff<string>(
        "adapterConfig",
        "upstreamModel",
        String(config.upstreamModel ?? ""),
      );

  const apiKeyRefValue = isCreate
    ? readSchemaString(values, "apiKeyRef")
    : eff<string>(
        "adapterConfig",
        "apiKeyRef",
        String(config.apiKeyRef ?? ""),
      );

  const currentCredentialId = apiKeyRefValue.startsWith(SECRET_REF_PREFIX)
    ? apiKeyRefValue.slice(SECRET_REF_PREFIX.length)
    : "";

  // If the agent is currently pointing at a credential that has since
  // been deleted, the picker still needs to render *something* — show
  // the bare id with a "missing" marker so the operator can notice and
  // pick a fresh one rather than the dropdown silently snapping to blank.
  const knownIds = new Set(brooklynCredentials.map((c) => c.id));
  const danglingCurrent =
    currentCredentialId && !knownIds.has(currentCredentialId)
      ? currentCredentialId
      : null;

  return (
    <>
      <Field label="Base URL" hint={baseUrlHint}>
        <DraftInput
          value={baseUrlValue}
          onCommit={(v) => {
            const next = v.trim();
            if (isCreate) {
              set?.({ url: next });
            } else {
              mark("adapterConfig", "baseUrl", next || undefined);
            }
          }}
          immediate
          className={inputClass}
          placeholder="https://api.runpod.ai/v2/<endpoint-id>/openai/v1"
        />
      </Field>

      <Field label="Upstream model (optional)" hint={upstreamModelHint}>
        <DraftInput
          value={upstreamModelValue}
          onCommit={(v) => {
            const next = v.trim();
            if (isCreate) {
              writeSchemaValue(values, set, "upstreamModel", next);
            } else {
              mark("adapterConfig", "upstreamModel", next || undefined);
            }
          }}
          immediate
          className={inputClass}
          placeholder="Qwen/Qwen3-32B-FP8"
        />
      </Field>

      <Field label="NoralAI API credential" hint={apiKeyRefHint}>
        <select
          className={selectClass}
          value={currentCredentialId}
          disabled={!selectedCompanyId || credentialsQuery.isLoading}
          onChange={(e) => {
            const id = e.target.value;
            const nextRef = id ? `${SECRET_REF_PREFIX}${id}` : "";
            if (isCreate) {
              writeSchemaValue(values, set, "apiKeyRef", nextRef);
            } else {
              mark("adapterConfig", "apiKeyRef", nextRef || undefined);
            }
          }}
        >
          <option value="">
            {brooklynCredentials.length === 0
              ? "No NoralAI credentials yet — add one in Settings → Integrations"
              : "— Select a credential —"}
          </option>
          {brooklynCredentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
              {c.maskedSuffix ? ` · ${c.maskedSuffix}` : ""}
              {c.status !== "active" ? ` (${c.status})` : ""}
            </option>
          ))}
          {danglingCurrent ? (
            <option value={danglingCurrent}>
              {`Missing credential · ${danglingCurrent.slice(0, 8)}…`}
            </option>
          ) : null}
        </select>
      </Field>
    </>
  );
}
