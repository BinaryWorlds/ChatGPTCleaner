import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeletionRunState } from "../application/deletionRun";
import { DeletionProgressPanel } from "./DeletionProgressPanel";

describe("DeletionProgressPanel", () => {
  it("renders a bounded failed-ID preview while preserving the full count", () => {
    const failedConversationIds = Array.from(
      { length: 25 },
      (_, index) => `failed-${index + 1}`,
    );
    const state: DeletionRunState = {
      kind: "finished",
      progress: {
        total: 25,
        processed: 25,
        deleted: 0,
        failed: 25,
        skipped: 0,
        remaining: 0,
        retries: 0,
        requestsPerMinute: 60,
        activeElapsedMs: 1_000,
        etaMs: 0,
        paused: false,
        currentConversationId: null,
        failedConversationIds,
      },
    };

    render(
      <DeletionProgressPanel
        state={state}
        currentConversationLabel="None"
        onPause={vi.fn()}
        onResume={vi.fn()}
        resumeDisabled={false}
        onStop={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );

    expect(screen.getByText("25 failed")).toBeInTheDocument();
    expect(screen.getByText(/failed-20/)).toBeInTheDocument();
    expect(screen.queryByText(/failed-21/)).not.toBeInTheDocument();
    expect(screen.getByText("+5 more")).toBeInTheDocument();
  });
});
