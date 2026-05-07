/**
 * Settings → Integrations.
 *
 * Admin-facing page for managing API credentials and assigning them to
 * plugin instance config fields (Phase 1: voice-cascade only).
 *
 * Layout decisions matching the existing dashboard conventions:
 *  - Tabs (`@/components/ui/tabs`) for the four top-level sections; copies
 *    the pattern used by `PluginSettings.tsx`.
 *  - Card / list rows for credentials rather than a data table — matches the
 *    `PluginManager.tsx` look (`<ul className="divide-y rounded-md …">`).
 *  - Sheet/Drawer for create + rotate flows; Dialog for the small assign
 *    picker. All shadcn primitives, no new ones.
 *  - Status pills via `<Badge variant="…">`.
 *  - Toast feedback through `useToastActions`.
 *
 * Visibility: the page is rendered for any user; the server returns 403 if
 * the actor isn't an instance admin, in which case the queries fall into
 * their error states and the page shows an inline notice. This matches the
 * existing `CompanySettingsSidebar` convention of trusting the server gate.
 *
 * Security UX:
 *  - Plaintext secrets only ever live in form-local React state; they are
 *    cleared as soon as the mutation resolves.
 *  - The created/rotated DTO returned by the server contains no `value`
 *    field, by API contract.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useCompany } from "@/context/CompanyContext";
import { useToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import {
  integrationsApi,
  type AssignmentTarget,
  type CredentialEnvironment,
  type CredentialType,
  type IntegrationAssignment,
  type IntegrationCredential,
  type ProviderCategory,
  type ProviderRegistryEntry,
  type UnmanagedSecret,
} from "@/api/integrations";
import { ApiError } from "@/api/client";

const ENVIRONMENTS: CredentialEnvironment[] = ["production", "test", "development"];
const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  voice: "Voice",
  llm: "AI Models",
  telephony: "Telephony",
  crm: "CRM",
  email_calendar: "Email & Calendar",
  webhook: "Webhooks",
  other: "Other",
};
const CATEGORY_ORDER: ProviderCategory[] = [
  "voice",
  "llm",
  "telephony",
  "crm",
  "email_calendar",
  "webhook",
  "other",
];

export function IntegrationsSettings() {
  const { selectedCompanyId } = useCompany();
  if (!selectedCompanyId) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          Select a company to manage integrations.
        </div>
      </div>
    );
  }
  return <IntegrationsBody companyId={selectedCompanyId} />;
}

function IntegrationsBody({ companyId }: { companyId: string }) {
  const credentialsQuery = useQuery({
    queryKey: queryKeys.integrations.credentials(companyId),
    queryFn: () => integrationsApi.listCredentials(companyId),
  });
  const registryQuery = useQuery({
    queryKey: queryKeys.integrations.providerRegistry(companyId),
    queryFn: () => integrationsApi.getProviderRegistry(companyId),
  });
  const assignmentsQuery = useQuery({
    queryKey: queryKeys.integrations.assignments(companyId),
    queryFn: () => integrationsApi.listAssignments(companyId),
  });
  const unmanagedQuery = useQuery({
    queryKey: queryKeys.integrations.unmanagedSecrets(companyId),
    queryFn: () => integrationsApi.listUnmanagedSecrets(companyId),
  });
  const healthQuery = useQuery({
    queryKey: queryKeys.integrations.health(companyId),
    queryFn: () => integrationsApi.getHealth(companyId),
  });

  const [activeTab, setActiveTab] = useState<"overview" | "credentials" | "assignments" | "providers">(
    "overview",
  );
  const [createOpen, setCreateOpen] = useState(false);

  if (credentialsQuery.isError) {
    const err = credentialsQuery.error;
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return (
        <div className="mx-auto max-w-4xl p-6">
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            You need instance admin access to manage integrations.
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load integrations.
        </div>
      </div>
    );
  }

  const credentials = credentialsQuery.data ?? [];
  const registry = registryQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const unmanaged = unmanagedQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage API keys and the integrations they power.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add credential
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="providers">Provider Status</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            credentials={credentials}
            assignments={assignments}
            unmanaged={unmanaged}
            onAddCredential={() => setCreateOpen(true)}
            onJumpTo={(tab) => setActiveTab(tab)}
          />
        </TabsContent>

        <TabsContent value="credentials" className="mt-4">
          <CredentialsTab
            companyId={companyId}
            credentials={credentials}
            registry={registry}
            unmanaged={unmanaged}
          />
        </TabsContent>

        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab
            companyId={companyId}
            credentials={credentials}
            registry={registry}
            assignments={assignments}
          />
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          <ProviderStatusTab
            registry={registry}
            health={healthQuery.data?.providers ?? []}
          />
        </TabsContent>
      </Tabs>

      <AddCredentialSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={companyId}
        registry={registry}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab(props: {
  credentials: IntegrationCredential[];
  assignments: IntegrationAssignment[];
  unmanaged: UnmanagedSecret[];
  onAddCredential: () => void;
  onJumpTo: (tab: "credentials" | "assignments" | "providers") => void;
}) {
  const { credentials, assignments, unmanaged, onAddCredential, onJumpTo } = props;
  const needsAttention = credentials.filter(
    (c) => c.status === "needs_attention" || c.lastTestStatus === "fail",
  ).length;
  const lastTestedAt = credentials
    .map((c) => c.lastTestedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Configured credentials"
          value={String(credentials.length)}
          onClick={() => onJumpTo("credentials")}
        />
        <KpiCard
          label="Needs attention"
          value={String(needsAttention)}
          tone={needsAttention > 0 ? "warning" : "default"}
          onClick={() => onJumpTo("credentials")}
        />
        <KpiCard
          label="Active assignments"
          value={String(assignments.length)}
          onClick={() => onJumpTo("assignments")}
        />
        <KpiCard
          label="Last tested"
          value={lastTestedAt ? formatRelative(lastTestedAt) : "—"}
          onClick={() => onJumpTo("providers")}
        />
      </div>

      {unmanaged.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {unmanaged.length} unmanaged{" "}
                {unmanaged.length === 1 ? "secret" : "secrets"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                These secrets exist in the encrypted store but aren&apos;t yet
                wrapped as integrations. Importing them adds metadata so they
                show up here without changing the underlying value.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => onJumpTo("credentials")}
              >
                Review unmanaged secrets
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {credentials.length === 0 && unmanaged.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">No credentials yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your first credential to start wiring integrations.
          </p>
          <Button className="mt-4" onClick={onAddCredential}>
            <Plus className="h-4 w-4" />
            Add credential
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function KpiCard(props: {
  label: string;
  value: string;
  tone?: "default" | "warning";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-md border bg-card p-4 text-left hover:border-border/80 hover:bg-accent/30 transition-colors"
    >
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {props.label}
      </div>
      <div
        className={[
          "mt-2 text-2xl font-semibold",
          props.tone === "warning" ? "text-amber-600 dark:text-amber-400" : "",
        ].join(" ")}
      >
        {props.value}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Credentials tab
// ---------------------------------------------------------------------------

function CredentialsTab(props: {
  companyId: string;
  credentials: IntegrationCredential[];
  registry: ProviderRegistryEntry[];
  unmanaged: UnmanagedSecret[];
}) {
  const { companyId, credentials, registry, unmanaged } = props;
  const grouped = useMemo(() => {
    const map = new Map<string, IntegrationCredential[]>();
    for (const c of credentials) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return map;
  }, [credentials]);

  return (
    <div className="grid grid-cols-1 gap-4">
      {unmanaged.length > 0 ? (
        <UnmanagedSecretsCard
          companyId={companyId}
          unmanaged={unmanaged}
          registry={registry}
        />
      ) : null}

      {credentials.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No credentials yet. Add your first one to get started.
          </p>
        </div>
      ) : null}

      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
        const list = grouped.get(cat) ?? [];
        return (
          <section key={cat}>
            <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {CATEGORY_LABELS[cat]}
            </h2>
            <ul className="divide-y rounded-md border bg-card overflow-hidden">
              {list.map((cred) => (
                <li key={cred.id}>
                  <CredentialRow
                    companyId={companyId}
                    credential={cred}
                    registry={registry}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CredentialRow(props: {
  companyId: string;
  credential: IntegrationCredential;
  registry: ProviderRegistryEntry[];
}) {
  const { companyId, credential, registry } = props;
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [rotateOpen, setRotateOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const provider = registry.find((r) => r.id === credential.provider);
  const providerName = provider?.displayName ?? credential.provider;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.credentials(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.assignments(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.health(companyId) });
  };

  const testMutation = useMutation({
    mutationFn: () => integrationsApi.testCredential(companyId, credential.id),
    onSuccess: (result) => {
      invalidate();
      if (result.status === "ok") {
        pushToast({ title: `${providerName} credential test passed`, tone: "success" });
      } else {
        pushToast({
          title: `${providerName} test failed`,
          body: result.message ?? result.error ?? "Unknown error",
          tone: "error",
        });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "Could not run test.";
      pushToast({ title: "Test failed", body: message, tone: "error" });
    },
  });

  const setStatusMutation = useMutation({
    mutationFn: (status: "active" | "disabled") =>
      integrationsApi.updateCredential(companyId, credential.id, { status }),
    onSuccess: (_data, status) => {
      invalidate();
      pushToast({
        title: status === "disabled" ? "Credential disabled" : "Credential enabled",
        tone: "success",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => integrationsApi.deleteCredential(companyId, credential.id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Credential deleted", tone: "success" });
      setConfirmDeleteOpen(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "Could not delete.";
      pushToast({ title: "Delete failed", body: message, tone: "error" });
    },
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{credential.displayName}</span>
          <StatusPill credential={credential} />
          <span className="text-xs text-muted-foreground">{providerName}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground capitalize">{credential.environment}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs font-mono text-muted-foreground">{credential.maskedSuffix}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {credential.lastTestedAt ? (
            <>
              Last tested {formatRelative(credential.lastTestedAt)}
              {credential.lastTestStatus === "fail" && credential.lastTestError ? (
                <> · <span className="text-destructive">{credential.lastTestError}</span></>
              ) : null}
            </>
          ) : (
            <>Not tested yet</>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => testMutation.mutate()}
        disabled={testMutation.isPending || credential.status === "disabled"}
      >
        {testMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="px-2">
            ⋯
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRotateOpen(true)}>
            <RefreshCcw className="h-4 w-4" />
            Replace value
          </DropdownMenuItem>
          {credential.status === "disabled" ? (
            <DropdownMenuItem onSelect={() => setStatusMutation.mutate("active")}>
              <CheckCircle2 className="h-4 w-4" />
              Enable
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setStatusMutation.mutate("disabled")}>
              <CircleSlash className="h-4 w-4" />
              Disable
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setConfirmDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RotateCredentialSheet
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        companyId={companyId}
        credential={credential}
      />

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this credential?</DialogTitle>
            <DialogDescription>
              The encrypted value and its history will be permanently removed.
              This cannot be undone. Active assignments must be removed first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({ credential }: { credential: IntegrationCredential }) {
  if (credential.status === "disabled") {
    return <Badge variant="secondary">Disabled</Badge>;
  }
  if (credential.status === "needs_attention" || credential.lastTestStatus === "fail") {
    return <Badge variant="destructive">Needs attention</Badge>;
  }
  if (credential.lastTestStatus === "ok") {
    return <Badge variant="default">Tested</Badge>;
  }
  return <Badge variant="outline">Active</Badge>;
}

function UnmanagedSecretsCard(props: {
  companyId: string;
  unmanaged: UnmanagedSecret[];
  registry: ProviderRegistryEntry[];
}) {
  const { companyId, unmanaged, registry } = props;
  const [importing, setImporting] = useState<UnmanagedSecret | null>(null);
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5">
      <div className="flex items-start gap-3 p-4 border-b border-amber-500/30">
        <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">Unmanaged existing secrets</p>
          <p className="mt-1 text-xs text-muted-foreground">
            These encrypted secrets aren&apos;t wrapped as integrations yet.
            Import each one to surface it here. The encrypted material is not
            modified.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-amber-500/20">
        {unmanaged.map((s) => (
          <li key={s.secretId} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {s.provider} · {formatRelative(s.createdAt)}
                {s.description ? ` · ${s.description}` : ""}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setImporting(s)}>
              Import
            </Button>
          </li>
        ))}
      </ul>
      <ImportSecretSheet
        secret={importing}
        onClose={() => setImporting(null)}
        companyId={companyId}
        registry={registry}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignments tab
// ---------------------------------------------------------------------------

function AssignmentsTab(props: {
  companyId: string;
  credentials: IntegrationCredential[];
  registry: ProviderRegistryEntry[];
  assignments: IntegrationAssignment[];
}) {
  const { companyId, credentials, registry, assignments } = props;

  const voiceCascadeFields: Array<{
    field: string;
    label: string;
    description: string;
  }> = [
    {
      field: "googleTtsApiKeyRef",
      label: "Google Cloud TTS",
      description: "Used for the Google leg of voice synthesis.",
    },
    {
      field: "elevenLabsApiKeyRef",
      label: "ElevenLabs",
      description: "Used for the ElevenLabs leg of voice synthesis.",
    },
    {
      field: "voiceConfigAgentTokenRef",
      label: "Voice-Config Agent Token",
      description:
        "Internal Paperclip agent token used for the voice-config HTTP fallback path.",
    },
  ];

  const assignmentFor = (field: string) =>
    assignments.find(
      (a) => a.targetPluginKey === "voice-cascade" && a.targetField === field,
    );
  const credentialFor = (assignment: IntegrationAssignment | undefined) =>
    assignment ? credentials.find((c) => c.id === assignment.credentialId) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <section className="rounded-md border bg-card overflow-hidden">
        <header className="flex items-start justify-between gap-4 px-4 py-3 border-b">
          <div>
            <h2 className="text-sm font-semibold">Voice Cascade</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              TTS execution layer for Conference Room and other voice surfaces.
            </p>
          </div>
          <Badge variant="outline">Mode: dry_run</Badge>
        </header>
        <div className="px-4 py-3 text-xs text-muted-foreground border-b bg-muted/30">
          This integration applies to the whole instance. Assigning a credential
          does not enable live voice — Voice Cascade stays in <code>dry_run</code>{" "}
          until live mode is enabled separately in plugin settings.
        </div>
        <ul className="divide-y">
          {voiceCascadeFields.map((f) => {
            const assignment = assignmentFor(f.field);
            const credential = credentialFor(assignment);
            return (
              <li key={f.field}>
                <AssignmentRow
                  companyId={companyId}
                  pluginKey="voice-cascade"
                  field={f.field}
                  label={f.label}
                  description={f.description}
                  credentials={credentials}
                  registry={registry}
                  assignment={assignment}
                  credential={credential}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function AssignmentRow(props: {
  companyId: string;
  pluginKey: string;
  field: string;
  label: string;
  description: string;
  credentials: IntegrationCredential[];
  registry: ProviderRegistryEntry[];
  assignment: IntegrationAssignment | undefined;
  credential: IntegrationCredential | undefined;
}) {
  const {
    companyId,
    pluginKey,
    field,
    label,
    description,
    credentials,
    registry,
    assignment,
    credential,
  } = props;
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Eligible credentials = those whose provider lists this (pluginKey, field)
  // among its assignmentTargets.
  const eligibleCredentials = useMemo(
    () =>
      credentials.filter((c) => {
        const provider = registry.find((r) => r.id === c.provider);
        if (!provider) return false;
        return provider.assignmentTargets.some(
          (t: AssignmentTarget) => t.pluginKey === pluginKey && t.field === field,
        );
      }),
    [credentials, registry, pluginKey, field],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.credentials(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.integrations.assignments(companyId) });
  };

  const unassignMutation = useMutation({
    mutationFn: () => {
      if (!assignment) return Promise.resolve({ ok: true });
      return integrationsApi.unassignCredential(companyId, assignment.credentialId, assignment.id);
    },
    onSuccess: () => {
      invalidate();
      pushToast({ title: `${label} assignment removed`, tone: "success" });
    },
  });

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{label}</span>
            {credential ? (
              <Badge variant="outline">
                {credential.displayName}
                <span className="ml-1 font-mono text-muted-foreground">
                  {credential.maskedSuffix}
                </span>
              </Badge>
            ) : (
              <Badge variant="secondary">Unassigned</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={credential ? "secondary" : "default"}
            onClick={() => setPickerOpen(true)}
            disabled={eligibleCredentials.length === 0}
          >
            {credential ? "Change" : "Assign"}
          </Button>
          {credential ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => unassignMutation.mutate()}
              disabled={unassignMutation.isPending}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <AssignDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        companyId={companyId}
        pluginKey={pluginKey}
        field={field}
        label={label}
        eligibleCredentials={eligibleCredentials}
        currentCredentialId={credential?.id ?? null}
      />
    </div>
  );
}

function AssignDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  pluginKey: string;
  field: string;
  label: string;
  eligibleCredentials: IntegrationCredential[];
  currentCredentialId: string | null;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [selectedId, setSelectedId] = useState<string | null>(props.currentCredentialId);

  const mutation = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Pick a credential");
      return integrationsApi.assignCredential(props.companyId, selectedId, {
        pluginKey: props.pluginKey,
        targetField: props.field,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.credentials(props.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.assignments(props.companyId) });
      pushToast({ title: `${props.label} assigned`, tone: "success" });
      props.onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "Could not assign.";
      pushToast({ title: "Assignment failed", body: message, tone: "error" });
    },
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {props.label}</DialogTitle>
          <DialogDescription>
            Choose which credential the plugin should use for this field. Live
            voice is not enabled by this action.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Credential</Label>
          <Select value={selectedId ?? ""} onValueChange={(v) => setSelectedId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a credential" />
            </SelectTrigger>
            <SelectContent>
              {props.eligibleCredentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.displayName} · {c.maskedSuffix}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!selectedId || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Provider Status tab
// ---------------------------------------------------------------------------

function ProviderStatusTab(props: {
  registry: ProviderRegistryEntry[];
  health: { provider: string; status: "ok" | "fail" | "untested"; lastTestedAt: string | null }[];
}) {
  const { registry, health } = props;
  const enabled = registry.filter((p) => p.enabled);
  const upcoming = registry.filter((p) => !p.enabled);
  return (
    <div className="grid grid-cols-1 gap-4">
      <section>
        <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Live providers
        </h2>
        <ul className="divide-y rounded-md border bg-card overflow-hidden">
          {enabled.map((p) => {
            const h = health.find((row) => row.provider === p.id);
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.displayName}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {p.category} · {p.credentialType}
                  </div>
                </div>
                <ProviderStatusBadge status={h?.status ?? "untested"} />
                <span className="text-xs text-muted-foreground">
                  {h?.lastTestedAt ? formatRelative(h.lastTestedAt) : "Never tested"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {upcoming.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Coming soon
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {upcoming.map((p) => (
              <div
                key={p.id}
                className="rounded-md border border-dashed bg-card/50 px-3 py-2 text-xs text-muted-foreground"
              >
                <div className="font-medium text-foreground/70">{p.displayName}</div>
                <div className="capitalize">{p.category}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProviderStatusBadge({ status }: { status: "ok" | "fail" | "untested" }) {
  if (status === "ok") return <Badge variant="default">Healthy</Badge>;
  if (status === "fail")
    return (
      <Badge variant="destructive">
        <AlertCircle className="h-3 w-3" /> Failing
      </Badge>
    );
  return <Badge variant="outline">Untested</Badge>;
}

// ---------------------------------------------------------------------------
// Add credential sheet
// ---------------------------------------------------------------------------

function AddCredentialSheet(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  registry: ProviderRegistryEntry[];
}) {
  const { open, onOpenChange, companyId, registry } = props;
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const enabledProviders = registry.filter((p) => p.enabled);

  const [providerId, setProviderId] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [environment, setEnvironment] = useState<CredentialEnvironment>("production");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");

  const reset = () => {
    setProviderId("");
    setDisplayName("");
    setEnvironment("production");
    setDescription("");
    setValue("");
  };

  const mutation = useMutation({
    mutationFn: () =>
      integrationsApi.createCredential(companyId, {
        provider: providerId,
        displayName,
        environment,
        description: description || null,
        value,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.credentials(companyId) });
      pushToast({
        title: "Credential saved",
        body: "The full key is encrypted and can no longer be displayed.",
        tone: "success",
      });
      // Drop plaintext from React state immediately.
      reset();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "Could not save credential.";
      pushToast({ title: "Save failed", body: message, tone: "error" });
    },
  });

  const provider = registry.find((r) => r.id === providerId);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add credential</SheetTitle>
          <SheetDescription>
            Secrets are encrypted at rest and cannot be viewed after saving.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="add-cred-provider">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger id="add-cred-provider">
                <SelectValue placeholder="Choose provider" />
              </SelectTrigger>
              <SelectContent>
                {enabledProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {provider?.description ? (
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-cred-name">Display name</Label>
            <Input
              id="add-cred-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Google TTS Production"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-cred-env">Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as CredentialEnvironment)}>
              <SelectTrigger id="add-cred-env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENVIRONMENTS.map((env) => (
                  <SelectItem key={env} value={env}>
                    <span className="capitalize">{env}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-cred-value">Secret value</Label>
            <Input
              id="add-cred-value"
              type="password"
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Encrypted on save. You won&apos;t be able to view it again.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-cred-desc">Description (optional)</Label>
            <Textarea
              id="add-cred-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <SheetFooter>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!providerId || !displayName || !value || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save credential
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Rotate credential sheet
// ---------------------------------------------------------------------------

function RotateCredentialSheet(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  credential: IntegrationCredential;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      integrationsApi.rotateCredential(props.companyId, props.credential.id, value),
    onSuccess: (cred) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.credentials(props.companyId),
      });
      pushToast({
        title: "Credential replaced",
        body: `New value ends in ${cred.maskedSuffix}.`,
        tone: "success",
      });
      setValue("");
      props.onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "Could not rotate.";
      pushToast({ title: "Rotation failed", body: message, tone: "error" });
    },
  });

  return (
    <Sheet
      open={props.open}
      onOpenChange={(v) => {
        if (!v) setValue("");
        props.onOpenChange(v);
      }}
    >
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Replace value</SheetTitle>
          <SheetDescription>
            Replaces the encrypted secret with a new value. The new value
            takes effect for any plugin that uses this credential.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="rotate-cred-value">New secret value</Label>
            <Input
              id="rotate-cred-value"
              type="password"
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <SheetFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setValue("");
              props.onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!value || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Replace
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Import secret sheet
// ---------------------------------------------------------------------------

function ImportSecretSheet(props: {
  secret: UnmanagedSecret | null;
  onClose: () => void;
  companyId: string;
  registry: ProviderRegistryEntry[];
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [providerId, setProviderId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [environment, setEnvironment] = useState<CredentialEnvironment>("production");

  const open = !!props.secret;

  // Lazy initialise the form when a secret is selected for import.
  useMemo(() => {
    if (props.secret) {
      setDisplayName(props.secret.name);
    } else {
      setProviderId("");
      setDisplayName("");
      setEnvironment("production");
    }
  }, [props.secret]);

  const provider = props.registry.find((r) => r.id === providerId);

  const mutation = useMutation({
    mutationFn: () => {
      if (!props.secret || !provider) throw new Error("Pick a provider");
      return integrationsApi.importCredential(props.companyId, {
        secretId: props.secret.secretId,
        provider: provider.id,
        category: provider.category as ProviderCategory,
        credentialType: provider.credentialType as CredentialType,
        displayName,
        environment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.credentials(props.companyId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.unmanagedSecrets(props.companyId),
      });
      pushToast({ title: "Secret imported", tone: "success" });
      props.onClose();
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "Could not import.";
      pushToast({ title: "Import failed", body: message, tone: "error" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : props.onClose())}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Import existing secret</SheetTitle>
          <SheetDescription>
            Wraps an existing encrypted secret so it appears here as a managed
            credential. The encrypted value is not changed.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 py-4">
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-mono">{props.secret?.name}</div>
            {props.secret?.description ? (
              <div className="mt-1 text-muted-foreground">{props.secret.description}</div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose provider" />
              </SelectTrigger>
              <SelectContent>
                {props.registry.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={!p.enabled}>
                    {p.displayName}
                    {!p.enabled ? " (coming soon)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as CredentialEnvironment)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENVIRONMENTS.map((env) => (
                  <SelectItem key={env} value={env}>
                    <span className="capitalize">{env}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            We can&apos;t read the existing value, so the masked suffix is shown
            as <code>••••????</code> until you next replace it.
          </p>
        </div>
        <SheetFooter>
          <Button variant="secondary" onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!providerId || !displayName || !provider?.enabled || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Import
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = Date.now() - d;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
