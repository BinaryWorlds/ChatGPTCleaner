import type { AppErrorCode } from "application/AppError";

export const ApiRequestLifecycleEvent = {
  Failed: "api.request.failed",
  Retry: "api.request.retry",
} as const;

export type ObservabilityScalar = string | number | boolean | null;
export type ObservabilityFields = Readonly<
  Record<string, ObservabilityScalar | readonly ObservabilityScalar[]>
>;

export interface ApplicationObservability {
  createOperationId(): string;
  debug(event: string, fields?: ObservabilityFields): void;
  info(event: string, fields?: ObservabilityFields): void;
  warn(event: string, fields?: ObservabilityFields): void;
  error(
    event: string,
    errorCode: AppErrorCode,
    fields?: ObservabilityFields,
  ): void;
}
