import {
  CloseCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Empty, Space, Typography } from "antd";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";
import {
  canRetryFailedDeletion,
  type DeletionRunState,
} from "../application/deletionRun";
import i18n from "../i18n/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryStage } from "./useManagerInventory";

export type SafetyStatusState =
  | { readonly kind: "unbound" }
  | { readonly kind: "loading"; readonly stage: InventoryStage }
  | { readonly kind: "ready" }
  | { readonly kind: "blocked"; readonly reason: SafetyBlockReason };

interface SafetyStatusProps {
  readonly state: SafetyStatusState;
  readonly operationState?: DeletionRunState | null;
  readonly onRetry?: () => void;
  readonly onRetryFailed?: () => void;
  readonly onStop?: () => void;
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

function isActiveOperation(state: DeletionRunState | null): boolean {
  return (
    state?.kind === "running" ||
    state?.kind === "pausing" ||
    state?.kind === "paused" ||
    state?.kind === "stopping"
  );
}

function canStopOperation(state: DeletionRunState): boolean {
  return (
    state.kind === "running" ||
    state.kind === "pausing" ||
    state.kind === "paused"
  );
}

type OperationStripTone = "error" | "info" | "warning";

function OperationStatusStrip({
  tone,
  message,
  action,
}: {
  readonly tone: OperationStripTone;
  readonly message: ReactNode;
  readonly action?: ReactNode;
}) {
  const icon =
    tone === "error" ? (
      <CloseCircleOutlined aria-hidden />
    ) : tone === "warning" ? (
      <WarningOutlined aria-hidden />
    ) : (
      <InfoCircleOutlined aria-hidden />
    );

  return (
    <div
      className={`current-state-strip current-operation-strip current-operation-strip-${tone}`}
      data-testid="current-state-strip"
    >
      <span className="current-operation-strip-icon">{icon}</span>
      <div className="current-operation-strip-message">{message}</div>
      {action !== undefined && (
        <div className="current-operation-strip-action">{action}</div>
      )}
    </div>
  );
}

export function SafetyStatus({
  state,
  operationState = null,
  onRetry,
  onRetryFailed,
  onStop,
}: SafetyStatusProps) {
  const { t } = useTranslation();
  const previousStateKind = useRef(state.kind);
  const operationKind = operationState?.kind ?? null;
  const operationReason =
    operationState?.kind === "blocked" || operationState?.kind === "fatal"
      ? operationState.reason
      : null;
  const previousOperationKind = useRef(operationKind);
  const operationAnnouncementRef = useRef<HTMLDivElement>(null);
  const [readyAnnouncement, setReadyAnnouncement] = useState("");

  useEffect(() => {
    const enteredReady =
      previousStateKind.current !== "ready" && state.kind === "ready";
    previousStateKind.current = state.kind;
    setReadyAnnouncement(enteredReady ? t("safety.readyAnnouncement") : "");
  }, [state.kind, t]);

  useEffect(() => {
    const previousKind = previousOperationKind.current;
    previousOperationKind.current = operationKind;
    const announcementSurface = operationAnnouncementRef.current;
    if (announcementSurface === null) return;

    if (
      operationKind !== "stopped" &&
      operationKind !== "blocked" &&
      operationKind !== "fatal"
    ) {
      announcementSurface.textContent = "";
      return;
    }
    if (previousKind === operationKind) return;

    if (operationKind === "stopped") {
      announcementSurface.textContent = t("deletion.stoppedAnnouncement");
      return;
    }
    if (operationReason === null) return;
    announcementSurface.textContent = t("deletion.failureAnnouncement", {
      reason: safetyBlockReasonLabel(operationReason),
    });
  }, [operationKind, operationReason, t]);

  const operationAnnouncementSurface =
    operationState === null ? null : (
      <div
        ref={operationAnnouncementRef}
        className="visually-hidden"
        data-testid="operation-transition-announcement"
        aria-live="polite"
        aria-atomic="true"
      ></div>
    );
  const withOperationAnnouncement = (surface: ReactNode) => (
    <>
      {surface}
      {operationAnnouncementSurface}
    </>
  );

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

  const establishedFailure =
    operationState?.kind === "blocked" || operationState?.kind === "fatal"
      ? operationState
      : null;
  const establishedFailureNeedsAttention =
    establishedFailure !== null &&
    (state.kind === "blocked" || canRetryFailedDeletion(establishedFailure));
  if (establishedFailureNeedsAttention) {
    const retryFailed =
      canRetryFailedDeletion(establishedFailure) && onRetryFailed !== undefined;
    return withOperationAnnouncement(
      <OperationStatusStrip
        tone="error"
        message={t(`deletion.currentState.${establishedFailure.kind}`, {
          processed: establishedFailure.progress.processed,
          total: establishedFailure.progress.total,
          reason: safetyBlockReasonLabel(establishedFailure.reason),
        })}
        action={
          retryFailed ? (
            <Button size="small" onClick={onRetryFailed}>
              {t("deletion.retryFailed")}
            </Button>
          ) : undefined
        }
      />,
    );
  }

  if (state.kind === "blocked") {
    const messageKey = blockedMessageKey(state.reason);
    const retry = canRetry(state.reason) && onRetry !== undefined;
    return withOperationAnnouncement(
      <Alert
        className="current-state-strip"
        data-testid="current-state-strip"
        role="alert"
        type="error"
        showIcon
        title={
          <span className="current-state-message">
            <strong>{t(`safety.blocked.${messageKey}.title`)}</strong>
            <span aria-hidden> · </span>
            <span>{t(`safety.blocked.${messageKey}.description`)}</span>
          </span>
        }
        action={
          retry ? (
            <Button size="small" onClick={onRetry}>
              {t("safety.tryAgain")}
            </Button>
          ) : undefined
        }
      />,
    );
  }

  if (operationState !== null && isActiveOperation(operationState)) {
    const stop = canStopOperation(operationState) && onStop !== undefined;
    return withOperationAnnouncement(
      <OperationStatusStrip
        tone={operationState.kind === "paused" ? "warning" : "info"}
        message={t(`deletion.currentState.${operationState.kind}`, {
          processed: operationState.progress.processed,
          total: operationState.progress.total,
        })}
        action={
          stop ? (
            <Button danger size="small" onClick={onStop}>
              {t("deletion.stop")}
            </Button>
          ) : undefined
        }
      />,
    );
  }

  const actionableStoppedOperation =
    operationState?.kind === "stopped" &&
    canRetryFailedDeletion(operationState) &&
    onRetryFailed !== undefined
      ? operationState
      : null;
  if (actionableStoppedOperation !== null) {
    return withOperationAnnouncement(
      <OperationStatusStrip
        tone="warning"
        message={t("deletion.currentState.stopped", {
          processed: actionableStoppedOperation.progress.processed,
          total: actionableStoppedOperation.progress.total,
        })}
        action={
          <Button size="small" onClick={onRetryFailed}>
            {t("deletion.retryFailed")}
          </Button>
        }
      />,
    );
  }

  if (state.kind !== "ready" || readyAnnouncement === "") {
    return operationAnnouncementSurface;
  }
  return withOperationAnnouncement(
    <div className="visually-hidden" role="status" aria-live="polite">
      {readyAnnouncement}
    </div>,
  );
}
