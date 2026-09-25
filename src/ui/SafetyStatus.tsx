import { Card, Descriptions, Tag, Typography } from "antd";
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
  const indicators = deriveSafetyIndicators(state);

  return (
    <Card title="Safety status" size="small">
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="ChatGPT connection">
          <Tag color={indicatorColor(indicators.connection)}>
            {indicators.connection}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Source tab access">
          <Tag
            color={indicatorColor(indicators.sourceTab)}
            data-testid="safety-source-tab"
          >
            {indicators.sourceTab}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Read API compatibility">
          <Tag
            color={indicatorColor(indicators.readCompatibility)}
            data-testid="safety-read-compatibility"
          >
            {indicators.readCompatibility}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Project protection">
          <Tag
            color={indicatorColor(indicators.projectProtection)}
            data-testid="safety-project-protection"
          >
            {indicators.projectProtection}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Run lock">
          <Tag
            color={indicatorColor(indicators.runLock)}
            data-testid="safety-run-lock"
          >
            {indicators.runLock}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Deletion safety">
          <Tag
            color={indicatorColor(indicators.deletion)}
            data-testid="safety-deletion"
          >
            {indicators.deletion}
          </Tag>
        </Descriptions.Item>
      </Descriptions>
      {state.kind === "blocked" && (
        <Typography.Paragraph type="danger" role="alert">
          {safetyBlockReasonLabel(state.reason)}
          {state.diagnostic === undefined ? null : (
            <>
              <br />
              <Typography.Text code>
                {formatReadDiagnostic(state.diagnostic)}
              </Typography.Text>
            </>
          )}
        </Typography.Paragraph>
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
