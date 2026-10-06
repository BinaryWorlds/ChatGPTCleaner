import type { SafetyBlockReason } from "../../application/SafetyBlockReason";
import i18n from "../../i18n/i18n";

const blockedReasonKeys: Readonly<Record<SafetyBlockReason, string>> = {
  authentication: "safety.reasons.authentication",
  authorization: "safety.reasons.authorization",
  compatibility: "safety.reasons.compatibility",
  network: "safety.reasons.network",
  request: "safety.reasons.request",
  "retry-later": "safety.reasons.retryLater",
  server: "safety.reasons.server",
  "source-unavailable": "safety.reasons.sourceUnavailable",
  pagination: "safety.reasons.pagination",
  "protected-storage": "safety.reasons.protectedStorage",
  "destructive-run-lock": "safety.reasons.destructiveRunLock",
  client: "safety.reasons.client",
  "response-anomaly": "safety.reasons.responseAnomaly",
  "unexpected-run-error": "safety.reasons.unexpectedRunError",
};

export function safetyBlockReasonLabel(reason: SafetyBlockReason): string {
  return i18n.t(blockedReasonKeys[reason]);
}

export function blockedMessageKey(reason: SafetyBlockReason): string {
  if (reason === "source-unavailable") return "sourceLost";
  if (reason === "authentication") return "authentication";
  if (
    reason === "authorization" ||
    reason === "client" ||
    reason === "response-anomaly"
  ) {
    return "destructiveFailure";
  }
  if (reason === "compatibility") return "apiIncompatible";
  if (reason === "pagination") return "inventoryIncomplete";
  if (reason === "protected-storage") return "protectedStorage";
  if (
    reason === "network" ||
    reason === "request" ||
    reason === "retry-later" ||
    reason === "server"
  ) {
    return "readFailure";
  }
  return "other";
}

export function canRetrySafetyBlock(reason: SafetyBlockReason): boolean {
  return ["network", "retry-later", "server", "pagination"].includes(reason);
}
