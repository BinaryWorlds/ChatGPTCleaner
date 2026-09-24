import type { ReadOperationName } from "../../application/ports/ConversationGateway";
import { logger, type Logger, type SafeLogFields } from "./logger";

export interface ReadLogEvent {
  readonly operation: ReadOperationName;
  readonly stage: string;
  readonly page?: number;
  readonly world?: "ISOLATED" | "MAIN";
  readonly status?: number;
  readonly responseReceived?: boolean;
  readonly redirected?: boolean;
  readonly jsonParsed?: boolean;
  readonly itemCount?: number;
  readonly offset?: number;
  readonly limit?: number;
  readonly total?: number;
  readonly calculatedNextOffset?: number;
  readonly cursorPresent?: boolean;
  readonly cursorType?: string;
  readonly paginationDecision?: "COMPLETE" | "CONTINUE" | "BLOCKED";
  readonly reason?: string;
  readonly errorName?: string;
  readonly errorMessage?: string;
  readonly endpoint?: string;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly ok?: boolean;
  readonly responseType?: string;
  readonly contentType?: string | null;
}

const operationNames: Record<ReadOperationName, string> = {
  standalone: "standaloneConversations.list",
  projects: "projects.list",
  "project-conversations": "projectConversations.list",
};

function eventName(stage: string): string {
  if (stage === "SCHEMA_VALIDATION_FAILED") return "schema.validation.failed";
  if (stage === "SCHEMA_VALIDATION_OK") return "schema.validation.succeeded";
  if (stage === "PAGINATION_STATE") return "inventory.pagination.state";
  if (stage.includes("FALLBACK") || stage.includes("RETRY")) {
    return "api.request.retry";
  }
  if (
    stage.includes("ERROR") ||
    stage.includes("FAILURE") ||
    stage.includes("REJECTED") ||
    stage.includes("MALFORMED")
  ) {
    return "api.request.failed";
  }
  if (stage.includes("REQUEST_START")) return "api.request.started";
  if (stage.includes("RESPONSE")) return "api.request.succeeded";
  return "api.request.lifecycle";
}

export function logReadEvent(event: ReadLogEvent): void {
  const fields: SafeLogFields = {
    operation: operationNames[event.operation],
    stage: event.stage,
    ...(event.page === undefined ? {} : { page: event.page }),
    ...(event.world === undefined ? {} : { world: event.world }),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.responseReceived === undefined
      ? {}
      : { responseReceived: event.responseReceived }),
    ...(event.redirected === undefined ? {} : { redirected: event.redirected }),
    ...(event.jsonParsed === undefined ? {} : { jsonParsed: event.jsonParsed }),
    ...(event.itemCount === undefined ? {} : { itemCount: event.itemCount }),
    ...(event.offset === undefined ? {} : { offset: event.offset }),
    ...(event.limit === undefined ? {} : { limit: event.limit }),
    ...(event.total === undefined ? {} : { total: event.total }),
    ...(event.calculatedNextOffset === undefined
      ? {}
      : { nextOffset: event.calculatedNextOffset }),
    ...(event.cursorPresent === undefined
      ? {}
      : { cursorPresent: event.cursorPresent }),
    ...(event.cursorType === undefined ? {} : { cursorType: event.cursorType }),
    ...(event.paginationDecision === undefined
      ? {}
      : { paginationDecision: event.paginationDecision }),
  };
  const name = eventName(event.stage);
  if (name === "api.request.failed" || event.paginationDecision === "BLOCKED") {
    logger.warn(name, fields);
    return;
  }
  logger.debug(name, fields);
}

function safeSchemaPath(path: readonly PropertyKey[]): string | null {
  let output = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      output += "[]";
      continue;
    }
    const normalizedSegment =
      typeof segment === "string"
        ? segment.replaceAll("_", "").toLowerCase()
        : "";
    if (
      typeof segment !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]*$/u.test(segment) ||
      /(authorization|cookie|token|session|email|title|content|message|conversation|project|body|request|response|headers)/u.test(
        normalizedSegment,
      )
    ) {
      return null;
    }
    output += output.length === 0 ? segment : `.${segment}`;
  }
  return output || null;
}

export function logSchemaValidationFailure(
  operation: ReadOperationName,
  page: number,
  issues: readonly {
    readonly code: string;
    readonly path: readonly PropertyKey[];
  }[],
  activeLogger: Logger = logger,
): void {
  const paths = issues
    .map((issue) => safeSchemaPath(issue.path))
    .filter((path): path is string => path !== null);
  activeLogger.warn("schema.validation.failed", {
    operation: operationNames[operation],
    schema: `${operation}.page`,
    page,
    issueCount: issues.length,
    issueCodes: issues.map((issue) => issue.code).slice(0, 20),
    paths: paths.slice(0, 20),
  });
}

export function safeExternalErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name) ? error.name : "Error";
}
