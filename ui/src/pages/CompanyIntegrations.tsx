import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_LABELS,
  INTEGRATION_CATEGORY_ORDER,
  INTEGRATION_CREDENTIAL_TYPES,
  INTEGRATION_ENVIRONMENTS,
  INTEGRATION_PROVIDERS,
  type IntegrationCategory,
  type IntegrationCredentialType,
  type IntegrationCredentialDto,
  type IntegrationEnvironment,
  type UnmanagedSecretDto,
} from "@noralos/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { integrationsApi } from "../api/integrations";
import { Button } from "@/components/ui/button";
import { Plug } from "lucide-react";

type Tab = "credentials" | "assignments";

export function CompanyIntegrations() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("credentials");
  const [addDrawerOpen, setAddDrawerOpen] = useState<{ kind: "create" } | { kind: "import"; secret: UnmanagedSecretDto } | null>(null);
  const [editDrawerCredential, setEditDrawerCredential] = useState<IntegrationCredentialDto | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings" }, { label: "Integrations" }]);
  }, [setBreadcrumbs]);

  const credentialsQuery = useQuery({
    queryKey: ["integrations", "credentials", selectedCompanyId],
    queryFn: () => integrationsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const unmanagedQuery = useQuery({
    queryKey: ["integrations", "unmanaged", selectedCompanyId],
    queryFn: () => integrationsApi.unmanaged(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const assignmentBoardQuery = useQuery({
    queryKey: ["integrations", "assignment-board", selectedCompanyId],
    queryFn: () => integrationsApi.assignmentBoard(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["integrations"] });
  }

  if (!selectedCompanyId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Select a company to manage integrations.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Plug className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Integrations</h1>
            <p className="text-xs text-muted-foreground">
              Manage API keys and credentials this company uses to call other systems. Webhooks settings will land in a follow-up release.
            </p>
          </div>
        </div>
        {tab === "credentials" ? (
          <Button onClick={() => setAddDrawerOpen({ kind: "create" })}>Add Credential</Button>
        ) : null}
      </header>

      <div className="flex items-center gap-1 border-b border-border px-8">
        <TabButton active={tab === "credentials"} onClick={() => setTab("credentials")}>
          Credentials
        </TabButton>
        <TabButton active={tab === "assignments"} onClick={() => setTab("assignments")}>
          Assignments
        </TabButton>
      </div>

      <main className="flex-1 overflow-auto px-8 py-6">
        {tab === "credentials" ? (
          <CredentialsTab
            credentials={credentialsQuery.data ?? []}
            unmanaged={unmanagedQuery.data ?? []}
            isLoading={credentialsQuery.isLoading || unmanagedQuery.isLoading}
            onAdd={() => setAddDrawerOpen({ kind: "create" })}
            onImport={(secret) => setAddDrawerOpen({ kind: "import", secret })}
            onEdit={(credential) => setEditDrawerCredential(credential)}
          />
        ) : (
          <AssignmentsTab
            companyId={selectedCompanyId}
            board={assignmentBoardQuery.data?.board ?? []}
            isLoading={assignmentBoardQuery.isLoading}
            refresh={refresh}
          />
        )}
      </main>

      {addDrawerOpen?.kind === "create" ? (
        <CredentialDrawer
          mode="create"
          companyId={selectedCompanyId}
          onClose={() => setAddDrawerOpen(null)}
          onSaved={() => {
            refresh();
            setAddDrawerOpen(null);
          }}
        />
      ) : null}
      {addDrawerOpen?.kind === "import" ? (
        <CredentialDrawer
          mode="import"
          companyId={selectedCompanyId}
          unmanagedSecret={addDrawerOpen.secret}
          onClose={() => setAddDrawerOpen(null)}
          onSaved={() => {
            refresh();
            setAddDrawerOpen(null);
          }}
        />
      ) : null}
      {editDrawerCredential ? (
        <CredentialDrawer
          mode="edit"
          companyId={selectedCompanyId}
          credential={editDrawerCredential}
          onClose={() => setEditDrawerCredential(null)}
          onSaved={() => {
            refresh();
            setEditDrawerCredential(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-3 text-sm font-medium transition ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Credentials tab
// ---------------------------------------------------------------------------
function CredentialsTab({
  credentials,
  unmanaged,
  isLoading,
  onAdd,
  onImport,
  onEdit,
}: {
  credentials: IntegrationCredentialDto[];
  unmanaged: UnmanagedSecretDto[];
  isLoading: boolean;
  onAdd: () => void;
  onImport: (secret: UnmanagedSecretDto) => void;
  onEdit: (credential: IntegrationCredentialDto) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<IntegrationCategory, IntegrationCredentialDto[]>();
    for (const c of credentials) {
      const key = c.category;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return map;
  }, [credentials]);

  if (isLoading && credentials.length === 0 && unmanaged.length === 0) {
    return <div className="text-sm text-muted-foreground">Loading credentials…</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      {credentials.length === 0 && unmanaged.length === 0 ? (
        <EmptyCredentials onAdd={onAdd} />
      ) : null}

      {INTEGRATION_CATEGORY_ORDER.map((category) => {
        const list = grouped.get(category) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={category}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {INTEGRATION_CATEGORY_LABELS[category]}
            </h2>
            <div className="rounded-lg border border-border bg-card">
              {list.map((credential, idx) => (
                <CredentialRow
                  key={credential.id}
                  credential={credential}
                  isLast={idx === list.length - 1}
                  onEdit={() => onEdit(credential)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {unmanaged.length > 0 ? (
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Unmanaged existing secrets
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            These encrypted secrets exist in the company secret store but are not yet managed from this page. Importing wraps them with metadata so they show up alongside other credentials. The underlying secret is not duplicated.
          </p>
          <div className="rounded-lg border border-amber-500/40 bg-amber-50/40 dark:bg-amber-500/5">
            {unmanaged.map((secret, idx) => (
              <UnmanagedRow
                key={secret.secretId}
                secret={secret}
                isLast={idx === unmanaged.length - 1}
                onImport={() => onImport(secret)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EmptyCredentials({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center">
      <Plug className="mx-auto mb-4 size-8 text-muted-foreground" />
      <h2 className="mb-2 text-lg font-semibold">No credentials yet</h2>
      <p className="mx-auto mb-6 max-w-md text-sm text-muted-foreground">
        Add an API key for a provider like Google Cloud TTS or ElevenLabs. NoralOS encrypts the value at rest and never displays it again — only the last four characters appear in the UI.
      </p>
      <Button onClick={onAdd}>Add your first credential</Button>
    </div>
  );
}

function CredentialRow({
  credential,
  isLast,
  onEdit,
}: {
  credential: IntegrationCredentialDto;
  isLast: boolean;
  onEdit: () => void;
}) {
  const provider = INTEGRATION_PROVIDERS[credential.provider];
  const providerLabel = provider?.displayName ?? credential.provider;
  const assignedTo = credential.assignments.map((a) => a.targetSlotLabel).join(", ");
  return (
    <div
      className={`grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-center gap-4 px-4 py-3 ${
        isLast ? "" : "border-b border-border"
      }`}
    >
      <div>
        <div className="font-medium">{credential.displayName}</div>
        <div className="text-xs text-muted-foreground">
          {providerLabel} · {credential.maskedSuffix}
        </div>
      </div>
      <div className="text-xs">
        <EnvironmentBadge environment={credential.environment} />
      </div>
      <div className="text-xs">
        <StatusBadge credential={credential} />
      </div>
      <div className="text-xs text-muted-foreground">
        {assignedTo ? (
          <span title={assignedTo}>Assigned: {assignedTo}</span>
        ) : (
          <span className="italic">Not assigned</span>
        )}
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Manage
        </Button>
      </div>
    </div>
  );
}

function UnmanagedRow({
  secret,
  isLast,
  onImport,
}: {
  secret: UnmanagedSecretDto;
  isLast: boolean;
  onImport: () => void;
}) {
  return (
    <div
      className={`grid grid-cols-[1.5fr_2fr_auto] items-center gap-4 px-4 py-3 ${
        isLast ? "" : "border-b border-amber-500/30"
      }`}
    >
      <div>
        <div className="font-mono text-xs">{secret.name}</div>
        {secret.description ? (
          <div className="text-xs text-muted-foreground">{secret.description}</div>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {secret.suggestedProvider
          ? `Looks like ${INTEGRATION_PROVIDERS[secret.suggestedProvider]?.displayName ?? secret.suggestedProvider}`
          : "Provider not detected — pick on import."}
      </div>
      <div>
        <Button size="sm" onClick={onImport}>
          Import
        </Button>
      </div>
    </div>
  );
}

function EnvironmentBadge({ environment }: { environment: IntegrationEnvironment }) {
  const palette: Record<IntegrationEnvironment, string> = {
    production: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    test: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    development: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${palette[environment]}`}>
      {environment}
    </span>
  );
}

function StatusBadge({ credential }: { credential: IntegrationCredentialDto }) {
  if (credential.status === "disabled") {
    return <span className="text-muted-foreground">Disabled</span>;
  }
  if (credential.status === "needs_attention") {
    return <span className="text-amber-700 dark:text-amber-300">Needs attention</span>;
  }
  if (credential.lastTestStatus === "failed") {
    return <span className="text-rose-700 dark:text-rose-300">Test failed</span>;
  }
  if (credential.lastTestStatus === "ok") {
    return <span className="text-emerald-700 dark:text-emerald-300">Tested · OK</span>;
  }
  if (credential.assignments.length > 0) {
    return <span className="text-foreground">Saved · Assigned</span>;
  }
  return <span className="text-foreground">Saved</span>;
}

// ---------------------------------------------------------------------------
// Add / Import / Edit drawer
// ---------------------------------------------------------------------------
function CredentialDrawer({
  mode,
  companyId,
  credential,
  unmanagedSecret,
  onClose,
  onSaved,
}: {
  mode: "create" | "import" | "edit";
  companyId: string;
  credential?: IntegrationCredentialDto;
  unmanagedSecret?: UnmanagedSecretDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState(
    credential?.provider ?? unmanagedSecret?.suggestedProvider ?? "google_tts",
  );
  const [displayName, setDisplayName] = useState(
    credential?.displayName ??
      (unmanagedSecret ? `Imported · ${unmanagedSecret.name}` : ""),
  );
  const [environment, setEnvironment] = useState<IntegrationEnvironment>(
    credential?.environment ?? "production",
  );
  const [description, setDescription] = useState(credential?.description ?? "");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState<IntegrationCategory>(
    (credential?.category as IntegrationCategory) ??
      unmanagedSecret?.suggestedCategory ??
      "voice",
  );
  const [credentialType, setCredentialType] = useState<IntegrationCredentialType>(
    (credential?.credentialType as IntegrationCredentialType) ?? "api_key",
  );
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; safeMessage: string } | null>(null);

  const create = useMutation({
    mutationFn: async () =>
      integrationsApi.create(companyId, {
        provider,
        displayName,
        environment,
        value,
        description: description || undefined,
      }),
    onSuccess: () => {
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const importExisting = useMutation({
    mutationFn: async () => {
      if (!unmanagedSecret) throw new Error("No unmanaged secret selected");
      return integrationsApi.importExisting(companyId, {
        secretId: unmanagedSecret.secretId,
        provider,
        displayName,
        environment,
        category,
        credentialType,
        description: description || undefined,
      });
    },
    onSuccess: () => onSaved(),
    onError: (err) => setError(err instanceof Error ? err.message : "Import failed"),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!credential) throw new Error("No credential");
      return integrationsApi.update(credential.id, {
        displayName,
        description: description || null,
        environment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Update failed"),
  });

  const rotate = useMutation({
    mutationFn: async () => {
      if (!credential) throw new Error("No credential");
      return integrationsApi.rotate(credential.id, { value });
    },
    onSuccess: () => {
      setValue("");
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Rotate failed"),
  });

  const disable = useMutation({
    mutationFn: async () => {
      if (!credential) throw new Error("No credential");
      return integrationsApi.disable(credential.id);
    },
    onSuccess: () => {
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Disable failed"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!credential) throw new Error("No credential");
      return integrationsApi.remove(credential.id);
    },
    onSuccess: () => {
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  const test = useMutation({
    mutationFn: async () => {
      if (!credential) throw new Error("No credential");
      return integrationsApi.test(credential.id);
    },
    onSuccess: (result) => {
      setTestResult({ ok: result.ok, safeMessage: result.safeMessage });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) =>
      setTestResult({
        ok: false,
        safeMessage: err instanceof Error ? err.message : "Test failed",
      }),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/40">
      <div
        className="absolute inset-0"
        onClick={onClose}
        role="presentation"
      />
      <aside className="relative z-10 flex h-full w-[480px] flex-col overflow-y-auto border-l border-border bg-background">
        <header className="border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">
            {mode === "create"
              ? "Add Credential"
              : mode === "import"
                ? "Import Existing Secret"
                : "Manage Credential"}
          </h2>
          {mode === "edit" && credential ? (
            <p className="text-xs text-muted-foreground">
              {INTEGRATION_PROVIDERS[credential.provider]?.displayName ?? credential.provider} ·{" "}
              {credential.maskedSuffix}
            </p>
          ) : null}
        </header>

        <div className="flex-1 px-6 py-5 space-y-5">
          {mode !== "edit" ? (
            <Field label="Provider">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                disabled={mode === "import" && Boolean(unmanagedSecret?.suggestedProvider)}
              >
                {Object.values(INTEGRATION_PROVIDERS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Display name">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              placeholder="Google TTS Production"
            />
          </Field>

          <Field label="Environment">
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as IntegrationEnvironment)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            >
              {INTEGRATION_ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </select>
          </Field>

          {mode === "import" ? (
            <>
              <Field label="Category">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as IntegrationCategory)}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  {INTEGRATION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Credential type">
                <select
                  value={credentialType}
                  onChange={(e) => setCredentialType(e.target.value as IntegrationCredentialType)}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  {INTEGRATION_CREDENTIAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : null}

          {mode !== "import" ? (
            <Field
              label={mode === "edit" ? "Replace secret value (optional)" : "Secret value"}
              hint={
                mode === "edit"
                  ? "Leave blank to keep the existing encrypted value. Submitting a new value rotates the credential."
                  : "Pasted once, encrypted at rest, never displayed again. Only the last four characters are kept for display."
              }
            >
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                placeholder={mode === "edit" ? credential?.maskedSuffix ?? "" : ""}
              />
            </Field>
          ) : null}

          <Field label="Notes (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              placeholder="Where this key was issued, who manages rotation, etc."
            />
          </Field>

          {testResult ? (
            <div
              className={`rounded border px-3 py-2 text-xs ${
                testResult.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              }`}
            >
              {testResult.safeMessage}
            </div>
          ) : null}
          {error ? (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {mode === "edit" && credential ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => test.mutate()}
                  disabled={test.isPending}
                >
                  {test.isPending ? "Testing…" : "Test"}
                </Button>
                {value.length > 0 ? (
                  <Button onClick={() => rotate.mutate()} disabled={rotate.isPending}>
                    {rotate.isPending ? "Rotating…" : "Rotate secret"}
                  </Button>
                ) : (
                  <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Saving…" : "Save metadata"}
                  </Button>
                )}
                {credential.status !== "disabled" ? (
                  <Button
                    variant="outline"
                    onClick={() => disable.mutate()}
                    disabled={disable.isPending}
                  >
                    Disable
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Delete this credential? This cannot be undone.")) {
                      remove.mutate();
                    }
                  }}
                  disabled={remove.isPending}
                >
                  Delete
                </Button>
              </>
            ) : null}
            {mode === "create" ? (
              <Button onClick={() => create.mutate()} disabled={create.isPending || !value || !displayName}>
                {create.isPending ? "Saving…" : "Save"}
              </Button>
            ) : null}
            {mode === "import" ? (
              <Button onClick={() => importExisting.mutate()} disabled={importExisting.isPending || !displayName}>
                {importExisting.isPending ? "Importing…" : "Import"}
              </Button>
            ) : null}
          </div>
        </footer>
      </aside>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignments tab
// ---------------------------------------------------------------------------
function AssignmentsTab({
  companyId,
  board,
  isLoading,
  refresh,
}: {
  companyId: string;
  board: Array<{
    pluginKey: string;
    pluginDisplayName: string;
    pluginId: string | null;
    slots: Array<{
      configPath: string;
      label: string;
      expectsProvider: string;
      currentCredential: IntegrationCredentialDto | null;
      candidates: IntegrationCredentialDto[];
    }>;
  }>;
  isLoading: boolean;
  refresh: () => void;
}) {
  void companyId;
  if (isLoading && board.length === 0) {
    return <div className="text-sm text-muted-foreground">Loading assignments…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-xs text-muted-foreground">
        Assign saved credentials to the plugins that use them. Voice Cascade stays in <span className="font-mono">dry_run</span> after assignment — assigning a key alone does not enable live TTS.
      </p>

      {board.map((card) => (
        <section key={card.pluginKey} className="rounded-lg border border-border bg-card p-5">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">{card.pluginDisplayName}</h2>
              <p className="text-xs text-muted-foreground">{card.pluginKey}</p>
            </div>
            {card.pluginKey === "noralos.voice-cascade" ? (
              <span className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                Mode: dry_run
              </span>
            ) : null}
          </header>

          <div className="space-y-4">
            {card.slots.map((slot) => (
              <AssignmentSlotRow
                key={slot.configPath}
                pluginId={card.pluginId}
                slot={slot}
                onChanged={refresh}
              />
            ))}
          </div>
        </section>
      ))}

      {board.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No assignable plugins are installed yet.
        </div>
      ) : null}
    </div>
  );
}

function AssignmentSlotRow({
  pluginId,
  slot,
  onChanged,
}: {
  pluginId: string | null;
  slot: {
    configPath: string;
    label: string;
    expectsProvider: string;
    currentCredential: IntegrationCredentialDto | null;
    candidates: IntegrationCredentialDto[];
  };
  onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);

  const assign = useMutation({
    mutationFn: async (credentialId: string) => {
      if (!pluginId) throw new Error("Plugin not installed");
      return integrationsApi.assign(credentialId, {
        targetKind: "plugin_config",
        targetPluginId: pluginId,
        targetConfigPath: slot.configPath,
      });
    },
    onSuccess: () => {
      setPicking(false);
      onChanged();
    },
  });

  const unassign = useMutation({
    mutationFn: async (assignmentId: string) =>
      integrationsApi.unassign(assignmentId),
    onSuccess: () => onChanged(),
  });

  const test = useMutation({
    mutationFn: async (credentialId: string) =>
      integrationsApi.test(credentialId),
    onSuccess: () => onChanged(),
  });

  const provider = INTEGRATION_PROVIDERS[slot.expectsProvider];
  const providerLabel = provider?.displayName ?? slot.expectsProvider;
  const current = slot.currentCredential;
  const currentAssignment = current?.assignments.find(
    (a) => a.targetPluginId === pluginId && a.targetConfigPath === slot.configPath,
  );

  return (
    <div className="rounded border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{slot.label}</div>
          <div className="text-xs text-muted-foreground">Expects a {providerLabel} credential</div>
        </div>
        {!pluginId ? (
          <span className="text-xs text-muted-foreground italic">Plugin not installed</span>
        ) : current ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-700 dark:text-emerald-300">
              Assigned · {current.displayName} · {current.maskedSuffix}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No credential assigned</span>
        )}
      </div>

      {picking ? (
        <CandidatePicker
          candidates={slot.candidates}
          onPick={(id) => assign.mutate(id)}
          onCancel={() => setPicking(false)}
          isPending={assign.isPending}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => setPicking(true)}
            disabled={!pluginId || slot.candidates.length === 0}
          >
            {current ? "Change" : "Assign"} credential
          </Button>
          {current && currentAssignment ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => test.mutate(current.id)}
                disabled={test.isPending}
              >
                {test.isPending ? "Testing…" : "Test"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => unassign.mutate(currentAssignment.id)}
                disabled={unassign.isPending}
              >
                {unassign.isPending ? "Removing…" : "Remove"}
              </Button>
            </>
          ) : null}
          {slot.candidates.length === 0 && !current ? (
            <span className="text-xs italic text-muted-foreground">
              Add a {providerLabel} credential first.
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CandidatePicker({
  candidates,
  onPick,
  onCancel,
  isPending,
}: {
  candidates: IntegrationCredentialDto[];
  onPick: (id: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded border border-dashed border-border bg-card p-3">
      {candidates.map((c) => (
        <label
          key={c.id}
          className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-muted"
        >
          <input
            type="radio"
            name="candidate"
            checked={selectedId === c.id}
            onChange={() => setSelectedId(c.id)}
          />
          <div className="flex-1">
            <div className="text-sm font-medium">{c.displayName}</div>
            <div className="text-xs text-muted-foreground">
              {c.environment} · {c.maskedSuffix}
            </div>
          </div>
        </label>
      ))}
      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!selectedId || isPending}
          onClick={() => selectedId && onPick(selectedId)}
        >
          {isPending ? "Assigning…" : "Confirm assignment"}
        </Button>
      </div>
    </div>
  );
}
