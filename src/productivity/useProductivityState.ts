import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  PRODUCTIVITY_EVENTS,
  getProductivityState,
  normalizeProductivityState,
  type ProductivityState,
} from "../lib/productivity";
import { userFacingError } from "../lib/user-facing-errors";

export interface ProductivityHook {
  state: ProductivityState | null;
  loading: boolean;
  feedback: string;
  setFeedback: (value: string) => void;
  refresh: () => Promise<void>;
  applyState: (value: unknown) => void;
}

export function useProductivityState(): ProductivityHook {
  const [state, setState] = useState<ProductivityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const applyState = useCallback((value: unknown) => {
    setState(normalizeProductivityState(value));
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyState(await getProductivityState());
    } catch (err) {
      setLoading(false);
      setFeedback(userFacingError(err, "Nao foi possivel carregar os dados locais."));
    }
  }, [applyState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let unlistenState: (() => void) | null = null;
    (async () => {
      unlistenState = await listen<ProductivityState>(
        PRODUCTIVITY_EVENTS.stateChanged,
        (event) => applyState(event.payload),
      );
    })();
    return () => {
      if (unlistenState) unlistenState();
    };
  }, [applyState]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  return { state, loading, feedback, setFeedback, refresh, applyState };
}
