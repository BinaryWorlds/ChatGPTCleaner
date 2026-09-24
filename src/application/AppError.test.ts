import { describe, expect, it } from "vitest";
import {
  appErrorFromHttpStatus,
  createAppError,
  userMessageForAppError,
} from "./AppError";
import { appErrorForReadFailure } from "../infrastructure/api/readRetry";

describe("AppError taxonomy", () => {
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

  it("maps transport failure to network failure", () => {
    expect(
      appErrorForReadFailure({ operation: "inventory", networkFailure: true }),
    ).toMatchObject({ kind: "NetworkFailure", retryable: true });
  });

  it("maps cancellation without treating it as retryable", () => {
    expect(
      appErrorForReadFailure({ operation: "inventory", cancelled: true }),
    ).toMatchObject({ kind: "OperationCancelled", retryable: false });
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
