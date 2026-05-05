import { useEffect, useState } from "react";
import { fetchAgents, type AgentSummary } from "../api.js";

type State = {
  agents: AgentSummary[];
  loading: boolean;
  error: string | null;
};

export function useAgents(companyId: string | null): State {
  const [state, setState] = useState<State>({
    agents: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchAgents(companyId)
      .then((agents) => {
        if (cancelled) return;
        setState({ agents, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          agents: [],
          loading: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return state;
}
