import { useEffect, useState } from "react";
import { conferenceApi, type UiState } from "../api.js";

type State = {
  data: UiState | null;
  loading: boolean;
  error: string | null;
};

export function useUiState(companyId: string | null): State {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    conferenceApi
      .state(companyId)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            data: null,
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
