import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { safetyBlockReasons } from "../application/SafetyBlockReason";
import { describe, expect, it, vi } from "vitest";
import { SafetyStatus, safetyBlockReasonLabel } from "./SafetyStatus";

describe("SafetyStatus", () => {
  it("has a safe run-facing label for every safety block reason", () => {
    for (const reason of safetyBlockReasons) {
      expect(safetyBlockReasonLabel(reason).trim()).not.toBe("");
    }
  });

  it("announces a transition to ready without a visible status surface", () => {
    const { rerender } = render(
      <SafetyStatus state={{ kind: "loading", stage: "projects" }} />,
    );

    rerender(<SafetyStatus state={{ kind: "ready" }} />);

    const announcement = screen.getByRole("status");
    expect(announcement).toHaveTextContent("ChatGPTCleaner is ready.");
    expect(screen.queryByText("Safety status")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ready$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Run lock")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Read API compatibility"),
    ).not.toBeInTheDocument();

    rerender(<SafetyStatus state={{ kind: "ready" }} />);
    expect(screen.getByRole("status")).toBe(announcement);
  });

  it("leaves loading presentation to the inventory progress surface", () => {
    const { container } = render(
      <SafetyStatus state={{ kind: "loading", stage: "projects" }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows one unbound empty state without a technical dashboard", () => {
    render(<SafetyStatus state={{ kind: "unbound" }} />);

    expect(
      screen.getByRole("heading", {
        name: "Launch ChatGPTCleaner from a ChatGPT tab",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Deletion safety")).not.toBeInTheDocument();
  });

  it("shows one authentication root cause", () => {
    render(
      <SafetyStatus state={{ kind: "blocked", reason: "authentication" }} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your ChatGPT session is unavailable",
    );
    expect(screen.queryByText("Project protection")).not.toBeInTheDocument();
  });

  it("shows one API incompatibility cause without a meaningless retry", () => {
    render(
      <SafetyStatus state={{ kind: "blocked", reason: "compatibility" }} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ChatGPT interface is not supported",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers retry for incomplete inventory", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <SafetyStatus
        state={{ kind: "blocked", reason: "pagination" }}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("reports protected storage failure without reset action", () => {
    render(
      <SafetyStatus state={{ kind: "blocked", reason: "protected-storage" }} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Protected conversation data could not be read safely",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
