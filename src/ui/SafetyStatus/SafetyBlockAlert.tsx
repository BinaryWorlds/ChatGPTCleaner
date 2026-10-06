import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import type { SafetyBlockReason } from "../../application/SafetyBlockReason";
import {
  blockedMessageKey,
  canRetrySafetyBlock,
} from "./safetyStatusPresentation";

interface SafetyBlockAlertProps {
  readonly reason: SafetyBlockReason;
  readonly onRetry?: () => void;
}

export default function SafetyBlockAlert({
  reason,
  onRetry,
}: SafetyBlockAlertProps) {
  const { t } = useTranslation();
  const messageKey = blockedMessageKey(reason);
  const retry = canRetrySafetyBlock(reason) && onRetry !== undefined;

  return (
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
    />
  );
}
