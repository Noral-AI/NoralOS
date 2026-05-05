export type Mode = "direct" | "auto";

type ModeToggleProps = {
  mode: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
};

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="inline-flex gap-1 rounded-lg bg-muted p-[3px]">
        <ModeBtn
          active={mode === "direct"}
          disabled={disabled}
          label="Direct"
          onClick={() => onChange("direct")}
        />
        <ModeBtn
          active={mode === "auto"}
          disabled={disabled}
          label="Hand Up"
          onClick={() => onChange("auto")}
        />
      </div>
      <span className="text-[11px] leading-tight text-muted-foreground">
        {mode === "auto"
          ? "Hand Up: the team listens, the best fit answers."
          : "Direct: talk to the pinned agent."}
      </span>
    </div>
  );
}

function ModeBtn({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  const base =
    "rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition";
  const skin = active
    ? "bg-amber-500/15 text-amber-600 shadow-[0_0_10px_rgba(251,191,36,0.1)] dark:text-amber-400"
    : "text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${skin} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
