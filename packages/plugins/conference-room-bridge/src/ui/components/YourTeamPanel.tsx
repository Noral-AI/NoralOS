import { AgentCard } from "./AgentCard.js";
import type { AgentSummary } from "../api.js";

type YourTeamPanelProps = {
  agents: AgentSummary[];
  pinnedAgentId: string | null;
  speakingAgentId: string | null;
  onPin: (agentId: string) => void;
};

function roleFromMetadata(a: AgentSummary): string | null {
  const m = a.metadata as Record<string, unknown> | null | undefined;
  if (!m) return null;
  const role = m["role"] ?? m["title"] ?? m["jobTitle"];
  return typeof role === "string" ? role : null;
}

export function YourTeamPanel({
  agents,
  pinnedAgentId,
  speakingAgentId,
  onPin,
}: YourTeamPanelProps) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-4">
      <span className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Your Team
      </span>
      {agents.length === 0 ? (
        <span className="px-1 text-xs text-muted-foreground">
          No agents found.
        </span>
      ) : null}
      {agents.map((a) => (
        <AgentCard
          key={a.id}
          name={a.name}
          role={roleFromMetadata(a)}
          pinned={pinnedAgentId === a.id}
          speaking={speakingAgentId === a.id}
          online={a.status !== "terminated" && a.status !== "paused"}
          onClick={() => onPin(a.id)}
        />
      ))}
    </aside>
  );
}
