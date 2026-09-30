import { Alert, Button, Card, Empty, Space, Typography } from "antd";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";
import i18n from "../i18n/i18n";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryStage } from "./useManagerInventory";

export type SafetyStatusState =
  | { readonly kind: "unbound" }
  | { readonly kind: "loading"; readonly stage: InventoryStage }
  | { readonly kind: "ready" }
  | { readonly kind: "blocked"; readonly reason: SafetyBlockReason };

interface SafetyStatusProps {
  readonly state: SafetyStatusState;
  readonly onRetry?: () => void;
}

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

function blockedMessageKey(reason: SafetyBlockReason): string {
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

function canRetry(reason: SafetyBlockReason): boolean {
  return ["network", "retry-later", "server", "pagination"].includes(reason);
}

export function SafetyStatus({ state, onRetry }: SafetyStatusProps) {
  const { t } = useTranslation();
  const previousStateKind = useRef(state.kind);
  const [readyAnnouncement, setReadyAnnouncement] = useState("");

  useEffect(() => {
    const enteredReady =
      previousStateKind.current !== "ready" && state.kind === "ready";
    previousStateKind.current = state.kind;
    setReadyAnnouncement(enteredReady ? t("safety.readyAnnouncement") : "");
  }, [state.kind, t]);

  if (state.kind === "loading") return null;

  if (state.kind === "unbound") {
    return (
      <Card size="small" aria-live="polite">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space orientation="vertical" size="small">
              <Typography.Title level={4} style={{ margin: 0 }}>
                {t("safety.unbound.title")}
              </Typography.Title>
              <Typography.Text type="secondary">
                {t("safety.unbound.description")}
              </Typography.Text>
            </Space>
          }
        />
      </Card>
    );
  }

  if (state.kind === "ready") {
    if (readyAnnouncement === "") return null;
    return (
      <div className="visually-hidden" role="status" aria-live="polite">
        {readyAnnouncement}
      </div>
    );
  }

  const messageKey = blockedMessageKey(state.reason);
  const retry = canRetry(state.reason) && onRetry !== undefined;
  return (
    <Alert
      role="alert"
      type="error"
      showIcon
      title={t(`safety.blocked.${messageKey}.title`)}
      description={t(`safety.blocked.${messageKey}.description`)}
      action={
        retry ? (
          <Button size="small" onClick={onRetry}>
            {t("safety.tryAgain")}
          </Button>
        ) : undefined
      }
    />
  );
}
