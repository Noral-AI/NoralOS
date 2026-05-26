/**
 * NoralVoice plugin page (Phase 4: tabbed browse surfaces).
 *
 * Seven tabs:
 *   - Voice Agents   — Voice Directors + workflow list
 *   - Runs           — paginated table; side-panel detail
 *   - Recordings     — table; in-page <audio> playback via presigned URL
 *   - Knowledge Base — search + document list
 *   - Campaigns      — list filtered by status; detail drawer
 *   - Telephony      — read-only numbers + providers (writes deep-link out)
 *   - Settings       — Phase 1 "configure NV connection" state
 *
 * Architecture notes:
 *   - Plain `fetch` + `useEffect` patterns; no react-query dependency
 *     because the plugin UI is bundled by esbuild and external'd only
 *     for react/react-dom/jsx-runtime/@noralos/plugin-sdk/ui (see
 *     scripts/build-ui.mjs). Adding react-query would bloat the bundle
 *     ~40kb gzipped — not worth it for the few queries here.
 *   - Each tab gets its own `useEffect` that abort-controllers + cancels
 *     on company change, so switching companies cleanly refreshes
 *     without ghost setState.
 *   - Error states branch into three categories matching the worker's
 *     uniform error shape:
 *       NO_API_KEY  → "Your NoralVoice key is missing/invalid"
 *       NORALVOICE_5XX / network → "Couldn't reach NoralVoice"
 *       NORALVOICE_4XX (anything else 4xx) → "NoralVoice returned an error"
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PluginPageProps } from "@noralos/plugin-sdk/ui";

import { PLUGIN_ID } from "../constants.js";

// ---------- Types ----------

type TabId =
  | "voice-agents"
  | "runs"
  | "recordings"
  | "kb"
  | "campaigns"
  | "telephony"
  | "settings";

interface VoiceDirector {
  id: string;
  name: string;
  status?: string;
  lastActivityAt?: string | null;
}

interface WorkflowSummary {
  uuid: string;
  name: string;
  status?: string;
  lastRunAt?: string | null;
}

interface RunListItem {
  id: number;
  name: string;
  state: string;
  isCompleted: boolean;
  callType?: string;
  createdAt?: string;
  transcriptUrl?: string | null;
  recordingUrl?: string | null;
  costInfo?: Record<string, unknown> | null;
}

interface RecordingListItem {
  id: number;
  workflowId?: number;
  name?: string;
  ttsProvider?: string;
  ttsVoiceId?: string;
  durationSec?: number;
  createdAt?: string;
}

interface KbDocumentSummary {
  id: number;
  name: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: string;
  chunkCount?: number;
}

interface KbSearchHit {
  documentId: number;
  documentName?: string;
  chunkIndex?: number;
  text: string;
  score: number;
}

interface CampaignSummary {
  id: number;
  name: string;
  status: string;
  workflowId?: number;
  totalContacts?: number;
  completedCalls?: number;
  createdAt?: string;
}

interface PhoneNumberSummary {
  id: number;
  phoneNumber: string;
  provider?: string;
  inboundWorkflowId?: number | null;
  isActive?: boolean;
}

interface TelephonyProviderSummary {
  id: number;
  name: string;
  provider: string;
  isActive: boolean;
  isDefault?: boolean;
}

interface PagedResult<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

type ErrorBody = { ok?: false; error?: string; status?: number; message?: string };

// ---------- Styling helpers ----------

const cardClass = "rounded-lg border border-border/60 bg-card p-4 shadow-sm";
const subduedClass = "text-sm text-muted-foreground";
const tabButtonClass =
  "px-3 py-1.5 text-sm font-medium border-b-2 transition-colors hover:text-foreground";

// ---------- Error/loading helpers ----------

type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; message: string; category: "no-key" | "unreachable" | "remote-error" };

function categoriseError(
  body: ErrorBody,
  status: number,
): Extract<LoadState<never>, { kind: "error" }>["category"] {
  if (body.error === "NO_API_KEY") return "no-key";
  if (body.error === "NORALVOICE_5XX" || status === 0 || status >= 500) return "unreachable";
  return "remote-error";
}

function ErrorPanel({
  state,
  retry,
}: {
  state: Extract<LoadState<unknown>, { kind: "error" }>;
  retry?: () => void;
}): ReactNode {
  let title: string;
  if (state.category === "no-key") title = "Your NoralVoice key is missing or invalid";
  else if (state.category === "unreachable") title = "Couldn't reach NoralVoice";
  else title = "NoralVoice returned an error";
  return (
    <div className="flex flex-col gap-2 p-4 text-sm">
      <p className="font-medium text-destructive">{title}</p>
      <p className={subduedClass}>{state.message}</p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="self-start mt-2 inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function LoadingSkeleton({ rows = 4 }: { rows?: number }): ReactNode {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}

function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 p-6 text-center">
      <p className="text-base font-medium">{title}</p>
      <p className={subduedClass}>{description}</p>
      {cta ? <div className="mt-2 self-center">{cta}</div> : null}
    </div>
  );
}

// ---------- Fetch helper ----------

function pluginUrl(path: string, companyId: string): string {
  const base = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api${path}`;
  return base.includes("?")
    ? `${base}&companyId=${encodeURIComponent(companyId)}`
    : `${base}?companyId=${encodeURIComponent(companyId)}`;
}

async function pluginFetch<T>(
  url: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: ErrorBody }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "include",
      signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { ok: false, status: 0, body: { message: "Network error" } };
  }
  const body = (await response.json().catch(() => ({}))) as ErrorBody | T;
  if (!response.ok) {
    return { ok: false, status: response.status, body: body as ErrorBody };
  }
  return { ok: true, data: body as T };
}

// ---------- Voice Agents tab ----------

function VoiceAgentsTab({ companyId, companyPrefix }: { companyId: string; companyPrefix?: string }): ReactNode {
  const [directorsState, setDirectorsState] = useState<LoadState<VoiceDirector[]>>({ kind: "loading" });
  const [workflowsState, setWorkflowsState] = useState<LoadState<WorkflowSummary[]>>({ kind: "loading" });
  const [creating, setCreating] = useState(false);

  function loadAll() {
    const directorsController = new AbortController();
    const workflowsController = new AbortController();
    setDirectorsState({ kind: "loading" });
    setWorkflowsState({ kind: "loading" });

    pluginFetch<{ agents?: VoiceDirector[] }>(
      `/api/companies/${encodeURIComponent(companyId)}/agents?templateId=voice-director`,
      directorsController.signal,
    ).then((r) => {
      if (!r.ok) {
        setDirectorsState({
          kind: "error",
          message: r.body.message ?? `HTTP ${r.status}`,
          category: categoriseError(r.body, r.status),
        });
        return;
      }
      setDirectorsState({ kind: "ready", data: r.data.agents ?? [] });
    }).catch(() => undefined);

    pluginFetch<{ workflows?: WorkflowSummary[] }>(
      pluginUrl("/workflows", companyId),
      workflowsController.signal,
    ).then((r) => {
      if (!r.ok) {
        setWorkflowsState({
          kind: "error",
          message: r.body.message ?? `HTTP ${r.status}`,
          category: categoriseError(r.body, r.status),
        });
        return;
      }
      setWorkflowsState({ kind: "ready", data: r.data.workflows ?? [] });
    }).catch(() => undefined);

    return () => {
      directorsController.abort();
      workflowsController.abort();
    };
  }

  useEffect(() => loadAll(), [companyId]);

  async function createVoiceDirector() {
    setCreating(true);
    try {
      await fetch(pluginUrl("/voice-directors", companyId), {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } finally {
      setCreating(false);
      loadAll();
    }
  }

  const noKey =
    directorsState.kind === "error" && directorsState.category === "no-key";

  return (
    <div className="flex flex-col gap-4">
      <section className={cardClass}>
        <h2 className="mb-2 text-lg font-medium">Voice Directors</h2>
        {directorsState.kind === "loading" ? (
          <LoadingSkeleton />
        ) : directorsState.kind === "error" ? (
          <ErrorPanel state={directorsState} retry={loadAll} />
        ) : directorsState.data.length === 0 ? (
          <EmptyState
            title="No Voice Director yet"
            description="The Voice Director is the manager-tier agent that owns voice operations. One click creates the default."
            cta={
              <button
                type="button"
                onClick={createVoiceDirector}
                disabled={creating}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create Voice Director"}
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {directorsState.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{d.name}</span>
                  <span className={subduedClass}>
                    {d.status ?? "active"}
                    {d.lastActivityAt ? ` · last activity ${new Date(d.lastActivityAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <a
                  href={companyPrefix ? `/${companyPrefix}/agents/${d.id}` : `/agents/${d.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  Open →
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Voice workflows</h2>
          {workflowsState.kind === "ready" ? (
            <span className={subduedClass}>{workflowsState.data.length} total</span>
          ) : null}
        </div>
        {noKey ? (
          <EmptyState
            title="Connect NoralVoice first"
            description="Add your NoralVoice API key under Settings → Integrations to see workflows."
          />
        ) : workflowsState.kind === "loading" ? (
          <LoadingSkeleton />
        ) : workflowsState.kind === "error" ? (
          <ErrorPanel state={workflowsState} retry={loadAll} />
        ) : workflowsState.data.length === 0 ? (
          <EmptyState
            title="No voice workflows yet"
            description="Voice Directors design workflows through the NoralVoice editor. Open one from the Voice settings tab on any agent to provision a starter."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {workflowsState.data.map((w) => (
              <li key={w.uuid} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{w.name}</span>
                  <span className={subduedClass}>
                    {w.status ?? "active"}
                    {w.lastRunAt ? ` · last run ${new Date(w.lastRunAt).toLocaleDateString()}` : ""}
                    {" · "}
                    <code className="font-mono text-xs">{w.uuid.slice(0, 8)}</code>
                  </span>
                </div>
                {/* "Open builder" wires up in Phase 4 PR-B (iframed modal). For
                    PR-A we deep-link out to NoralVoice — a small UX regression
                    that goes away as soon as PR-B lands. */}
                <a
                  href={`https://voice.noral.ai/workflow/${w.uuid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Open in NoralVoice ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- Runs tab ----------

function RunsTab({ companyId }: { companyId: string }): ReactNode {
  const [workflowsState, setWorkflowsState] = useState<LoadState<WorkflowSummary[]>>({ kind: "loading" });
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");
  const [runsState, setRunsState] = useState<LoadState<PagedResult<RunListItem>>>({ kind: "loading" });
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunListItem | null>(null);

  // 1. Load workflow list (so we can scope runs by workflow)
  useEffect(() => {
    const controller = new AbortController();
    pluginFetch<{ workflows?: WorkflowSummary[] }>(pluginUrl("/workflows", companyId), controller.signal)
      .then((r) => {
        if (!r.ok) {
          setWorkflowsState({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        const wfs = r.data.workflows ?? [];
        setWorkflowsState({ kind: "ready", data: wfs });
        if (wfs.length > 0 && !selectedWorkflow) setSelectedWorkflow(wfs[0]!.uuid);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // 2. Load runs for the selected workflow + cursor
  useEffect(() => {
    if (!selectedWorkflow) {
      setRunsState({ kind: "loading" });
      return;
    }
    const controller = new AbortController();
    setRunsState({ kind: "loading" });
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    pluginFetch<PagedResult<RunListItem>>(
      pluginUrl(`/runs?workflowUuid=${encodeURIComponent(selectedWorkflow)}&limit=25${cursorParam}`, companyId),
      controller.signal,
    )
      .then((r) => {
        if (!r.ok) {
          setRunsState({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setRunsState({ kind: "ready", data: r.data });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId, selectedWorkflow, cursor]);

  return (
    <div className="flex flex-col gap-4">
      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-3">
          <label className="text-sm font-medium" htmlFor="run-workflow">
            Workflow
          </label>
          <select
            id="run-workflow"
            value={selectedWorkflow}
            onChange={(e) => {
              setSelectedWorkflow(e.target.value);
              setCursor(null);
            }}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            disabled={workflowsState.kind !== "ready"}
          >
            {workflowsState.kind === "ready"
              ? workflowsState.data.map((w) => (
                  <option key={w.uuid} value={w.uuid}>
                    {w.name}
                  </option>
                ))
              : null}
          </select>
        </div>

        {runsState.kind === "loading" ? (
          <LoadingSkeleton />
        ) : runsState.kind === "error" ? (
          <ErrorPanel state={runsState} retry={() => setCursor(null)} />
        ) : runsState.data.items.length === 0 ? (
          <EmptyState title="No runs yet" description="Place a call from this workflow to see runs here." />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">State</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Started</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {runsState.data.items.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className="cursor-pointer border-b border-border/40 hover:bg-accent/30"
                  >
                    <td className="py-2 font-mono text-xs">{run.name}</td>
                    <td className="py-2">{run.state}</td>
                    <td className="py-2 text-muted-foreground">{run.callType ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">
                      {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 text-right text-xs text-primary">View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between">
              <span className={subduedClass}>
                {runsState.data.items.length} of {runsState.data.total} total
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCursor(null)}
                  disabled={!cursor}
                  className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  ← First
                </button>
                <button
                  type="button"
                  onClick={() => runsState.data.nextCursor && setCursor(runsState.data.nextCursor)}
                  disabled={!runsState.data.nextCursor}
                  className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {selectedRun ? (
        <RunDetailPanel
          companyId={companyId}
          workflowUuid={selectedWorkflow}
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      ) : null}
    </div>
  );
}

function RunDetailPanel({
  companyId,
  workflowUuid,
  run,
  onClose,
}: {
  companyId: string;
  workflowUuid: string;
  run: RunListItem;
  onClose: () => void;
}): ReactNode {
  const [detail, setDetail] = useState<LoadState<RunListItem & { gatheredContext?: Record<string, unknown> | null }>>({
    kind: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    pluginFetch<RunListItem & { gatheredContext?: Record<string, unknown> | null }>(
      pluginUrl(`/runs/${run.id}?workflowUuid=${encodeURIComponent(workflowUuid)}`, companyId),
      controller.signal,
    )
      .then((r) => {
        if (!r.ok) {
          setDetail({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setDetail({ kind: "ready", data: r.data });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId, workflowUuid, run.id]);

  return (
    <section className={cardClass}>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-base font-medium">Run {run.name}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close ✕
        </button>
      </div>
      {detail.kind === "loading" ? (
        <LoadingSkeleton rows={3} />
      ) : detail.kind === "error" ? (
        <ErrorPanel state={detail} />
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">State</dt>
          <dd>{detail.data.state}</dd>
          <dt className="font-medium">Started</dt>
          <dd>{detail.data.createdAt ?? "—"}</dd>
          <dt className="font-medium">Transcript</dt>
          <dd>
            {detail.data.transcriptUrl ? (
              <a className="text-primary hover:underline" href={detail.data.transcriptUrl} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="font-medium">Recording</dt>
          <dd>
            {detail.data.recordingUrl ? (
              <a className="text-primary hover:underline" href={detail.data.recordingUrl} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="font-medium">Cost</dt>
          <dd className="font-mono text-xs">
            {detail.data.costInfo ? JSON.stringify(detail.data.costInfo) : "—"}
          </dd>
          <dt className="font-medium">Extracted</dt>
          <dd className="font-mono text-xs">
            {detail.data.gatheredContext ? JSON.stringify(detail.data.gatheredContext) : "—"}
          </dd>
        </dl>
      )}
    </section>
  );
}

// ---------- Recordings tab ----------

function RecordingsTab({ companyId }: { companyId: string }): ReactNode {
  const [state, setState] = useState<LoadState<PagedResult<RecordingListItem>>>({ kind: "loading" });
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    pluginFetch<PagedResult<RecordingListItem>>(pluginUrl("/recordings?limit=50", companyId), controller.signal)
      .then((r) => {
        if (!r.ok) {
          setState({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setState({ kind: "ready", data: r.data });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId]);

  async function play(recordingId: number) {
    const r = await fetch(pluginUrl(`/recordings/${recordingId}/download-url`, companyId), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return;
    const body = (await r.json().catch(() => ({}))) as { url?: string };
    if (body.url) setPlayingUrl(body.url);
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-2 text-lg font-medium">Recordings</h2>
      {state.kind === "loading" ? (
        <LoadingSkeleton />
      ) : state.kind === "error" ? (
        <ErrorPanel state={state} />
      ) : state.data.items.length === 0 ? (
        <EmptyState title="No recordings yet" description="Recordings appear here after a successful call completes." />
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {state.data.items.map((rec) => (
              <li key={rec.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{rec.name ?? `Recording #${rec.id}`}</span>
                  <span className={subduedClass}>
                    {rec.ttsProvider ?? "unknown"} · {rec.ttsVoiceId ?? "default voice"}
                    {rec.createdAt ? ` · ${new Date(rec.createdAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => play(rec.id)}
                  className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
                >
                  ▶ Play
                </button>
              </li>
            ))}
          </ul>
          {playingUrl ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className={subduedClass}>Now playing</p>
              <audio controls src={playingUrl} autoPlay className="w-full" />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// ---------- Knowledge Base tab ----------

function KnowledgeBaseTab({ companyId }: { companyId: string }): ReactNode {
  const [docsState, setDocsState] = useState<LoadState<PagedResult<KbDocumentSummary>>>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LoadState<KbSearchHit[]>>({ kind: "ready", data: [] });

  useEffect(() => {
    const controller = new AbortController();
    setDocsState({ kind: "loading" });
    pluginFetch<PagedResult<KbDocumentSummary>>(pluginUrl("/kb/documents?limit=50", companyId), controller.signal)
      .then((r) => {
        if (!r.ok) {
          setDocsState({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setDocsState({ kind: "ready", data: r.data });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId]);

  async function runSearch() {
    if (!query.trim()) {
      setHits({ kind: "ready", data: [] });
      return;
    }
    setHits({ kind: "loading" });
    const r = await pluginFetch<{ hits: KbSearchHit[] }>(
      pluginUrl("/kb/search", companyId),
      new AbortController().signal,
      { method: "POST", body: JSON.stringify({ query, limit: 10 }) },
    );
    if (!r.ok) {
      setHits({
        kind: "error",
        message: r.body.message ?? `HTTP ${r.status}`,
        category: categoriseError(r.body, r.status),
      });
      return;
    }
    setHits({ kind: "ready", data: r.data.hits });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={cardClass}>
        <h2 className="mb-2 text-lg font-medium">Search</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder="Search the knowledge base…"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={runSearch}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
        </div>
        {hits.kind === "loading" ? (
          <LoadingSkeleton rows={3} />
        ) : hits.kind === "error" ? (
          <ErrorPanel state={hits} />
        ) : hits.data.length === 0 ? null : (
          <ul className="mt-4 divide-y divide-border/60">
            {hits.data.map((h, i) => (
              <li key={i} className="py-2">
                <p className="text-sm">{h.text}</p>
                <p className={subduedClass}>
                  {h.documentName ?? `Document #${h.documentId}`} · score {h.score.toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="mb-2 text-lg font-medium">Documents</h2>
        {docsState.kind === "loading" ? (
          <LoadingSkeleton />
        ) : docsState.kind === "error" ? (
          <ErrorPanel state={docsState} />
        ) : docsState.data.items.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload knowledge-base documents inside NoralVoice. They appear here once indexed."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {docsState.data.items.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{doc.name}</span>
                  <span className={subduedClass}>
                    {doc.mimeType ?? "unknown"}
                    {doc.sizeBytes ? ` · ${(doc.sizeBytes / 1024).toFixed(1)} kB` : ""}
                    {doc.chunkCount !== undefined ? ` · ${doc.chunkCount} chunks` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- Campaigns tab ----------

function CampaignsTab({ companyId }: { companyId: string }): ReactNode {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [state, setState] = useState<LoadState<PagedResult<CampaignSummary>>>({ kind: "loading" });
  const [selected, setSelected] = useState<CampaignSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    const statusParam = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    pluginFetch<PagedResult<CampaignSummary>>(
      pluginUrl(`/campaigns${statusParam}`, companyId),
      controller.signal,
    )
      .then((r) => {
        if (!r.ok) {
          setState({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setState({ kind: "ready", data: r.data });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [companyId, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <section className={cardClass}>
        <div className="mb-3 flex items-center gap-3">
          <label className="text-sm font-medium" htmlFor="campaign-status">
            Status
          </label>
          <select
            id="campaign-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="running">Running</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {state.kind === "loading" ? (
          <LoadingSkeleton />
        ) : state.kind === "error" ? (
          <ErrorPanel state={state} />
        ) : state.data.items.length === 0 ? (
          <EmptyState title="No campaigns" description="Create a campaign inside NoralVoice to see it here." />
        ) : (
          <ul className="divide-y divide-border/60">
            {state.data.items.map((c) => (
              <li
                key={c.id}
                onClick={() => setSelected(c)}
                className="cursor-pointer flex items-center justify-between py-3 hover:bg-accent/30"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className={subduedClass}>
                    {c.status}
                    {c.totalContacts !== undefined
                      ? ` · ${c.completedCalls ?? 0} / ${c.totalContacts} calls`
                      : ""}
                  </span>
                </div>
                <span className="text-xs text-primary">Details →</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {selected ? (
        <section className={cardClass}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-base font-medium">{selected.name}</h3>
            <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground">
              Close ✕
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-muted/30 p-2 text-xs">
            {JSON.stringify(selected, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

// ---------- Telephony tab ----------

function TelephonyTab({ companyId }: { companyId: string }): ReactNode {
  const [providers, setProviders] = useState<LoadState<TelephonyProviderSummary[]>>({ kind: "loading" });
  const [numbers, setNumbers] = useState<LoadState<PhoneNumberSummary[]>>({ kind: "loading" });

  useEffect(() => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    pluginFetch<{ providers?: TelephonyProviderSummary[] }>(
      pluginUrl("/telephony/providers", companyId),
      c1.signal,
    )
      .then((r) => {
        if (!r.ok) {
          setProviders({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setProviders({ kind: "ready", data: r.data.providers ?? [] });
      })
      .catch(() => undefined);
    pluginFetch<{ numbers?: PhoneNumberSummary[] }>(
      pluginUrl("/telephony/numbers", companyId),
      c2.signal,
    )
      .then((r) => {
        if (!r.ok) {
          setNumbers({
            kind: "error",
            message: r.body.message ?? `HTTP ${r.status}`,
            category: categoriseError(r.body, r.status),
          });
          return;
        }
        setNumbers({ kind: "ready", data: r.data.numbers ?? [] });
      })
      .catch(() => undefined);
    return () => {
      c1.abort();
      c2.abort();
    };
  }, [companyId]);

  return (
    <div className="flex flex-col gap-4">
      <section className={cardClass}>
        <h2 className="mb-2 text-lg font-medium">Phone numbers</h2>
        {numbers.kind === "loading" ? (
          <LoadingSkeleton />
        ) : numbers.kind === "error" ? (
          <ErrorPanel state={numbers} />
        ) : numbers.data.length === 0 ? (
          <EmptyState
            title="No phone numbers"
            description="Provision a number inside NoralVoice → Telephony to wire it up."
            cta={
              <a
                href="https://voice.noral.ai/telephony-configurations"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
              >
                Open NoralVoice telephony ↗
              </a>
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {numbers.data.map((n) => (
              <li key={n.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium font-mono">{n.phoneNumber}</span>
                  <span className={subduedClass}>{n.provider ?? "unknown provider"}</span>
                </div>
                <span className={subduedClass}>{n.isActive ? "active" : "inactive"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="mb-2 text-lg font-medium">Providers</h2>
        {providers.kind === "loading" ? (
          <LoadingSkeleton />
        ) : providers.kind === "error" ? (
          <ErrorPanel state={providers} />
        ) : providers.data.length === 0 ? (
          <EmptyState
            title="No telephony providers"
            description="Configure a Twilio/Telnyx/Vonage account inside NoralVoice."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {providers.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className={subduedClass}>{p.provider}</span>
                </div>
                <span className={subduedClass}>
                  {p.isDefault ? "default · " : ""}
                  {p.isActive ? "active" : "inactive"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- Settings tab ----------

function SettingsTab({ companyPrefix }: { companyPrefix?: string }): ReactNode {
  return (
    <section className={cardClass}>
      <h2 className="mb-2 text-lg font-medium">NoralVoice connection</h2>
      <p className={subduedClass}>
        Your NoralVoice API key, base URL, and organization id are managed under Settings → Integrations.
      </p>
      <a
        href={companyPrefix ? `/${companyPrefix}/company/settings/integrations` : "/company/settings/integrations"}
        className="mt-3 inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        Open Integrations →
      </a>
    </section>
  );
}

// ---------- Main page ----------

export function NoralVoicePage({ context }: PluginPageProps) {
  const [tab, setTab] = useState<TabId>("voice-agents");
  const companyId = context.companyId;
  const companyPrefix = context.companyPrefix ?? undefined;

  const tabs = useMemo(
    () => [
      { id: "voice-agents" as const, label: "Voice Agents" },
      { id: "runs" as const, label: "Runs" },
      { id: "recordings" as const, label: "Recordings" },
      { id: "kb" as const, label: "Knowledge Base" },
      { id: "campaigns" as const, label: "Campaigns" },
      { id: "telephony" as const, label: "Telephony" },
      { id: "settings" as const, label: "Settings" },
    ],
    [],
  );

  if (!companyId) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <section className={cardClass}>
          <p className={subduedClass}>Select a company to view voice settings.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">NoralVoice</h1>
        <p className={subduedClass}>
          Voice-AI workflow runtime. Browse agents, runs, recordings, knowledge base, campaigns,
          telephony, and usage — without leaving NoralOS.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`${tabButtonClass} ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "voice-agents" ? (
        <VoiceAgentsTab companyId={companyId} companyPrefix={companyPrefix} />
      ) : tab === "runs" ? (
        <RunsTab companyId={companyId} />
      ) : tab === "recordings" ? (
        <RecordingsTab companyId={companyId} />
      ) : tab === "kb" ? (
        <KnowledgeBaseTab companyId={companyId} />
      ) : tab === "campaigns" ? (
        <CampaignsTab companyId={companyId} />
      ) : tab === "telephony" ? (
        <TelephonyTab companyId={companyId} />
      ) : (
        <SettingsTab companyPrefix={companyPrefix} />
      )}
    </div>
  );
}
