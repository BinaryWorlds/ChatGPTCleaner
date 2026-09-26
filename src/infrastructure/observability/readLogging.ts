import {
  ChatGptOperation,
  type ReadOperationName,
} from "../../application/ports/ConversationGateway";
import { logger, type Logger } from "./logger";

const MAX_SCHEMA_DIAGNOSTIC_ITEMS = 20;

const operationNames: Record<ReadOperationName, string> = {
  standalone: ChatGptOperation.StandaloneConversationsList,
  projects: ChatGptOperation.ProjectsList,
  "project-conversations": ChatGptOperation.ProjectConversationsList,
};

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
    issueCodes: issues
      .map((issue) => issue.code)
      .slice(0, MAX_SCHEMA_DIAGNOSTIC_ITEMS),
    paths: paths.slice(0, MAX_SCHEMA_DIAGNOSTIC_ITEMS),
  });
}
