import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { safetyBlockReasons } from "../../application/SafetyBlockReason";
import type {
  DeletionRunProgress,
  DeletionRunState,
} from "../../application/deletionRun";
import { describe, expect, it, vi } from "vitest";
import SafetyStatus from "./SafetyStatus";
import { safetyBlockReasonLabel } from "./safetyStatusPresentation";

const operationProgress: DeletionRunProgress = {
  total: 180,
  processed: 42,
  deleted: 40,
  failed: 2,
  skipped: 0,
  remaining: 138,
  retries: 1,
  requestsPerMinute: 10,
  activeElapsedMs: 60_000,
  paused: false,
  etaMs: 120_000,
  activeRequestCount: 1,
  maximumConcurrentDeleteRequests: 2,
  failedConversationIds: ["failed-1", "failed-2"],
  slowDeleteResponseDetected: false,
};

type OperationStateWithoutProgress<State> = State extends unknown
  ? Omit<State, "progress">
  : never;

function operationState(
  state: OperationStateWithoutProgress<DeletionRunState>,
): DeletionRunState {
  return { ...state, progress: operationProgress };
}

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

  it("has no sticky current-state strip when no relevant state exists", () => {
    render(<SafetyStatus state={{ kind: "ready" }} />);

    expect(screen.queryByTestId("current-state-strip")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("current-state-strip")).toHaveTextContent(
      "Sign in to ChatGPT and launch ChatGPTCleaner again.",
    );
    expect(screen.queryByText("Project protection")).not.toBeInTheDocument();
  });

  it("keeps active operation transitions nonvisual without duplicate controls", () => {
    render(
      <SafetyStatus
        state={{ kind: "ready" }}
        operationState={operationState({ kind: "running" })}
      />,
    );

    expect(screen.queryByTestId("current-state-strip")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stop" }),
    ).not.toBeInTheDocument();
    const announcement = screen.getByTestId(
      "operation-transition-announcement",
    );
    expect(announcement).toBeEmptyDOMElement();
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveAttribute("aria-atomic", "true");
    expect(announcement).not.toHaveAttribute("role");
  });

  it("prioritizes one blocking cause over active operation progress", () => {
    render(
      <SafetyStatus
        state={{ kind: "blocked", reason: "source-unavailable" }}
        operationState={operationState({ kind: "running" })}
      />,
    );

    expect(screen.getAllByTestId("current-state-strip")).toHaveLength(1);
    expect(screen.getByTestId("current-state-strip")).toHaveTextContent(
      "ChatGPT source tab is unavailable",
    );
    expect(screen.queryByText("Deleting 42 / 180")).not.toBeInTheDocument();
  });

  it("preserves the canonical fatal safety blocker without destructive recovery", () => {
    render(
      <SafetyStatus
        state={{ kind: "blocked", reason: "authorization" }}
        operationState={operationState({
          kind: "fatal",
          reason: "authorization",
        })}
      />,
    );

    const strip = screen.getByTestId("current-state-strip");
    expect(strip).toHaveTextContent("ChatGPT rejected the deletion request");
    expect(
      screen.queryByRole("button", { name: "Retry Failed" }),
    ).not.toBeInTheDocument();
  });

  it("does not duplicate stopped progress or retry controls", () => {
    const { rerender } = render(
      <SafetyStatus
        state={{ kind: "ready" }}
        operationState={operationState({ kind: "stopped" })}
      />,
    );

    expect(screen.queryByTestId("current-state-strip")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry Failed" }),
    ).not.toBeInTheDocument();

    rerender(
      <SafetyStatus
        state={{ kind: "ready" }}
        operationState={{
          kind: "stopped",
          progress: {
            ...operationProgress,
            failed: 0,
            failedConversationIds: [],
          },
        }}
      />,
    );
    expect(screen.queryByTestId("current-state-strip")).not.toBeInTheDocument();
  });

  it("announces each stopped or fatal transition once without progress", async () => {
    const { rerender } = render(
      <SafetyStatus
        state={{ kind: "ready" }}
        operationState={operationState({ kind: "running" })}
      />,
    );
    const announcement = screen.getByTestId(
      "operation-transition-announcement",
    );
    expect(announcement).toBeEmptyDOMElement();

    rerender(
      <SafetyStatus
        state={{ kind: "blocked", reason: "authorization" }}
        operationState={operationState({
          kind: "fatal",
          reason: "authorization",
        })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("operation-transition-announcement"),
      ).toHaveTextContent("Deletion stopped. Authorization denied"),
    );
    expect(announcement).not.toHaveTextContent("42 / 180");

    const announcementMutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      announcementMutations.push(...records);
    });
    const fatalAnnouncement = screen.getByTestId(
      "operation-transition-announcement",
    );
    observer.observe(fatalAnnouncement, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    rerender(
      <SafetyStatus
        state={{ kind: "blocked", reason: "authorization" }}
        operationState={operationState({
          kind: "fatal",
          reason: "authorization",
        })}
      />,
    );
    rerender(
      <SafetyStatus
        state={{ kind: "blocked", reason: "authorization" }}
        operationState={{
          ...operationState({ kind: "fatal", reason: "authorization" }),
          progress: { ...operationProgress, processed: 43 },
        }}
      />,
    );
    expect(screen.getByTestId("current-state-strip")).toHaveTextContent(
      "ChatGPT rejected the deletion request",
    );
    expect(fatalAnnouncement).toHaveTextContent(
      "Deletion stopped. Authorization denied",
    );
    expect(fatalAnnouncement).not.toHaveTextContent("43 / 180");
    expect(announcementMutations).toEqual([]);
    observer.disconnect();

    rerender(
      <SafetyStatus
        state={{ kind: "ready" }}
        operationState={operationState({ kind: "running" })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("operation-transition-announcement"),
      ).toBeEmptyDOMElement(),
    );

    rerender(
      <SafetyStatus
        state={{ kind: "ready" }}
        operationState={operationState({ kind: "stopped" })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("operation-transition-announcement"),
      ).toHaveTextContent("Deletion stopped."),
    );
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
