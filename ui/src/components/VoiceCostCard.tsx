/**
 * VoiceCostCard — read-through view of NoralVoice's current-period
 * usage, rendered on the Costs page.
 *
 * Phase 4 PR-B: voice cost is NOT written into NoralOS's `cost_events`
 * table — that table is for NoralOS-billed events. Voice cost is
 * displayed via live read-through against the noralai.noralvoice
 * plugin's apiRoute (which proxies to NoralVoice's
 * `/api/v1/organizations/usage/current-period`).
 *
 * Three render states:
 *   - loading
 *   - no integration configured (HTTP 400 + body.error === "NO_API_KEY")
 *   - ready: total + optional per-workflow breakdown + deep-link to
 *     NV's `/usage` page
 *
 * The current-period endpoint doesn't accept a time-window filter
 * today; per the Phase 4 spec we clamp to the current period and
 * render a hint when the Costs page's selected window doesn't match.
 */

import { useEffect, useState } from "react";

import { formatCents } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PLUGIN_ID = "noralai.noralvoice";

interface VoiceUsage {
  totalCostCents: number;
  callDurationSec?: number;
  callCount?: number;
  periodStart?: string;
  periodEnd?: string;
  perWorkflow?: Array<{
    workflowId?: number;
    workflowUuid?: string;
    workflowName?: string;
    costCents: number;
    callCount?: number;
  }>;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "no-integration" }
  | { kind: "ready"; data: VoiceUsage }
  | { kind: "error"; message: string };

export interface VoiceCostCardProps {
  companyId: string;
  /** Show per-workflow breakdown when there are multiple workflows. */
  showBreakdown?: boolean;
  /** Optional — when set, we display a hint if NoralVoice's
   *  current-period window doesn't match the page's selection. */
  windowFrom?: string;
  windowTo?: string;
}

export function VoiceCostCard({
  companyId,
  showBreakdown = true,
  windowFrom,
  windowTo,
}: VoiceCostCardProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    const url =
      `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api/usage/current-period` +
      `?companyId=${encodeURIComponent(companyId)}`;
    fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (resp) => {
        const body = (await resp.json().catch(() => ({}))) as VoiceUsage & {
          ok?: false;
          error?: string;
          message?: string;
        };
        if (controller.signal.aborted) return;
        if (resp.status === 400 && body.error === "NO_API_KEY") {
          setState({ kind: "no-integration" });
          return;
        }
        if (!resp.ok) {
          setState({ kind: "error", message: body.message ?? `HTTP ${resp.status}` });
          return;
        }
        setState({ kind: "ready", data: body });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if ((err as Error).name === "AbortError") return;
        setState({ kind: "error", message: "Could not reach NoralVoice" });
      });
    return () => controller.abort();
  }, [companyId]);

  const showWindowHint =
    state.kind === "ready" &&
    Boolean(windowFrom || windowTo) &&
    (!state.data.periodStart || !state.data.periodEnd);

  return (
    <Card>
      <CardHeader className="px-5 pt-5 pb-2 flex flex-row items-baseline justify-between">
        <div>
          <CardTitle className="text-base">Voice (NoralVoice)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Current-period voice spend read live from voice.noral.ai.
          </p>
        </div>
        <a
          href="https://voice.noral.ai/usage"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary hover:underline"
        >
          View in NoralVoice ↗
        </a>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5 pt-2">
        {state.kind === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : state.kind === "no-integration" ? (
          <p className="text-sm text-muted-foreground">
            NoralVoice isn't connected for this company. Add a credential under{" "}
            <a href="/company/settings/integrations" className="text-primary hover:underline">
              Settings → Integrations
            </a>{" "}
            to see voice spend here.
          </p>
        ) : state.kind === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : (
          <>
            <div className="text-3xl font-semibold tabular-nums">
              {formatCents(state.data.totalCostCents)}
            </div>
            <div className="text-sm text-muted-foreground">
              {state.data.callCount !== undefined ? `${state.data.callCount} calls` : "—"}
              {state.data.callDurationSec
                ? ` · ${Math.round(state.data.callDurationSec / 60)} min`
                : ""}
              {state.data.periodStart && state.data.periodEnd
                ? ` · ${new Date(state.data.periodStart).toLocaleDateString()} → ${new Date(state.data.periodEnd).toLocaleDateString()}`
                : ""}
            </div>
            {showWindowHint ? (
              <p className="text-xs text-muted-foreground">
                NoralVoice's usage endpoint reports the current billing period only — the date
                range above is fixed.
              </p>
            ) : null}
            {showBreakdown && state.data.perWorkflow && state.data.perWorkflow.length > 0 ? (
              <ul className="divide-y divide-border/60 text-sm">
                {state.data.perWorkflow.map((w) => (
                  <li
                    key={w.workflowUuid ?? String(w.workflowId)}
                    className="flex items-center justify-between py-2"
                  >
                    <span>{w.workflowName ?? `Workflow #${w.workflowId ?? "?"}`}</span>
                    <span className="font-mono">
                      {formatCents(w.costCents)}
                      {w.callCount !== undefined ? ` · ${w.callCount} calls` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
