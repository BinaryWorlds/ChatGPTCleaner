import { describe, expect, it } from "vitest";
import { findUnappliedRemovedConversationIds } from "./useDeletionWorkflow";

describe("deletion workflow removed-ID deltas", () => {
  it("applies every cumulative removed ID exactly once", () => {
    let appliedCount = 0;
    const appliedIds: string[] = [];

    for (const snapshot of [
      [] as string[],
      ["one"],
      ["one"],
      ["one", "two"],
      ["one", "two", "three"],
    ]) {
      const delta = findUnappliedRemovedConversationIds(appliedCount, snapshot);
      appliedCount = delta.appliedCount;
      appliedIds.push(...delta.ids);
    }

    expect(appliedIds).toEqual(["one", "two", "three"]);
  });

  it("starts a new delta sequence when Retry Failed resets run progress", () => {
    const resetDelta = findUnappliedRemovedConversationIds(3, []);
    expect(resetDelta).toEqual({ ids: [], appliedCount: 0 });

    expect(findUnappliedRemovedConversationIds(0, ["retry-item"])).toEqual({
      ids: ["retry-item"],
      appliedCount: 1,
    });
  });
});
