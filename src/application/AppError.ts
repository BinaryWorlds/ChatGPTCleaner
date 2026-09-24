export const appErrorKinds = [
  "AuthenticationUnavailable",
  "AuthorizationDenied",
  "SourceTabUnavailable",
  "SourceTabInvalidOrigin",
  "NetworkFailure",
  "RateLimited",
  "ServerFailure",
  "ApiCompatibilityFailure",
  "InvalidApiData",
  "StorageFailure",
  "LockUnavailable",
  "OperationCancelled",
  "SafetyBlocked",
  "UnexpectedFailure",
] as const;

export type AppErrorKind = (typeof appErrorKinds)[number];

const errorDetails: Record<
  AppErrorKind,
  { readonly code: string; readonly safeMessage: string }
> = {
  AuthenticationUnavailable: {
    code: "AUTHENTICATION_UNAVAILABLE",
    safeMessage:
      "ChatGPT authentication is unavailable. Open an authenticated ChatGPT tab and retry.",
  },
  AuthorizationDenied: {
    code: "AUTHORIZATION_DENIED",
    safeMessage: "ChatGPT did not authorize this read operation.",
  },
  SourceTabUnavailable: {
    code: "SOURCE_TAB_UNAVAILABLE",
    safeMessage: "The ChatGPT source tab is no longer available.",
  },
  SourceTabInvalidOrigin: {
    code: "SOURCE_TAB_INVALID_ORIGIN",
    safeMessage: "The source tab is not an exact https://chatgpt.com tab.",
  },
  NetworkFailure: {
    code: "NETWORK_FAILURE",
    safeMessage:
      "ChatGPT could not be reached. Check the source tab and retry.",
  },
  RateLimited: {
    code: "RATE_LIMITED",
    safeMessage: "ChatGPT temporarily rate-limited requests. Retry later.",
  },
  ServerFailure: {
    code: "SERVER_FAILURE",
    safeMessage: "ChatGPT returned a temporary server error. Retry later.",
  },
  ApiCompatibilityFailure: {
    code: "API_COMPATIBILITY_FAILURE",
    safeMessage:
      "ChatGPT's internal API response is not compatible with this version of ChatGPTCleaner.",
  },
  InvalidApiData: {
    code: "INVALID_API_DATA",
    safeMessage:
      "ChatGPT returned invalid data. Safety checks stopped without starting deletion.",
  },
  StorageFailure: {
    code: "STORAGE_FAILURE",
    safeMessage:
      "ChatGPTCleaner could not safely read local protection settings.",
  },
  LockUnavailable: {
    code: "LOCK_UNAVAILABLE",
    safeMessage: "Another destructive operation may already be running.",
  },
  OperationCancelled: {
    code: "OPERATION_CANCELLED",
    safeMessage: "The operation was cancelled.",
  },
  SafetyBlocked: {
    code: "SAFETY_BLOCKED",
    safeMessage:
      "Deletion safety checks did not complete. No deletion was started.",
  },
  UnexpectedFailure: {
    code: "UNEXPECTED_FAILURE",
    safeMessage:
      "An unexpected error occurred. No new destructive operation was started.",
  },
};

export class AppError extends Error {
  public override readonly name = "AppError";

  public constructor(
    public readonly kind: AppErrorKind,
    public readonly code: string,
    public readonly safeMessage: string,
    public readonly operation: string,
    public readonly retryable: boolean,
    options: {
      readonly httpStatus?: number;
      readonly retryAfterMs?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      safeMessage,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }

  public readonly httpStatus?: number;
  public readonly retryAfterMs?: number;
}

export function createAppError(
  kind: AppErrorKind,
  input: {
    readonly operation: string;
    readonly retryable?: boolean;
    readonly httpStatus?: number;
    readonly retryAfterMs?: number;
    readonly cause?: unknown;
  },
): AppError {
  const detail = errorDetails[kind];
  return new AppError(
    kind,
    detail.code,
    detail.safeMessage,
    input.operation,
    input.retryable ?? false,
    {
      ...(input.httpStatus === undefined
        ? {}
        : { httpStatus: input.httpStatus }),
      ...(input.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: input.retryAfterMs }),
      ...(input.cause === undefined ? {} : { cause: input.cause }),
    },
  );
}

export function appErrorFromHttpStatus(
  status: number,
  operation: string,
  retryAfterMs?: number,
): AppError {
  if (status === 401) {
    return createAppError("AuthenticationUnavailable", {
      operation,
      httpStatus: status,
    });
  }
  if (status === 403) {
    return createAppError("AuthorizationDenied", {
      operation,
      httpStatus: status,
    });
  }
  if (status === 429) {
    return createAppError("RateLimited", {
      operation,
      retryable: true,
      httpStatus: status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  if (status >= 500 && status < 600) {
    return createAppError("ServerFailure", {
      operation,
      retryable: true,
      httpStatus: status,
    });
  }
  return createAppError("ApiCompatibilityFailure", {
    operation,
    httpStatus: status,
  });
}

export function userMessageForAppError(error: AppError): string {
  return error.safeMessage;
}
