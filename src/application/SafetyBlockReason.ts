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
