type AgentCardProps = {
  name: string;
  role?: string | null;
  pinned: boolean;
  speaking: boolean;
  online: boolean;
  onClick: () => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function avatarColor(name: string): string {
  // Cheap stable color per name for the avatar background.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 60% 38%)`;
}

export function AgentCard({
  name,
  role,
  pinned,
  speaking,
  online,
  onClick,
}: AgentCardProps) {
  const base =
    "relative flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all";
  const skin = pinned
    ? "border-orange-500/45 bg-orange-500/5 shadow-[0_0_18px_rgba(255,91,46,0.12)]"
    : speaking
      ? "border-emerald-500/40 bg-emerald-500/5"
      : "border-border bg-transparent hover:bg-accent/40";

  return (
    <button type="button" onClick={onClick} className={`${base} ${skin}`}>
      {pinned ? (
        <span className="absolute right-2 top-1.5 rounded bg-orange-500/15 px-1 py-[1px] text-[8px] font-extrabold tracking-[0.15em] text-orange-500">
          PINNED
        </span>
      ) : null}
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ background: avatarColor(name) }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-foreground">
          {name}
        </span>
        {role ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {role}
          </span>
        ) : null}
      </span>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          online ? "bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-muted"
        }`}
        aria-label={online ? "online" : "offline"}
      />
    </button>
  );
}
