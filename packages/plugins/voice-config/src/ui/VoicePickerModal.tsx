import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  listVoices,
  previewVoice,
  type ListVoicesResponse,
  type PreviewResponse,
  type VoicePickerProvider,
  type VoicePickerVoice,
} from "./voiceCascadeClient.js";

export type VoicePickerSelection = {
  provider: VoicePickerProvider;
  voiceId: string;
  displayName: string;
};

type Props = {
  companyId: string;
  initialProvider?: VoicePickerProvider;
  open: boolean;
  onClose: () => void;
  onSelect: (selection: VoicePickerSelection) => void;
};

const PROVIDER_LABELS: Record<VoicePickerProvider, string> = {
  google_tts: "Google Cloud TTS",
  elevenlabs: "ElevenLabs",
};

const DEFAULT_LANGUAGE = "en-US";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function VoicePickerModal(props: Props) {
  const { companyId, open, onClose, onSelect } = props;
  const [provider, setProvider] = useState<VoicePickerProvider>(
    props.initialProvider ?? "google_tts",
  );
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [search, setSearch] = useState<string>("");
  const [state, setState] = useState<{
    [k in VoicePickerProvider]?: Exclude<ProviderState, undefined>;
  }>({});
  const [previewBusy, setPreviewBusy] = useState<string | null>(null); // voiceId
  const [previewError, setPreviewError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // ---- audio teardown helpers ----
  const tearDownAudio = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  // ---- fetch lifecycle ----
  const loadProvider = useCallback(
    async (p: VoicePickerProvider) => {
      setState((prev) => ({ ...prev, [p]: { loading: true } }));
      try {
        const resp = await listVoices({
          companyId,
          provider: p,
          languageCode: p === "google_tts" ? (language || DEFAULT_LANGUAGE) : null,
        });
        setState((prev) => ({ ...prev, [p]: resp }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          [p]: { error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [companyId, language],
  );

  // Open: load the selected provider for the first time. Closing: free audio.
  useEffect(() => {
    if (!open) {
      tearDownAudio();
      setPreviewBusy(null);
      setPreviewError(null);
      return;
    }
    const cur = state[provider];
    if (!cur) {
      void loadProvider(provider);
    }
  }, [open, provider, state, loadProvider, tearDownAudio]);

  // Re-fetch google_tts when language changes (server-side filter).
  useEffect(() => {
    if (!open) return;
    if (provider !== "google_tts") return;
    void loadProvider("google_tts");
    // language is intentionally the only dep — provider is captured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Cleanup on unmount.
  useEffect(() => () => tearDownAudio(), [tearDownAudio]);

  // ---- preview ----
  const handlePreview = useCallback(
    async (voice: VoicePickerVoice) => {
      tearDownAudio();
      setPreviewBusy(voice.voiceId);
      setPreviewError(null);
      try {
        const resp: PreviewResponse = await previewVoice({
          companyId,
          provider: voice.provider,
          voiceId: voice.voiceId,
        });
        if (!resp.ok) {
          setPreviewError(humanPreviewError(resp.reason, resp.message));
          return;
        }
        const bytes = decodeBase64(resp.audioBase64);
        const blob = new Blob([bytes as unknown as BlobPart], {
          type: resp.mimeType,
        });
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = () => {
          /* leave URL — tearDownAudio revokes */
        };
        await audio.play();
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewBusy(null);
      }
    },
    [companyId, tearDownAudio],
  );

  // ---- derive list view ----
  const cur = state[provider];
  const filtered = useMemo<VoicePickerVoice[]>(() => {
    if (!cur || "loading" in cur || "error" in cur || !cur.ok) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return cur.voices;
    return cur.voices.filter((v) => {
      const hay = [v.displayName, v.voiceId, v.style ?? "", v.gender ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [cur, search]);

  // ttsMode is present on both branches of ListVoicesResponse, absent on the
  // local loading/error sentinels.
  const ttsMode = cur && "ttsMode" in cur ? cur.ttsMode : null;

  // Languages available in the current Google list, used to populate the
  // language dropdown without hard-coding. ElevenLabs voices rarely declare
  // language, so when on the ElevenLabs tab we hide the dropdown.
  const languageOptions = useMemo<string[]>(() => {
    if (!cur || "loading" in cur || "error" in cur || !cur.ok) {
      return [DEFAULT_LANGUAGE, "all"];
    }
    const set = new Set<string>([DEFAULT_LANGUAGE, "all"]);
    for (const v of cur.voices) for (const lc of v.languageCodes) set.add(lc);
    return Array.from(set).sort();
  }, [cur]);

  if (!open) return null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Choose a voice">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Choose a voice</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={closeBtnStyle}>
            ×
          </button>
        </header>

        <div style={tabsStyle}>
          {(["google_tts", "elevenlabs"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              style={provider === p ? activeTabStyle : tabStyle}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>

        <div style={controlsStyle}>
          {provider === "google_tts" && (
            <label style={controlLabelStyle}>
              Language{" "}
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={selectStyle}
              >
                {languageOptions.map((lc) => (
                  <option key={lc} value={lc}>
                    {lc === "all" ? "All languages" : lc}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input
            type="search"
            placeholder="Search by name, id, style…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchStyle}
          />
        </div>

        <div style={listContainerStyle}>
          {renderListBody({
            cur,
            filtered,
            provider,
            previewBusy,
            onRetry: () => void loadProvider(provider),
            onPreview: handlePreview,
            onSelect,
          })}
        </div>

        {previewError && (
          <div style={previewErrorStyle}>Preview failed: {previewError}</div>
        )}

        {ttsMode === "dry_run" && (
          <div style={dryRunBannerStyle}>
            voice-cascade is in <strong>dry_run</strong>. Previews still play normally,
            but selecting a voice here does not enable live audio in Conference Room
            or other surfaces — an admin must flip ttsMode separately.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type ProviderState =
  | undefined
  | { loading: true }
  | { error: string }
  | ListVoicesResponse;

function renderListBody(args: {
  cur: ProviderState;
  filtered: VoicePickerVoice[];
  provider: VoicePickerProvider;
  previewBusy: string | null;
  onRetry: () => void;
  onPreview: (v: VoicePickerVoice) => Promise<void> | void;
  onSelect: (sel: VoicePickerSelection) => void;
}) {
  const { cur, filtered, provider, previewBusy, onRetry, onPreview, onSelect } = args;

  if (!cur) return <div style={mutedRowStyle}>Loading voices…</div>;
  if ("loading" in cur) return <div style={mutedRowStyle}>Loading voices…</div>;
  if ("error" in cur) return <ErrorPanel message={cur.error} onRetry={onRetry} />;
  if (!cur.ok) {
    return (
      <ProviderErrorPanel
        provider={provider}
        reason={cur.reason}
        message={cur.message}
        onRetry={onRetry}
      />
    );
  }
  if (filtered.length === 0) {
    return <div style={mutedRowStyle}>No voices match the current filters.</div>;
  }
  return (
    <>
      {filtered.map((v) => (
        <VoiceRow
          key={v.voiceId}
          voice={v}
          previewing={previewBusy === v.voiceId}
          disabled={previewBusy !== null && previewBusy !== v.voiceId}
          onPreview={() => void onPreview(v)}
          onSelect={() =>
            onSelect({
              provider: v.provider,
              voiceId: v.voiceId,
              displayName: v.displayName,
            })
          }
        />
      ))}
    </>
  );
}

function VoiceRow(props: {
  voice: VoicePickerVoice;
  previewing: boolean;
  disabled: boolean;
  onPreview: () => void;
  onSelect: () => void;
}) {
  const { voice, previewing, disabled, onPreview, onSelect } = props;
  const langLabel =
    voice.languageCodes.length === 0
      ? "multi"
      : voice.languageCodes.length === 1
        ? voice.languageCodes[0]
        : `${voice.languageCodes[0]} +${voice.languageCodes.length - 1}`;
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
          {voice.displayName}
        </div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {[voice.gender, voice.style, langLabel].filter(Boolean).join(" · ")}
          {voice.displayName !== voice.voiceId ? ` · ${voice.voiceId}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onPreview}
        disabled={disabled}
        style={btnStyle}
        aria-label={`Preview ${voice.displayName}`}
      >
        {previewing ? "Playing…" : "▶ Preview"}
      </button>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        style={primaryBtnStyle}
      >
        Select
      </button>
    </div>
  );
}

function ProviderErrorPanel(props: {
  provider: VoicePickerProvider;
  reason: string;
  message: string;
  onRetry: () => void;
}) {
  const { provider, reason, message, onRetry } = props;
  if (reason === "provider-key-missing") {
    return (
      <div style={infoPanelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {provider === "google_tts"
            ? "Google Cloud TTS key is not configured yet."
            : "ElevenLabs key is not configured yet."}
        </div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          An admin needs to add the provider key to the voice-cascade plugin
          before voices for this provider can be listed or previewed.
        </div>
      </div>
    );
  }
  return (
    <div style={infoPanelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Could not load voices ({reason}).
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{message}</div>
      <button type="button" onClick={onRetry} style={btnStyle}>
        Retry
      </button>
    </div>
  );
}

function ErrorPanel(props: { message: string; onRetry: () => void }) {
  return (
    <div style={infoPanelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Network error</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{props.message}</div>
      <button type="button" onClick={props.onRetry} style={btnStyle}>
        Retry
      </button>
    </div>
  );
}

function humanPreviewError(reason: string, message: string): string {
  switch (reason) {
    case "provider-key-missing":
      return "Provider key is not configured yet.";
    case "dry-run":
      return "voice-cascade is in dry_run; preview synthesis is disabled.";
    case "provider-rate-limited":
      return "Provider rate limit reached — try again in a moment.";
    case "exfiltration-blocked":
      return "Preview text blocked by exfiltration guard.";
    default:
      return message;
  }
}

// ---------------------------------------------------------------------------
// Inline styles (kept self-contained — voice-config doesn't ship a CSS bundle)
// ---------------------------------------------------------------------------

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: CSSProperties = {
  width: "min(720px, 90vw)",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--noralos-modal-bg, #1f1f1f)",
  color: "var(--noralos-modal-fg, #f5f5f5)",
  borderRadius: 8,
  boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
};

const closeBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "inherit",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

const tabsStyle: CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "8px 16px 0",
};

const tabStyle: CSSProperties = {
  background: "transparent",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 13,
};

const activeTabStyle: CSSProperties = {
  ...tabStyle,
  background: "rgba(255,255,255,0.12)",
  borderColor: "rgba(255,255,255,0.4)",
};

const controlsStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "10px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const controlLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
};

const selectStyle: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "4px 6px",
};

const searchStyle: CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
};

const listContainerStyle: CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "4px 16px 8px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const btnStyle: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const primaryBtnStyle: CSSProperties = {
  ...btnStyle,
  background: "rgba(80, 130, 230, 0.6)",
  borderColor: "rgba(80, 130, 230, 0.9)",
  fontWeight: 600,
};

const mutedRowStyle: CSSProperties = {
  padding: 24,
  textAlign: "center",
  opacity: 0.6,
  fontSize: 13,
};

const infoPanelStyle: CSSProperties = {
  margin: 16,
  padding: 16,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
};

const previewErrorStyle: CSSProperties = {
  padding: "8px 16px",
  background: "rgba(220, 80, 80, 0.15)",
  borderTop: "1px solid rgba(220, 80, 80, 0.4)",
  color: "#ffb3b3",
  fontSize: 12,
};

const dryRunBannerStyle: CSSProperties = {
  padding: "8px 16px",
  background: "rgba(220, 180, 80, 0.12)",
  borderTop: "1px solid rgba(220, 180, 80, 0.4)",
  fontSize: 12,
};

export default VoicePickerModal;
