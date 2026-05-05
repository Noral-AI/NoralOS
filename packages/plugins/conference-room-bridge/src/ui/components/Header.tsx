type HeaderProps = {
  ttsMode: string | null;
};

export function Header({ ttsMode }: HeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-bold tracking-tight">
          noralAI<span className="text-orange-500">.</span>
        </span>
        <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Conference Room
        </span>
      </div>
      <div className="flex items-center gap-3">
        {ttsMode === "dry_run" ? (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
            title="voice-cascade is in dry-run mode — agent replies are shown as text only, no audio"
          >
            Audio: dry-run (text only)
          </span>
        ) : null}
      </div>
    </div>
  );
}
