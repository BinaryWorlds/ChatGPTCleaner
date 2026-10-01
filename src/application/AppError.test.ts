import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AppError,
  type AppErrorKind,
  appErrorFromHttpStatus,
  createAppError,
  userMessageForAppError,
} from "./AppError";
import type { DeleteAttemptResult } from "./ports/ConversationGateway";

describe("AppError taxonomy", () => {
  it.each<readonly [AppErrorKind, string]>([
    ["AuthenticationUnavailable", "AUTHENTICATION_UNAVAILABLE"],
    ["AuthorizationDenied", "AUTHORIZATION_DENIED"],
    ["SourceTabUnavailable", "SOURCE_TAB_UNAVAILABLE"],
    ["SourceTabInvalidOrigin", "SOURCE_TAB_INVALID_ORIGIN"],
    ["NetworkFailure", "NETWORK_FAILURE"],
    ["RateLimited", "RATE_LIMITED"],
    ["ServerFailure", "SERVER_FAILURE"],
    ["ApiCompatibilityFailure", "API_COMPATIBILITY_FAILURE"],
    ["StorageFailure", "STORAGE_FAILURE"],
    ["OperationCancelled", "OPERATION_CANCELLED"],
    ["UnexpectedFailure", "UNEXPECTED_FAILURE"],
  ])("derives the canonical code and message for %s", (kind, code) => {
    const error = new AppError(kind, "test.operation", false);
    const factoryError = createAppError(kind, { operation: "test.operation" });
    expect(error.code).toBe(code);
    expect(error.safeMessage).toBe(factoryError.safeMessage);
    expect(error.message).toBe(factoryError.message);
  });

  it("requires normalized error information on fatal gateway results", () => {
    expectTypeOf<
      Extract<DeleteAttemptResult, { readonly kind: "fatal" }>
    >().toMatchTypeOf<{ readonly error: AppError }>();
  });

  it("maps 401 to authentication unavailable", () => {
    expect(appErrorFromHttpStatus(401, "inventory").kind).toBe(
      "AuthenticationUnavailable",
    );
  });

  it("maps 403 to authorization denied", () => {
    expect(appErrorFromHttpStatus(403, "inventory").kind).toBe(
      "AuthorizationDenied",
    );
  });

  it("maps 429 and preserves normalized retry delay", () => {
    const error = appErrorFromHttpStatus(429, "inventory", 2_000);
    expect(error).toMatchObject({
      kind: "RateLimited",
      retryable: true,
      retryAfterMs: 2_000,
    });
  });

  it("maps 5xx to a retryable server failure", () => {
    expect(appErrorFromHttpStatus(503, "inventory")).toMatchObject({
      kind: "ServerFailure",
      retryable: true,
    });
  });

  it("provides a safe storage failure", () => {
    expect(
      createAppError("StorageFailure", { operation: "storage.load" }),
    ).toMatchObject({ code: "STORAGE_FAILURE", retryable: false });
  });

  it("never exposes an internal cause in the user-facing message", () => {
    const sentinel = "PRIVATE_BACKEND_RESPONSE_SENTINEL";
    const error = createAppError("UnexpectedFailure", {
      operation: "inventory",
      cause: new Error(sentinel),
    });
    expect(userMessageForAppError(error)).not.toContain(sentinel);
  });
});
