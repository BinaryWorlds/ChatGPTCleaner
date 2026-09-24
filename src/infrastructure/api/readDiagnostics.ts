import type { z } from "zod";
import type {
  JsonValueType,
  ReadDiagnosticCategory,
  ReadFailureDiagnostic,
  ReadOperationName,
} from "../../application/ports/ConversationGateway";

const endpointFamilies: Readonly<Record<ReadOperationName, string>> = {
  standalone: "/backend-api/conversations",
  projects: "/backend-api/gizmos/snorlax/sidebar",
  "project-conversations": "/backend-api/gizmos/{project-id}/conversations",
};

function jsonType(value: unknown, exists = true): JsonValueType {
  if (!exists || value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "non-json";
}

function valueAtPath(
  input: unknown,
  path: readonly PropertyKey[],
): { readonly exists: boolean; readonly value: unknown } {
  let current = input;
  for (const segment of path) {
    if (typeof segment === "symbol" || current === null) {
      return { exists: false, value: undefined };
    }
    if (typeof current !== "object") {
      return { exists: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = Reflect.get(current, segment);
  }
  return { exists: true, value: current };
}

function safePath(path: readonly PropertyKey[]): string {
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
      continue;
    }
    if (
      typeof segment !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)
    ) {
      result += result.length === 0 ? "field" : ".field";
      continue;
    }
    result += result.length === 0 ? segment : `.${segment}`;
  }
  return result || "response";
}

function expectedType(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type") return issue.expected;
  if (issue.code === "too_small") return `valid ${issue.origin}`;
  if (issue.code === "too_big") return `bounded ${issue.origin}`;
  return "valid contract value";
}

export function createSchemaDiagnostic(input: {
  readonly operation: ReadOperationName;
  readonly paginationStep: number;
  readonly httpStatus: number;
  readonly body: unknown;
  readonly error: z.ZodError;
}): ReadFailureDiagnostic {
  const issue = input.error.issues[0];
  if (issue === undefined) {
    return createReadDiagnostic({
      operation: input.operation,
      paginationStep: input.paginationStep,
      category: "response-contract",
      httpStatus: input.httpStatus,
      jsonParsed: true,
    });
  }

  const observed = valueAtPath(input.body, issue.path);
  const lastPathSegment = issue.path.at(-1);
  return createReadDiagnostic({
    operation: input.operation,
    paginationStep: input.paginationStep,
    category: "response-contract",
    httpStatus: input.httpStatus,
    jsonParsed: true,
    fieldPath: safePath(issue.path),
    expectedType: expectedType(issue),
    actualType: jsonType(observed.value, observed.exists),
    ...(observed.exists || typeof lastPathSegment !== "string"
      ? {}
      : { missingRequiredField: lastPathSegment }),
  });
}

export function createReadDiagnostic(input: {
  readonly operation: ReadOperationName;
  readonly paginationStep: number;
  readonly category: ReadDiagnosticCategory;
  readonly httpStatus?: number;
  readonly jsonParsed?: boolean;
  readonly fieldPath?: string;
  readonly expectedType?: string;
  readonly actualType?: JsonValueType;
  readonly missingRequiredField?: string;
}): ReadFailureDiagnostic {
  return {
    operation: input.operation,
    endpointFamily: endpointFamilies[input.operation],
    category: input.category,
    paginationStep: input.paginationStep,
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
    ...(input.jsonParsed === undefined ? {} : { jsonParsed: input.jsonParsed }),
    ...(input.fieldPath === undefined ? {} : { fieldPath: input.fieldPath }),
    ...(input.expectedType === undefined
      ? {}
      : { expectedType: input.expectedType }),
    ...(input.actualType === undefined ? {} : { actualType: input.actualType }),
    ...(input.missingRequiredField === undefined
      ? {}
      : { missingRequiredField: input.missingRequiredField }),
  };
}
