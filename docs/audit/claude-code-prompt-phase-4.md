You are executing **Phase 4** of the NoralOS ↔ NoralVoice consolidation. NoralOS-only, split into two PRs (PR-A lands first, PR-B depends on PR-A).

## Binding context (read in this order)

```
docs/audit/
  consolidation-scope.md       ← binding scope, see §2 Pillar A (browse) + Pillar B item 2 (live transcript stream)
  consolidation-plan.md        ← Phase 4 section
  integration-architecture.md  ← §6 surface-by-surface routing
  overlap-map.md               ← §A4 Pipecat, §G1 cost tracking
```

Also read:
- `CLAUDE.md`
- `packages/plugins/noralai-noralvoice/` — your plugin from Phase 1/2/3
- `ui/src/pages/Costs.tsx` — the Costs page you're extending in PR-B

## Repo / branching

- Repo: `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`
- Base branch: `master`
- PR-A working branch: `feat/phase-4a-noralvoice-browse-surfaces`
- PR-B working branch: `feat/phase-4b-noralvoice-interact-surfaces` (branched from PR-A's merge commit)

## Goal

After this phase, the NoralOS plugin page is a real consumption surface — not just a configure-me state. Board users browse voice agents, runs, recordings, KB, campaigns, telephony, and costs without leaving NoralOS. Deep editors (workflow builder) open as an iframed modal authenticated via Phase 1's exchange-token. Live call transcripts stream into the Voice Director's session in real time. The Costs page shows merged voice + non-voice spend.

---

## PR-A — Browse surfaces

### A1. Plugin apiRoutes

Add to the manifest's `apiRoutes` and implement each handler. All board auth, company-resolved from `?companyId=<uuid>`:

| Route key | HTTP | Path | Backed by NoralVoice |
|---|---|---|---|
| `list_runs` | GET | `/runs?workflowUuid=&limit=&cursor=` | `/workflows/<uuid>/runs` |
| `get_run` | GET | `/runs/:runId?workflowUuid=` | `/workflows/<uuid>/runs/<runId>` |
| `list_recordings` | GET | `/recordings?limit=&cursor=` | `/workflow-recordings` |
| `get_recording_url` | GET | `/recordings/:id/download-url` | `/workflow-recordings/<id>/download-url` |
| `search_kb` | POST | `/kb/search` body `{ query, limit }` | `/knowledge-base/search` |
| `list_kb_documents` | GET | `/kb/documents?limit=&cursor=` | `/knowledge-base/documents` |
| `list_campaigns` | GET | `/campaigns?status=&limit=&cursor=` | `/campaigns` |
| `get_campaign` | GET | `/campaigns/:id` | `/campaigns/<id>` |
| `list_telephony_numbers` | GET | `/telephony/numbers` | `/telephony-phone-numbers` |
| `list_telephony_providers` | GET | `/telephony/providers` | `/organizations/telephony-configurations` |
| `get_usage_current` | GET | `/usage/current-period` | `/organizations/usage/current-period` |

For each:
- Input validation
- Pagination passthrough where applicable (cursor in/out, limit clamped 1–100)
- Error mapping: NV 4xx → `{ ok: false, error: "NORALVOICE_4XX", status, message }`; NV 5xx → `{ ok: false, error: "NORALVOICE_5XX", message }`
- Test coverage: happy path, no API key, wrong company, NV unreachable, pagination

Find the exact NV endpoint shapes by grepping `api/routes/` in `/Users/quentin/Documents/NORALAI/NoralVoice`. Some paths may differ slightly from the table above; pick the actual endpoint, not the assumed one. If an endpoint doesn't exist, stop and report — do not extend NV in this phase.

### A2. Plugin page tabs

`src/ui/NoralVoicePage.tsx` becomes a tabbed layout. Tabs:

- **Voice Agents** — existing State A/B/C from Phase 1; below the Voice Director list, add a workflow list sourced from `noralvoice:list_workflows`
- **Runs** — paginated table from `list_runs`; row click opens a side-panel detail (data via `get_run`) with transcript URL, recording URL, extracted variables, cost info, status timeline
- **Recordings** — table from `list_recordings`; play button uses `get_recording_url` to get a presigned URL then plays in-page via `<audio>`
- **Knowledge Base** — search input → `search_kb`; below, list documents from `list_kb_documents` with metadata
- **Campaigns** — list from `list_campaigns` filtered by status; detail drawer via `get_campaign`
- **Telephony** — read-only: numbers from `list_telephony_numbers`, providers from `list_telephony_providers`. Write actions deep-link to NoralVoice's `/telephony-configurations` (until Phase 7 adds writes)
- **Settings** — existing "configure your NoralVoice connection" state from Phase 1

Each tab:
- Uses `@tanstack/react-query` against the plugin apiRoutes
- Has an empty state with "what is this" microcopy + a primary CTA where applicable
- Has loading skeletons matching other NoralOS list pages
- Renders error states that explicitly say "Couldn't reach NoralVoice" vs "Your NoralVoice key is missing/invalid" vs "NoralVoice returned an error"

Use existing `shadcn/ui` primitives. Match the visual rhythm of `ui/src/pages/Agents.tsx` and `ui/src/pages/Issues.tsx`.

### A3. PR-A smoke

- [ ] All seven tabs render without error against a NoralVoice org that has at least 1 workflow, 1 run, 1 recording, 1 KB doc, 1 campaign, 1 phone number
- [ ] Switching companies in the company switcher refreshes each tab's data
- [ ] Pagination works on Runs and Recordings (forward and back via cursor)
- [ ] Recording play button produces audible playback in the browser
- [ ] KB search returns ranked results
- [ ] Error states render cleanly when (a) API key is missing, (b) NoralVoice is unreachable (mock 502), (c) NoralVoice returns 4xx
- [ ] Standalone NoralVoice smoke passes (no NV changes in PR-A)

### PR-A meta

- Title: `feat(phase-4a): noralvoice plugin browse surfaces (runs, recordings, KB, campaigns, telephony)`
- Commits per logical group: apiRoutes (one commit per ~3 routes), page tab scaffold, individual tab implementations, tests
- PR body includes A3 smoke results

---

## PR-B — Interact surfaces

Depends on PR-A merged.

### B1. Iframed workflow builder

User flow:
1. On the Voice Agents tab, each workflow row has an "Open builder" button
2. Click → plugin apiRoute `POST /workflows/:uuid/embed-token` requests a one-shot token from NV
3. Plugin worker calls NV `POST /api/v1/embed/exchange-token` (built in Phase 1 PR-A) with `target_user_email` = current NoralOS user email, `target_path` = `/workflow/<uuid>`
4. Returned `embed_url` is opened inside a `<NoralVoiceBuilderModal>` (full-screen NoralOS modal with iframe)
5. Iframe `src` = embed URL

Modal component `src/ui/NoralVoiceBuilderModal.tsx`:
- Renders the iframe with sandbox attributes appropriate for trusted same-org content (`allow-scripts allow-same-origin allow-forms allow-popups`)
- Listens for postMessage events from the iframe (origin-checked against the configured NV base URL)
- Posts theme tokens to the iframe on `noralvoice:ready` (resolved theme: dark/light flag + a small set of CSS color tokens NV can use)
- Intercepts close attempts if iframe has posted `noralvoice:unsaved-changes: true` — shows a confirmation
- Listens for `noralvoice:saved` and triggers a workflow-list refetch on the parent

postMessage protocol (parent ↔ child):
| Direction | Event | Payload |
|---|---|---|
| child → parent | `noralvoice:ready` | `{ }` |
| parent → child | `noralvoice:theme` | `{ mode: "dark"|"light", tokens: {...} }` |
| child → parent | `noralvoice:unsaved-changes` | `{ hasUnsaved: boolean }` |
| child → parent | `noralvoice:saved` | `{ workflowUuid }` |
| child → parent | `noralvoice:request-close` | `{ }` |

Feature flag: `enableEmbeddedVoiceBuilder` (read via the plugin's feature-flag service or a per-instance config field). Default off in production until smoke is green; on in dev.

If NV's `/workflow/<uuid>` page sets `X-Frame-Options: DENY` or a restrictive CSP `frame-ancestors`, stop and report — this needs a Phase 1 follow-up to allow `agent.noral.ai` as a permitted ancestor. Do not bypass; do not extend NV unilaterally.

### B2. Live transcript stream

When a Voice Director agent places a call via `noralvoice:run_call` and the originating task session is still active:

1. Plugin worker starts a transcript-pump worker keyed by `(companyId, runId)`
2. Pump opens `WS <noralvoice_base>/api/v1/agent-stream/<workflow_uuid>?api_key=<resolved>` (auth gate built in Phase 0)
3. For each inbound `transcript_chunk` message: `ctx.session.append(callerAgentId, { type: "transcript_chunk", text, speaker, timestamp })`
4. For each `extracted_variable` event: `ctx.session.append(callerAgentId, { type: "extracted_variable", key, value })`
5. On run terminal status (already fed via the Phase 1 webhook): close the WS

Implementation: `src/server/transcript-pump.ts`
- One pump per active run; managed in an in-memory `Map<runId, Pump>`
- Reconnect on disconnect with exponential backoff (start 1s, cap 30s, max 5 attempts)
- Circuit-breaker: if a company sees >10 connection failures in 5 minutes, pause pumps for that company for 15 minutes and emit an `activity-log` warning
- On plugin shutdown: gracefully close all pumps

Feature flag: `enableLiveTranscriptStream` (default off in production; flip on after measuring NV WS load on a smoke run).

### B3. Costs page merge

`ui/src/pages/Costs.tsx`:
- Add a new top-level row "Voice (NoralVoice)" alongside existing per-adapter rows
- Source: plugin apiRoute `get_usage_current` (from PR-A A1)
- Use the existing time-window selector — pass the selected window to the plugin apiRoute (clamp to current period if window predates the company's NV integration)
- Aggregate the NV cost into the total displayed at the top of the page
- The Voice row, when clicked, opens a side-panel with per-workflow breakdown (sourced from `get_usage_current`'s detail field; if NV's endpoint doesn't return per-workflow, just show the aggregate)
- Add a "View in NoralVoice" deep-link that opens NV's `/usage` page in a new tab

Do NOT write voice cost rows into the local `cost_events` table — that table is for NoralOS-billed events. Voice cost is displayed via live read-through, not duplicated.

### B4. Lifecycle wiring

Phase 1's plugin webhook receiver (`run-completed`) emits `noralai.noralvoice.run.completed` on the event bus. PR-B's transcript pump runs *during* the call; the webhook fires *after*. Both produce session events on the originating agent — verify there's no duplicate-event problem:
- Transcript pump emits `transcript_chunk` / `extracted_variable` events
- Webhook receiver emits `run.completed` event with final summary

If a duplicate concern emerges (e.g., the webhook payload's `extracted_variables` overlap with the stream's), de-duplicate by tracking last-seen `extracted_variable` keys in the pump and only emitting from the webhook the keys the pump didn't see.

### B5. PR-B smoke

- [ ] "Open builder" on a workflow opens the modal; iframe loads NV's React-Flow editor authenticated
- [ ] Theme tokens pass through; iframe content renders with NoralOS theme tokens (or NV's matching theme if tokens are translated)
- [ ] Editing + saving a workflow inside the iframe triggers parent refetch of the workflow list
- [ ] Modal close attempt with unsaved changes shows confirmation
- [ ] A test outbound call placed via `noralvoice:run_call` streams transcript chunks into the Voice Director's session in real time (verify via Conference Room or session-log viewer)
- [ ] Run completion webhook still fires and wakes the originating agent
- [ ] Voice Director can ask follow-up questions about the call ("what did the customer say about pricing?") and answer from the streamed transcript
- [ ] Costs page shows the Voice row with a non-zero value when the time window covers a completed call
- [ ] Feature flags `enableEmbeddedVoiceBuilder` and `enableLiveTranscriptStream` cleanly disable both surfaces
- [ ] Standalone NoralVoice smoke passes

### PR-B meta

- Title: `feat(phase-4b): iframed builder + live transcript stream + Costs merge`
- Commits: B1 modal + apiRoute, B2 transcript pump, B3 Costs, B4 dedup, tests, smoke
- PR body includes B5 smoke results and recommended production defaults for both feature flags

---

## Anti-goals (both PRs)

- Do NOT change NoralVoice. All NV endpoints needed (exchange-token, agent-stream auth, integration webhooks) exist from earlier phases
- Do NOT add write tools for campaigns / telephony / KB upload — Phase 7
- Do NOT build a native (non-iframed) workflow editor in NoralOS — Phase 4 commits to the iframe
- Do NOT fold `conference-room-bridge` here — Phase 6
- Do NOT write voice cost data into NoralOS's `cost_events` — read-through only
- Do NOT duplicate the company switcher's auth into NV. The plugin worker is the only place that holds the NV API key; the browser never touches it

## Stop and report if

- NV's `/workflow/<uuid>` page rejects iframing (X-Frame-Options, CSP `frame-ancestors`) — this is a Phase 1 follow-up; do not bypass
- The exchange-token endpoint from Phase 1 doesn't return a useful embed URL — flag for Phase 1 follow-up
- Live transcript WS turns out to require a different message shape than the auth-gate work in Phase 0 implied — surface and propose minimal change
- Costs aggregation requires non-trivial NV endpoint changes (e.g., the existing `/usage/current-period` doesn't accept a time window) — flag and stop; do not extend NV in Phase 4
- The plugin worker turns out to not support long-lived WS subscriptions (it might be a request/response-only worker) — surface the architectural gap and propose either an extension or moving the pump out of the plugin worker into a dedicated server-side process

## When you finish (both PRs)

Reply with:
1. PR-A and PR-B URLs and merge statuses
2. A3 + B5 smoke results
3. Recommended production defaults for `enableEmbeddedVoiceBuilder` and `enableLiveTranscriptStream`
4. Anything punted to Phase 5 (likely: the `noralos://` reverse-tool scheme and NV UI brand purge)
5. Anything that surfaced as a new issue worth noting (especially around plugin-worker WS lifecycle or iframe theming)

Do not start Phase 5. Wait for the next prompt.
