export type LogLevel = "debug" | "info" | "warn" | "error";
export type SafeLogScalar = string | number | boolean | null;
export type SafeLogValue = SafeLogScalar | readonly SafeLogScalar[];
export type SafeLogFields = Readonly<Record<string, SafeLogValue>>;

export interface SafeErrorSummary {
  readonly errorType: "error" | "non-error";
  readonly errorName?: string;
}

export interface LogSink {
  debug(message: string, fields?: SafeLogFields): void;
  info(message: string, fields?: SafeLogFields): void;
  warn(message: string, fields?: SafeLogFields): void;
  error(message: string, fields?: SafeLogFields): void;
}

export interface Logger {
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(
    event: string,
    safeError: SafeErrorSummary,
    fields?: SafeLogFields,
  ): void;
}

const forbiddenFieldName =
  /(authorization|cookie|token|session|email|title|content|message|conversationids?|projectids?|body|headers)/iu;
const validEventName = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u;
const levels: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function minimumLevelForMode(mode: string): LogLevel {
  return mode === "development" || mode === "debug" || mode === "demo"
    ? "debug"
    : "warn";
}

function isSafeScalar(value: unknown): value is SafeLogScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function sanitizeLogFields(fields?: SafeLogFields): SafeLogFields {
  if (fields === undefined) return {};
  const safeEntries: [string, SafeLogValue][] = [];
  for (const [key, value] of Object.entries(fields)) {
    const normalizedKey = key.replaceAll(/[-_]/gu, "").toLowerCase();
    if (
      forbiddenFieldName.test(normalizedKey) ||
      normalizedKey === "request" ||
      normalizedKey === "response" ||
      normalizedKey === "rawrequest" ||
      normalizedKey === "rawresponse"
    ) {
      continue;
    }
    if (isSafeScalar(value)) {
      safeEntries.push([key, value]);
      continue;
    }
    if (Array.isArray(value) && value.every(isSafeScalar)) {
      safeEntries.push([key, value.slice(0, 20)]);
    }
  }
  return Object.fromEntries(safeEntries);
}

export function summarizeUnknownError(error: unknown): SafeErrorSummary {
  if (!(error instanceof Error)) return { errorType: "non-error" };
  const safeName = /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
    ? error.name
    : "Error";
  return { errorType: "error", errorName: safeName };
}

export function createLogger(mode: string, sink: LogSink): Logger {
  const minimum = minimumLevelForMode(mode);
  const enabled = (level: LogLevel): boolean =>
    levels.indexOf(level) >= levels.indexOf(minimum);
  const emit = (
    level: LogLevel,
    event: string,
    fields?: SafeLogFields,
  ): void => {
    if (!enabled(level)) return;
    const safeEvent = validEventName.test(event)
      ? event
      : "logger.invalidEvent";
    const safeFields = sanitizeLogFields(fields);
    sink[level](
      `[ChatGPTCleaner] ${level.toUpperCase()} ${safeEvent}`,
      safeFields,
    );
  };
  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, safeError, fields) =>
      emit("error", event, {
        ...fields,
        errorType: safeError.errorType,
        ...(safeError.errorName === undefined
          ? {}
          : { errorName: safeError.errorName }),
      }),
  };
}

const consoleSink: LogSink = {
  debug: (message, fields) => console.debug(message, fields),
  info: (message, fields) => console.info(message, fields),
  warn: (message, fields) => console.warn(message, fields),
  error: (message, fields) => console.error(message, fields),
};

export const logger = createLogger(import.meta.env.MODE, consoleSink);

let fallbackOperationSequence = 0;

export function createOperationId(
  randomUuid: (() => string) | undefined = globalThis.crypto?.randomUUID?.bind(
    globalThis.crypto,
  ),
): string {
  if (randomUuid !== undefined) return randomUuid();
  fallbackOperationSequence += 1;
  return `operation-${fallbackOperationSequence}`;
}
