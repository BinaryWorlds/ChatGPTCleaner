import { useEffect, useState } from "react";
import type { SourceTabLifecycle } from "application/ports/SourceTabLifecycle";

interface UseSourceTabAvailabilityOptions {
  readonly sourceTabLifecycle: SourceTabLifecycle | undefined;
  readonly hasAcceptedSnapshot: boolean;
}

export function useSourceTabAvailability({
  sourceTabLifecycle,
  hasAcceptedSnapshot,
}: UseSourceTabAvailabilityOptions): boolean {
  const [sourceLost, setSourceLost] = useState(false);

  useEffect(() => {
    if (
      sourceTabLifecycle === undefined ||
      !hasAcceptedSnapshot ||
      sourceLost
    ) {
      return;
    }

    let current = true;
    const validateSource = () => {
      sourceTabLifecycle.validate().then(
        (result) => {
          if (current && result.kind === "invalid") setSourceLost(true);
        },
        () => {
          if (current) setSourceLost(true);
        },
      );
    };
    const unsubscribe = sourceTabLifecycle.subscribe(validateSource);
    const validateVisibleSource = () => {
      if (document.visibilityState === "visible") validateSource();
    };

    window.addEventListener("focus", validateSource);
    document.addEventListener("visibilitychange", validateVisibleSource);
    return () => {
      current = false;
      unsubscribe();
      window.removeEventListener("focus", validateSource);
      document.removeEventListener("visibilitychange", validateVisibleSource);
    };
  }, [hasAcceptedSnapshot, sourceLost, sourceTabLifecycle]);

  return sourceLost;
}
