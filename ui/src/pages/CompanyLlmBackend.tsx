import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMPANY_LLM_BACKEND_MODES,
  DEEPSEEK_OPENCODE_MODELS,
  DEFAULT_DEEPSEEK_OPENCODE_MODEL,
  type CompanyLlmBackendMode,
} from "@noralos/shared";
import { Cpu } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "../components/agent-config-primitives";

const MODE_LABELS: Record<CompanyLlmBackendMode, string> = {
  native: "Claude Code — each agent's own adapter (default)",
  deepseek_v4: "DeepSeek V4 — agentic, via OpenCode",
};

function modelLabel(modelId: string | undefined): string {
  const match = DEEPSEEK_OPENCODE_MODELS.find((entry) => entry.id === modelId);
  return match?.label ?? modelId ?? DEFAULT_DEEPSEEK_OPENCODE_MODEL;
}

export function CompanyLlmBackend() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<CompanyLlmBackendMode>("native");
  const [model, setModel] = useState<string>(DEFAULT_DEEPSEEK_OPENCODE_MODEL);
  const [credentialId, setCredentialId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings" }, { label: "LLM Backend" }]);
  }, [setBreadcrumbs]);

  const backendQuery = useQuery({
    queryKey: ["company-llm-backend", selectedCompanyId],
    queryFn: () => companiesApi.getLlmBackend(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const settings = backendQuery.data?.settings;
  const credentials = useMemo(() => backendQuery.data?.credentials ?? [], [backendQuery.data]);

  // Hydrate local form state from the persisted setting once it loads.
  useEffect(() => {
    if (!settings) return;
    setMode(settings.mode);
    setModel(settings.model || DEFAULT_DEEPSEEK_OPENCODE_MODEL);
    setCredentialId(settings.credentialId ?? "");
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () =>
      companiesApi.updateLlmBackend(selectedCompanyId!, {
        mode,
        ...(mode === "deepseek_v4" ? { model, credentialId } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["company-llm-backend", selectedCompanyId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      setSaved(false);
      setError(err instanceof Error ? err.message : "Failed to update the LLM backend");
    },
  });

  if (!selectedCompanyId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Select a company to manage its LLM backend.
      </div>
    );
  }

  const deepseekSelected = mode === "deepseek_v4";
  const missingCredential = deepseekSelected && !credentialId;
  const isDirty =
    !!settings &&
    (mode !== settings.mode ||
      (deepseekSelected &&
        (model !== (settings.model || DEFAULT_DEEPSEEK_OPENCODE_MODEL) ||
          credentialId !== (settings.credentialId ?? ""))));
  const canSave = !mutation.isPending && !missingCredential && isDirty;

  const activeBackendDescription = settings
    ? settings.mode === "deepseek_v4"
      ? `DeepSeek V4 (${modelLabel(settings.model)})`
      : "Claude Code (native)"
    : "…";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-border bg-card p-2">
          <Cpu className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">LLM Backend</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Switch every agent in this company between its native backend (Claude Code) and
            DeepSeek V4 run agentically via OpenCode. Applied at run time — agent configurations are
            never modified, so switching back to Claude Code is instant and lossless.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <span className="text-muted-foreground">Agents currently run on: </span>
        <span className="font-semibold text-foreground">{activeBackendDescription}</span>
      </div>

      {backendQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-5 rounded-lg border border-border bg-card p-4">
          <Field
            label="Backend"
            hint="DeepSeek V4 forces every agent onto opencode_local + DeepSeek for each run. Native restores each agent's own adapter."
          >
            <Select value={mode} onValueChange={(value) => setMode(value as CompanyLlmBackendMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPANY_LLM_BACKEND_MODES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MODE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {deepseekSelected ? (
            <>
              <Field
                label="DeepSeek credential"
                hint="The NoralAI (noralai_brooklyn) integration credential holding the DeepSeek API key. Resolved per run and injected as DEEPSEEK_API_KEY."
              >
                {credentials.length === 0 ? (
                  <p className="text-xs text-amber-500">
                    No NoralAI credentials found. Add one in Settings → Integrations first.
                  </p>
                ) : (
                  <Select value={credentialId} onValueChange={setCredentialId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a credential…" />
                    </SelectTrigger>
                    <SelectContent>
                      {credentials.map((credential) => (
                        <SelectItem key={credential.id} value={credential.id}>
                          {credential.displayName}
                          {credential.maskedSuffix ? ` · ${credential.maskedSuffix}` : ""}
                          {credential.status !== "active" ? ` (${credential.status})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field label="Model" hint="DeepSeek V4 Pro is the most capable; Flash is cheaper and faster.">
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEEPSEEK_OPENCODE_MODELS.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {saved && !isDirty ? (
            <p className="text-sm text-emerald-500">Saved. The new backend applies to each agent's next run.</p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                setSaved(false);
                mutation.mutate();
              }}
              disabled={!canSave}
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
            {missingCredential ? (
              <span className="text-xs text-muted-foreground">
                Select a DeepSeek credential to enable saving.
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
