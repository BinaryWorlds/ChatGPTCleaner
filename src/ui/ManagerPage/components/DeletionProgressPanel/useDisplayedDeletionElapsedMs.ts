import { useEffect, useState } from "react";
import type { DeletionRunState } from "application/deletionRun";
import { showsActiveDeletionTime } from "./deletionProgressPresentation";

const ELAPSED_TICK_INTERVAL_MS = 1_000;

export function useDisplayedDeletionElapsedMs(state: DeletionRunState): number {
  const [tick, setTick] = useState<{
    readonly state: DeletionRunState;
    readonly elapsedMs: number;
  } | null>(null);

  useEffect(() => {
    const publishedElapsedMs = state.progress.activeElapsedMs;
    const publishedAt = Date.now();

    if (!showsActiveDeletionTime(state.kind)) return;

    const interval = globalThis.setInterval(() => {
      setTick({
        state,
        elapsedMs: publishedElapsedMs + Math.max(0, Date.now() - publishedAt),
      });
    }, ELAPSED_TICK_INTERVAL_MS);

    return () => globalThis.clearInterval(interval);
  }, [state]);

  return tick?.state === state
    ? tick.elapsedMs
    : state.progress.activeElapsedMs;
}
