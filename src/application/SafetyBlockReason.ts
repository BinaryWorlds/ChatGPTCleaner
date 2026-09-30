export const readFailureReasons = [
  "authentication",
  "compatibility",
  "network",
  "request",
  "retry-later",
  "server",
  "source-unavailable",
] as const;

export type ReadFailureReason = (typeof readFailureReasons)[number];

export const safetyBlockReasons = [
  ...readFailureReasons,
  "authorization",
  "client",
  "response-anomaly",
  "pagination",
  "protected-storage",
  "destructive-run-lock",
  "unexpected-run-error",
] as const;

export type SafetyBlockReason = (typeof safetyBlockReasons)[number];

export function isSafetyOverrideRevalidatedByCompleteRefresh(
  reason: SafetyBlockReason,
): boolean {
  switch (reason) {
    case "protected-storage":
      return true;
    case "authentication":
    case "authorization":
    case "client":
    case "compatibility":
    case "network":
    case "request":
    case "response-anomaly":
    case "retry-later":
    case "server":
    case "source-unavailable":
    case "pagination":
    case "destructive-run-lock":
    case "unexpected-run-error":
      return false;
  }
}
