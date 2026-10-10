import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeletionRunProgress,
  DeletionRunState,
} from "../../application/deletionRun";
import DeletionProgressPanel from "./DeletionProgressPanel";
import { deletionProgressPercent } from "./deletionProgressPresentation";

const baseProgress: DeletionRunProgress = {
  total: 6,
  processed: 3,
  deleted: 2,
  failed: 0,
  skipped: 1,
  remaining: 3,
  retries: 2,
  requestsPerMinute: 60,
  activeElapsedMs: 3_000,
  etaMs: 3_000,
  paused: false,
  activeRequestCount: 2,
  maximumConcurrentDeleteRequests: 3,
  failedConversationIds: [],
  slowDeleteResponseDetected: false,
};

function state(
  kind: DeletionRunState["kind"],
  progress: Partial<DeletionRunProgress> = {},
): DeletionRunState {
  const value = { ...baseProgress, ...progress };
  return kind === "blocked" || kind === "fatal"
    ? { kind, reason: "authorization", progress: value }
    : { kind, progress: value };
}

function renderPanel(
  runState: DeletionRunState,
  options: { readonly actionPending?: boolean } = {},
) {
  return render(
    <DeletionProgressPanel
      state={runState}
      onPause={vi.fn()}
      onResume={vi.fn()}
      resumeDisabled={false}
      actionPending={options.actionPending ?? false}
      onStop={vi.fn()}
      onRetryFailed={vi.fn()}
    />,
  );
}

function metric(label: string): HTMLElement {
  const container = screen.getByText(label).closest(".deletion-metric");
  if (!(container instanceof HTMLElement)) {
    throw new Error(`Metric not found: ${label}`);
  }
  return container;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("deletion progress presentation", () => {
  it("caps an incomplete rounded percentage at 99 and does not treat zero total as complete", () => {
    expect(
      deletionProgressPercent({
        ...baseProgress,
        total: 200,
        processed: 199,
        remaining: 1,
      }),
    ).toBe(99);
    expect(
      deletionProgressPercent({
        ...baseProgress,
        total: 0,
        processed: 0,
        remaining: 0,
      }),
    ).toBe(0);
  });

  it("merges deleted and skipped outcomes and shows neutral zero failures", () => {
    renderPanel(
      state("running", {
        processed: 0,
        deleted: 0,
        failed: 0,
        skipped: 0,
      }),
    );

    expect(screen.getByText("Completed 0 of 6")).toBeInTheDocument();
    expect(metric("Deleted")).toHaveTextContent("0");
    expect(metric("Failed")).toHaveTextContent("0");
    expect(metric("Failed")).not.toHaveClass("deletion-metric-failed");
    expect(screen.queryByText("Not found")).not.toBeInTheDocument();
    expect(metric("In progress")).toHaveTextContent("2");
    expect(metric("Deletion time")).toHaveTextContent("3s");
    expect(metric("Estimated time remaining")).toHaveTextContent("Estimating…");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("includes internally skipped outcomes in the displayed Deleted count", () => {
    renderPanel(state("finished"));

    expect(metric("Deleted")).toHaveTextContent("3");
    expect(metric("Failed")).toHaveTextContent("0");
    expect(screen.queryByText("Not found")).not.toBeInTheDocument();
  });

  it("uses failure presentation and hides active count and ETA after terminal failure", () => {
    const { container } = renderPanel(
      state("finished", {
        total: 3,
        processed: 3,
        deleted: 2,
        failed: 1,
        remaining: 0,
        failedConversationIds: ["failed"],
      }),
    );

    expect(
      container.querySelector(".ant-progress-status-exception"),
    ).not.toBeNull();
    expect(metric("Failed")).toHaveClass("deletion-metric-failed");
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Estimated time remaining"),
    ).not.toBeInTheDocument();
    expect(metric("Deletion time")).toHaveTextContent("3s");
  });

  it.each(["stopped", "finished"] as const)(
    "uses a neutral simple terminal time for a successful %s state",
    (kind) => {
      const { container } = renderPanel(
        state(kind, {
          total: 3,
          processed: 3,
          deleted: 3,
          remaining: 0,
          activeRequestCount: 0,
        }),
      );

      expect(
        container.querySelector(".ant-progress-status-exception"),
      ).toBeNull();
      expect(metric("Deletion time")).toHaveTextContent("3s");
    },
  );

  it("ticks active elapsed time, freezes it when paused, and rebases on retry reset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { rerender } = renderPanel(
      state("running", { activeElapsedMs: 2_000 }),
    );
    expect(metric("Deletion time")).toHaveTextContent("2s");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(metric("Deletion time")).toHaveTextContent("3s");

    rerender(
      <DeletionProgressPanel
        state={state("paused", { activeElapsedMs: 3_500 })}
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(metric("Deletion time")).toHaveTextContent("4s");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(metric("Deletion time")).toHaveTextContent("4s");

    rerender(
      <DeletionProgressPanel
        state={state("running", { activeElapsedMs: 0 })}
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(metric("Deletion time")).toHaveTextContent("0s");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(metric("Deletion time")).toHaveTextContent("1s");
  });

  it("presents ETA by lifecycle without changing its supplied estimate", () => {
    const { rerender } = renderPanel(
      state("running", { processed: 2, etaMs: 9_000 }),
    );
    expect(metric("Estimated time remaining")).toHaveTextContent("Estimating…");

    rerender(
      <DeletionProgressPanel
        state={state("running", { processed: 3, etaMs: 9_000 })}
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(metric("Estimated time remaining")).toHaveTextContent("about 9s");

    rerender(
      <DeletionProgressPanel
        state={state("paused", { etaMs: null, paused: true })}
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(metric("Estimated time remaining")).toHaveTextContent("Paused");
    expect(metric("In progress")).toHaveTextContent("2");

    rerender(
      <DeletionProgressPanel
        state={state("stopping")}
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Estimated time remaining"),
    ).not.toBeInTheDocument();
    expect(metric("In progress")).toHaveTextContent("2");
  });

  it("keeps the slow-response notice context across lifecycle changes", () => {
    const { rerender } = renderPanel(
      state("running", { slowDeleteResponseDetected: true }),
    );
    expect(
      screen.getByText("ChatGPT’s servers are responding slowly."),
    ).toBeInTheDocument();

    rerender(
      <DeletionProgressPanel
        state={state("finished", {
          slowDeleteResponseDetected: true,
        })}
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(
      screen.getByText("ChatGPT responded slowly during deletion."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("deletion-slow-notice");
  });

  it("bounds failed IDs and visibly owns pending retry input", () => {
    const failedConversationIds = Array.from(
      { length: 25 },
      (_, index) => `failed-${index + 1}`,
    );
    renderPanel(
      state("finished", {
        total: 25,
        processed: 25,
        failed: 25,
        remaining: 0,
        failedConversationIds,
      }),
      { actionPending: true },
    );

    expect(screen.getByText("25 failed")).toBeInTheDocument();
    expect(screen.getByText(/failed-20/)).toBeInTheDocument();
    expect(screen.queryByText(/failed-21/)).not.toBeInTheDocument();
    expect(screen.getByText("+5 more")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry Failed/ })).toBeDisabled();
  });
});
