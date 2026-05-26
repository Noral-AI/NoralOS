/**
 * NoralSign templates dashboard page.
 *
 * Phase-1C surface: lists the company's NoralSign templates by calling
 * the plugin's scoped `GET /api/plugins/noralai.noralsign/api/templates`
 * route (which the worker delegates to DocuSeal under the hood).
 *
 * Intentionally minimal — submissions inbox, signed-doc archive, and
 * template editor land in milestone 1D/1E. The "Send a contract" button
 * here is a placeholder that points the user at the agent UX (Slack)
 * until the dashboard-side send flow ships.
 */

import { useEffect, useState } from "react";
import type { PluginPageProps } from "@noralos/plugin-sdk/ui";

import { PLUGIN_ID } from "../constants.js";

interface TemplateSummary {
  id: number;
  name: string;
  updatedAt: string;
  fieldCount: number;
}

interface ApiResponse {
  templates: TemplateSummary[];
  error?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; templates: TemplateSummary[] }
  | { kind: "error"; message: string };

const cardClass = "rounded-lg border border-border/60 bg-card p-4 shadow-sm";
const headingClass = "text-2xl font-semibold tracking-tight";
const subduedClass = "text-sm text-muted-foreground";

function formatUpdatedAt(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function NoralSignTemplatesPage({ context }: PluginPageProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const companyId = context.companyId;

  useEffect(() => {
    if (!companyId) {
      // No active company yet (rare — the page is rendered behind a
      // companyPrefix route). Wait rather than hit the API and 400.
      setState({ kind: "loading" });
      return;
    }
    let cancelled = false;
    const url = `/api/plugins/${encodeURIComponent(PLUGIN_ID)}/api/templates?limit=100&companyId=${encodeURIComponent(companyId)}`;
    fetch(url, { credentials: "include", headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ApiResponse;
        if (cancelled) return;
        if (!response.ok) {
          setState({
            kind: "error",
            message:
              body.error ?? `NoralSign returned HTTP ${response.status} when listing templates.`,
          });
          return;
        }
        setState({ kind: "ready", templates: body.templates ?? [] });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: "error", message: "Could not reach the NoralSign API." });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className={headingClass}>NoralSign</h1>
        <p className={subduedClass}>
          Document e-signing for NoralOS. Templates managed here are also available to executive-tier
          agents via the contract-routing flow (e.g. via Slack).
        </p>
      </header>

      <section className={cardClass} aria-busy={state.kind === "loading"}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Templates</h2>
          {state.kind === "ready" ? (
            <span className={subduedClass}>{state.templates.length} total</span>
          ) : null}
        </div>

        {state.kind === "loading" ? (
          <p className={subduedClass}>Loading templates…</p>
        ) : state.kind === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : state.templates.length === 0 ? (
          <p className={subduedClass}>
            No templates yet. Add a template in DocuSeal admin (the bundled
            NoralSign engine) and it will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {state.templates.map((template) => (
              <li key={template.id} className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{template.name}</span>
                  <span className={subduedClass}>
                    {template.fieldCount} field{template.fieldCount === 1 ? "" : "s"} ·
                    {" "}updated {formatUpdatedAt(template.updatedAt)}
                  </span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  #{template.id}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${cardClass} text-sm`}>
        <h2 className="mb-2 text-base font-medium">Sending contracts</h2>
        <p className={subduedClass}>
          Today, sales contracts are sent through the agent flow — message an
          executive-tier agent (CEO/CTO/CMO/CFO) in Slack or Conference Room
          and say "send Acme an MSA". The agent confirms the template, signers,
          and key terms before dispatching the envelope. The dashboard-side
          send form lands in a follow-up release.
        </p>
      </section>
    </div>
  );
}
