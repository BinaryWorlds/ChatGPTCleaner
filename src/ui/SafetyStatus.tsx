import {
  InfoCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Alert, Badge, Card, Space, Tag, theme, Tooltip } from "antd";
import type { ReadFailureDiagnostic } from "../application/ports/ConversationGateway";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";
import i18n from "../i18n/i18n";
import { useTranslation } from "react-i18next";
import type { InventoryStage } from "./useManagerInventory";

export type SafetyStatusState =
  | {
      readonly kind: "loading";
      readonly stage: InventoryStage;
    }
  | { readonly kind: "ready" }
  | {
      readonly kind: "blocked";
      readonly reason: SafetyBlockReason;
      readonly diagnostic?: ReadFailureDiagnostic;
      readonly readCompatibilityConfirmed: boolean;
    };

interface SafetyStatusProps {
  readonly state: SafetyStatusState;
}

interface SafetyCheckLabelProps {
  readonly label: string;
  readonly help: string;
}

type SafetyIndicatorStatus =
  "OK" | "READY" | "CHECKING" | "NOT CHECKED" | "BLOCKED";

interface SafetyIndicators {
  readonly connection: SafetyIndicatorStatus;
  readonly sourceTab: SafetyIndicatorStatus;
  readonly readCompatibility: SafetyIndicatorStatus;
  readonly projectProtection: SafetyIndicatorStatus;
  readonly runLock: SafetyIndicatorStatus;
  readonly deletion: SafetyIndicatorStatus;
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

const indicatorKeys: Readonly<Record<SafetyIndicatorStatus, string>> = {
  OK: "safety.indicators.ok",
  READY: "safety.indicators.ready",
  CHECKING: "safety.indicators.checking",
  "NOT CHECKED": "safety.indicators.notChecked",
  BLOCKED: "safety.indicators.blocked",
};

function indicatorColor(value: SafetyIndicatorStatus): string {
  if (value === "OK" || value === "READY") {
    return "success";
  }
  if (value === "CHECKING" || value === "NOT CHECKED") return "processing";
  return "error";
}

function indicatorBadgeStatus(
  value: SafetyIndicatorStatus,
): "success" | "processing" | "error" {
  if (value === "OK" || value === "READY") return "success";
  if (value === "CHECKING" || value === "NOT CHECKED") return "processing";
  return "error";
}

function SafetyCheckLabel({ label, help }: SafetyCheckLabelProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <Tooltip title={help} trigger={["hover", "focus"]}>
      <span
        className="safety-check-label"
        aria-label={t("safety.about", { label })}
        tabIndex={0}
        style={{ color: token.colorText, columnGap: token.marginXXS }}
      >
        <InfoCircleOutlined
          aria-hidden
          style={{
            color: token.colorTextTertiary,
            fontSize: token.fontSizeSM,
          }}
        />
        <span>{label}</span>
      </span>
    </Tooltip>
  );
}

export function deriveSafetyIndicators(
  state: SafetyStatusState,
): SafetyIndicators {
  if (state.kind === "loading") {
    if (state.stage !== "compatibility") {
      return {
        connection: "OK",
        sourceTab: "OK",
        readCompatibility: "OK",
        projectProtection:
          state.stage === "projects" ? "CHECKING" : "NOT CHECKED",
        runLock: "NOT CHECKED",
        deletion: "BLOCKED",
      };
    }
    return {
      connection: "CHECKING",
      sourceTab: "CHECKING",
      readCompatibility: "CHECKING",
      projectProtection: "CHECKING",
      runLock: "CHECKING",
      deletion: "CHECKING",
    };
  }
  if (state.kind === "ready") {
    return {
      connection: "OK",
      sourceTab: "OK",
      readCompatibility: "OK",
      projectProtection: "OK",
      runLock: "NOT CHECKED",
      deletion: "READY",
    };
  }

  const blockedReason = state.reason;
  const sourceValidated = blockedReason !== "source-unavailable";
  if (state.readCompatibilityConfirmed) {
    return {
      connection: "OK",
      sourceTab: "OK",
      readCompatibility: "OK",
      projectProtection: "BLOCKED",
      runLock: "NOT CHECKED",
      deletion: "BLOCKED",
    };
  }
  const connectionValidated =
    sourceValidated &&
    !["authentication", "network", "request", "retry-later", "server"].includes(
      blockedReason ?? "",
    );
  const readValidated =
    connectionValidated &&
    !["compatibility", "pagination"].includes(blockedReason ?? "");
  const projectProtectionValidated =
    readValidated && blockedReason === "protected-storage";
  return {
    connection: connectionValidated ? "OK" : "BLOCKED",
    sourceTab: sourceValidated ? "OK" : "BLOCKED",
    readCompatibility: readValidated ? "OK" : "BLOCKED",
    projectProtection: projectProtectionValidated ? "OK" : "BLOCKED",
    runLock:
      blockedReason === "destructive-run-lock" ? "BLOCKED" : "NOT CHECKED",
    deletion: "BLOCKED",
  };
}

export function SafetyStatus({ state }: SafetyStatusProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const indicators = deriveSafetyIndicators(state);

  return (
    <Card
      className={`safety-surface safety-surface-${state.kind}`}
      title={
        <Space size={token.marginXS}>
          <SafetyCertificateOutlined
            aria-hidden
            style={{ color: token.colorPrimary }}
          />
          <span>{t("safety.title")}</span>
        </Space>
      }
      size="small"
    >
      <div className="safety-check-grid">
        <div className="safety-check-item">
          <SafetyCheckLabel
            label={t("safety.checks.connection.label")}
            help={t("safety.checks.connection.help")}
          />
          <Tag color={indicatorColor(indicators.connection)} variant="outlined">
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.connection)} />
              {t(indicatorKeys[indicators.connection])}
            </Space>
          </Tag>
        </div>
        <div className="safety-check-item">
          <SafetyCheckLabel
            label={t("safety.checks.sourceTab.label")}
            help={t("safety.checks.sourceTab.help")}
          />
          <Tag
            color={indicatorColor(indicators.sourceTab)}
            variant="outlined"
            data-testid="safety-source-tab"
          >
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.sourceTab)} />
              {t(indicatorKeys[indicators.sourceTab])}
            </Space>
          </Tag>
        </div>
        <div className="safety-check-item">
          <SafetyCheckLabel
            label={t("safety.checks.compatibility.label")}
            help={t("safety.checks.compatibility.help")}
          />
          <Tag
            color={indicatorColor(indicators.readCompatibility)}
            variant="outlined"
            data-testid="safety-read-compatibility"
          >
            <Space size={token.marginXXS}>
              <Badge
                status={indicatorBadgeStatus(indicators.readCompatibility)}
              />
              {t(indicatorKeys[indicators.readCompatibility])}
            </Space>
          </Tag>
        </div>
        <div className="safety-check-item">
          <SafetyCheckLabel
            label={t("safety.checks.projectProtection.label")}
            help={t("safety.checks.projectProtection.help")}
          />
          <Tag
            color={indicatorColor(indicators.projectProtection)}
            variant="outlined"
            data-testid="safety-project-protection"
          >
            <Space size={token.marginXXS}>
              <Badge
                status={indicatorBadgeStatus(indicators.projectProtection)}
              />
              {t(indicatorKeys[indicators.projectProtection])}
            </Space>
          </Tag>
        </div>
        <div className="safety-check-item">
          <SafetyCheckLabel
            label={t("safety.checks.runLock.label")}
            help={t("safety.checks.runLock.help")}
          />
          <Tag
            color={indicatorColor(indicators.runLock)}
            variant="outlined"
            data-testid="safety-run-lock"
          >
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.runLock)} />
              {t(indicatorKeys[indicators.runLock])}
            </Space>
          </Tag>
        </div>
        <div className="safety-check-item">
          <SafetyCheckLabel
            label={t("safety.checks.deletion.label")}
            help={t("safety.checks.deletion.help")}
          />
          <Tag
            color={indicatorColor(indicators.deletion)}
            variant="outlined"
            data-testid="safety-deletion"
          >
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.deletion)} />
              {t(indicatorKeys[indicators.deletion])}
            </Space>
          </Tag>
        </div>
      </div>
      {state.kind === "blocked" && (
        <Alert
          type="error"
          showIcon
          title={safetyBlockReasonLabel(state.reason)}
          description={
            state.diagnostic === undefined
              ? undefined
              : formatReadDiagnostic(state.diagnostic)
          }
          style={{ marginTop: token.marginSM }}
        />
      )}
    </Card>
  );
}

function operationLabel(operation: ReadFailureDiagnostic["operation"]): string {
  if (operation === "standalone") return i18n.t("safety.diagnostic.standalone");
  if (operation === "projects") return i18n.t("safety.diagnostic.projects");
  return i18n.t("safety.diagnostic.projectConversations");
}

function formatReadDiagnostic(diagnostic: ReadFailureDiagnostic): string {
  const context = i18n.t("safety.diagnostic.context", {
    operation: operationLabel(diagnostic.operation),
    endpointFamily: diagnostic.endpointFamily,
    page: diagnostic.paginationStep,
  });
  const response = [
    diagnostic.httpStatus === undefined
      ? null
      : `HTTP ${diagnostic.httpStatus}`,
    diagnostic.jsonParsed === undefined
      ? null
      : i18n.t("safety.diagnostic.jsonParsed", {
          value: i18n.t(
            diagnostic.jsonParsed
              ? "safety.diagnostic.yes"
              : "safety.diagnostic.no",
          ),
        }),
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  if (diagnostic.missingRequiredField !== undefined) {
    return i18n.t("safety.diagnostic.missingField", {
      context,
      field: diagnostic.missingRequiredField,
      response:
        response.length === 0
          ? ""
          : i18n.t("safety.diagnostic.responseSeparator", { response }),
    });
  }
  if (
    diagnostic.fieldPath !== undefined &&
    diagnostic.expectedType !== undefined &&
    diagnostic.actualType !== undefined
  ) {
    return i18n.t("safety.diagnostic.typeMismatch", {
      context,
      field: diagnostic.fieldPath,
      expected: diagnostic.expectedType,
      actual: diagnostic.actualType,
      response:
        response.length === 0
          ? ""
          : i18n.t("safety.diagnostic.responseSeparator", { response }),
    });
  }
  return i18n.t("safety.diagnostic.category", {
    context,
    category: diagnostic.category,
    response:
      response.length === 0
        ? ""
        : i18n.t("safety.diagnostic.responseSeparator", { response }),
  });
}
