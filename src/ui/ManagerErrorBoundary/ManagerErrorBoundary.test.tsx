import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ManagerErrorBoundary from "./ManagerErrorBoundary";

function BrokenView(): never {
  throw new Error("PRIVATE_CONTENT_SENTINEL");
}

describe("ManagerErrorBoundary", () => {
  it("renders a safe fallback and reports the error without displaying it", () => {
    const onError = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(
        <ManagerErrorBoundary onError={onError}>
          <BrokenView />
        </ManagerErrorBoundary>,
      );
      expect(
        screen.getByText(/No new destructive operation was started/u),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/PRIVATE_CONTENT_SENTINEL/u),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/UNEXPECTED_FAILURE/u)).toBeInTheDocument();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();
      expect(
        consoleError.mock.calls
          .flat()
          .some(
            (value) =>
              value instanceof Error &&
              value.message === "PRIVATE_CONTENT_SENTINEL",
          ),
      ).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });
});
