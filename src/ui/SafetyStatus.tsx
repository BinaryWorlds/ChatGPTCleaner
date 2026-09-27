import {
  InfoCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Badge,
  Card,
  Descriptions,
  Space,
  Tag,
  theme,
  Tooltip,
} from "antd";
import type { ReadFailureDiagnostic } from "../application/ports/ConversationGateway";
import type { SafetyBlockReason } from "../application/SafetyBlockReason";
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

const blockedReasonLabels: Readonly<Record<SafetyBlockReason, string>> = {
  authentication: "Authentication unavailable",
  authorization: "Authorization denied",
  compatibility: "Read API compatibility failed",
  network: "Network unavailable",
  request: "ChatGPT rejected an inventory request",
  "retry-later": "Retry later",
  server: "ChatGPT returned a temporary server error",
  "source-unavailable":
    "Source tab unavailable. Return to a valid ChatGPT tab and relaunch ChatGPTCleaner.",
  pagination: "Inventory pagination incomplete",
  "protected-storage": "Protected-ID storage invalid",
  "destructive-run-lock": "Another destructive run is active",
  client: "ChatGPT rejected the deletion request",
  "response-anomaly": "ChatGPT returned an incompatible deletion response",
  "unexpected-run-error": "The destructive run stopped unexpectedly",
};

export function safetyBlockReasonLabel(reason: SafetyBlockReason): string {
  return blockedReasonLabels[reason];
}

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
  const { token } = theme.useToken();

  return (
    <Tooltip title={help} trigger={["hover", "focus"]}>
      <span
        aria-label={`About ${label}`}
        tabIndex={0}
        style={{
          alignItems: "center",
          color: token.colorText,
          columnGap: token.marginXXS,
          display: "inline-flex",
        }}
      >
        <span>{label}</span>
        <InfoCircleOutlined
          aria-hidden
          style={{
            color: token.colorTextTertiary,
            fontSize: token.fontSizeSM,
          }}
        />
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
  const { token } = theme.useToken();
  const indicators = deriveSafetyIndicators(state);

  return (
    <Card
      title={
        <Space size={token.marginXS}>
          <SafetyCertificateOutlined
            aria-hidden
            style={{ color: token.colorPrimary }}
          />
          <span>Safety status</span>
        </Space>
      }
      size="small"
    >
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3, xl: 6 }}>
        <Descriptions.Item
          label={
            <SafetyCheckLabel
              label="ChatGPT connection"
              help="A usable ChatGPT session is available in the source tab."
            />
          }
        >
          <Tag color={indicatorColor(indicators.connection)} variant="outlined">
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.connection)} />
              {indicators.connection}
            </Space>
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <SafetyCheckLabel
              label="Source tab access"
              help="The extension can access the ChatGPT tab it was launched from."
            />
          }
        >
          <Tag
            color={indicatorColor(indicators.sourceTab)}
            variant="outlined"
            data-testid="safety-source-tab"
          >
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.sourceTab)} />
              {indicators.sourceTab}
            </Space>
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <SafetyCheckLabel
              label="Read API compatibility"
              help="ChatGPT responses match the formats this version supports."
            />
          }
        >
          <Tag
            color={indicatorColor(indicators.readCompatibility)}
            variant="outlined"
            data-testid="safety-read-compatibility"
          >
            <Space size={token.marginXXS}>
              <Badge
                status={indicatorBadgeStatus(indicators.readCompatibility)}
              />
              {indicators.readCompatibility}
            </Space>
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <SafetyCheckLabel
              label="Project protection"
              help="Project conversations in the loaded snapshot are excluded from deletion."
            />
          }
        >
          <Tag
            color={indicatorColor(indicators.projectProtection)}
            variant="outlined"
            data-testid="safety-project-protection"
          >
            <Space size={token.marginXXS}>
              <Badge
                status={indicatorBadgeStatus(indicators.projectProtection)}
              />
              {indicators.projectProtection}
            </Space>
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <SafetyCheckLabel
              label="Run lock"
              help="Prevents multiple deletion runs from running at the same time. Checked when deletion starts."
            />
          }
        >
          <Tag
            color={indicatorColor(indicators.runLock)}
            variant="outlined"
            data-testid="safety-run-lock"
          >
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.runLock)} />
              {indicators.runLock}
            </Space>
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={
            <SafetyCheckLabel
              label="Deletion safety"
              help="Overall safety gate. READY allows deletion; BLOCKED prevents it."
            />
          }
        >
          <Tag
            color={indicatorColor(indicators.deletion)}
            variant="outlined"
            data-testid="safety-deletion"
          >
            <Space size={token.marginXXS}>
              <Badge status={indicatorBadgeStatus(indicators.deletion)} />
              {indicators.deletion}
            </Space>
          </Tag>
        </Descriptions.Item>
      </Descriptions>
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
  if (operation === "standalone") return "Standalone conversations";
  if (operation === "projects") return "Project discovery";
  return "Project conversations";
}

function formatReadDiagnostic(diagnostic: ReadFailureDiagnostic): string {
  const context = `${operationLabel(diagnostic.operation)} (${diagnostic.endpointFamily}), page ${diagnostic.paginationStep}`;
  const response = [
    diagnostic.httpStatus === undefined
      ? null
      : `HTTP ${diagnostic.httpStatus}`,
    diagnostic.jsonParsed === undefined
      ? null
      : `JSON parsed: ${diagnostic.jsonParsed ? "yes" : "no"}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  if (diagnostic.missingRequiredField !== undefined) {
    return `${context}: missing required field ${diagnostic.missingRequiredField}${response.length === 0 ? "" : `; ${response}`}`;
  }
  if (
    diagnostic.fieldPath !== undefined &&
    diagnostic.expectedType !== undefined &&
    diagnostic.actualType !== undefined
  ) {
    return `${context}: ${diagnostic.fieldPath} expected ${diagnostic.expectedType}, received ${diagnostic.actualType}${response.length === 0 ? "" : `; ${response}`}`;
  }
  return `${context}: ${diagnostic.category}${response.length === 0 ? "" : `; ${response}`}`;
}
