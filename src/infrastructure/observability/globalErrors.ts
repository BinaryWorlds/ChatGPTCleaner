import type { Logger } from "./logger";
import { summarizeUnknownError } from "./logger";

interface GlobalErrorTarget {
  addEventListener(
    type: "error" | "unhandledrejection",
    listener: (event: Event) => void,
  ): void;
}

export function installGlobalErrorHandlers(
  target: GlobalErrorTarget,
  activeLogger: Logger,
  scope: "background" | "manager",
): void {
  const eventName =
    scope === "manager" ? "ui.unhandledError" : "background.unhandledError";
  target.addEventListener("error", (event) => {
    const error = "error" in event ? event.error : undefined;
    activeLogger.error(eventName, summarizeUnknownError(error), {
      scope,
      source: "error",
    });
  });
  target.addEventListener("unhandledrejection", (event) => {
    const reason = "reason" in event ? event.reason : undefined;
    activeLogger.error(eventName, summarizeUnknownError(reason), {
      scope,
      source: "unhandledrejection",
    });
  });
}
