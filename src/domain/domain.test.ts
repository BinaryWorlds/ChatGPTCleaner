import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION_FILTERS,
  filterConversations,
  sortConversations,
  startOfLocalDay,
  type Conversation,
} from "./conversation";
import {
  buildDeletionPlan,
  confirmDeletionPlan,
  shrinkConfirmedDeletionPlan,
} from "./deletionPlan";
import { calculateDeletionProgress } from "./progress";
import {
  excludeProjectConversations,
  invertMatchingSelection,
  protectConversation,
  selectAllMatching,
} from "./selection";

const conversations: readonly Conversation[] = [
  { id: "a", title: "Alpha", createdAt: 100, updatedAt: 300 },
  { id: "b", title: "Beta", createdAt: null, updatedAt: null },
  { id: "c", title: "Gamma", createdAt: 200, updatedAt: 100 },
];

describe("conversation filtering and sorting", () => {
  it("matches titles case-insensitively", () => {
    expect(
      filterConversations(conversations, {
        ...EMPTY_CONVERSATION_FILTERS,
        titleQuery: "ALP",
      }).map(({ id }) => id),
    ).toEqual(["a"]);
  });

  it("uses strict local-day boundaries and excludes null dates", () => {
    const cutoffDay = { year: 2026, month: 9, day: 21 } as const;
    const cutoff = startOfLocalDay(cutoffDay);
    const datedConversations: readonly Conversation[] = [
      { id: "old", title: "Old", createdAt: cutoff - 1, updatedAt: null },
      { id: "cutoff", title: "Cutoff", createdAt: cutoff, updatedAt: null },
      { id: "unknown", title: "Unknown", createdAt: null, updatedAt: null },
    ];

    expect(
      filterConversations(datedConversations, {
        titleQuery: "",
        dateField: "createdAt",
        dateComparison: "before",
        cutoffLocalDay: cutoffDay,
      }).map(({ id }) => id),
    ).toEqual(["old"]);
    expect(
      filterConversations(datedConversations, {
        titleQuery: "",
        dateField: "createdAt",
        dateComparison: "after",
        cutoffLocalDay: cutoffDay,
      }).map(({ id }) => id),
    ).toEqual(["cutoff"]);
  });

  it("sorts null dates last in both directions", () => {
    expect(
      sortConversations(conversations, "updatedAt", "ascending").map(
        ({ id }) => id,
      ),
    ).toEqual(["c", "a", "b"]);
    expect(
      sortConversations(conversations, "updatedAt", "descending").map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("orders multiple null dates deterministically", () => {
    const unknownDates: readonly Conversation[] = [
      { id: "z", title: "Z", createdAt: null, updatedAt: null },
      { id: "a", title: "A", createdAt: null, updatedAt: null },
    ];

    expect(
      sortConversations(unknownDates, "updatedAt", "descending").map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "z"]);
  });
});

describe("selection and protection", () => {
  it("hard-excludes Project overlaps from standalone inventory", () => {
    expect(
      excludeProjectConversations(conversations, new Set(["b"])).map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "c"]);
  });

  it("bulk selection and inversion skip protected conversations", () => {
    const selected = selectAllMatching(
      new Set<string>(),
      conversations,
      new Set(["b"]),
    );
    expect([...selected]).toEqual(["a", "c"]);
    expect([
      ...invertMatchingSelection(selected, conversations, new Set(["b"])),
    ]).toEqual([]);
  });

  it("protecting a conversation removes it from selection", () => {
    const result = protectConversation(new Set(), new Set(["a", "b"]), "a");
    expect([...result.protectedConversationIds]).toEqual(["a"]);
    expect([...result.selectedConversationIds]).toEqual(["b"]);
  });
});

describe("deletion safety boundary", () => {
  it("excludes Project, protected, missing, malformed, and duplicate IDs", () => {
    const plan = buildDeletionPlan({
      selectedConversationIds: ["a", "b", "c", "missing", "a", "", 42],
      standaloneConversations: conversations,
      projectConversationIds: new Set(["b"]),
      protectedConversationIds: new Set(["c"]),
    });

    expect(plan.eligibleConversationIds).toEqual(["a"]);
    expect(plan.excludedProjectIds).toEqual(["b"]);
    expect(plan.excludedProtectedIds).toEqual(["c"]);
    expect(plan.missingConversationIds).toEqual(["missing"]);
    expect(plan.invalidSelectionCount).toBe(2);
  });

  it("requires exact typed confirmation", () => {
    const plan = buildDeletionPlan({
      selectedConversationIds: ["a"],
      standaloneConversations: conversations,
      projectConversationIds: new Set(),
      protectedConversationIds: new Set(),
    });

    expect(confirmDeletionPlan(plan, "delete 1").kind).toBe("rejected");
    expect(confirmDeletionPlan(plan, "DELETE 1").kind).toBe("confirmed");
  });

  it("revalidation can only shrink the confirmed set", () => {
    const originalPlan = buildDeletionPlan({
      selectedConversationIds: ["a", "b"],
      standaloneConversations: conversations,
      projectConversationIds: new Set(),
      protectedConversationIds: new Set(),
    });
    const confirmation = confirmDeletionPlan(originalPlan, "DELETE 2");
    if (confirmation.kind !== "confirmed") throw new Error("Expected plan");

    const refreshedPlan = buildDeletionPlan({
      selectedConversationIds: ["a", "b", "c"],
      standaloneConversations: conversations,
      projectConversationIds: new Set(["b"]),
      protectedConversationIds: new Set(),
    });

    expect(
      shrinkConfirmedDeletionPlan(confirmation.plan, refreshedPlan)
        .confirmedConversationIds,
    ).toEqual(["a"]);
  });
});

describe("progress", () => {
  it("uses configured rate before three outcomes", () => {
    expect(
      calculateDeletionProgress({
        total: 10,
        deleted: 1,
        failed: 0,
        skipped: 0,
        retries: 0,
        requestsPerMinute: 60,
        activeElapsedMs: 5_000,
        paused: false,
      }).etaMs,
    ).toBe(9_000);
  });

  it("uses measured active throughput after three outcomes", () => {
    const progress = calculateDeletionProgress({
      total: 10,
      deleted: 2,
      failed: 1,
      skipped: 1,
      retries: 2,
      requestsPerMinute: 60,
      activeElapsedMs: 20_000,
      paused: false,
    });

    expect(progress.processed).toBe(4);
    expect(progress.remaining).toBe(6);
    expect(progress.etaMs).toBe(30_000);
  });

  it("has no numeric ETA while paused", () => {
    expect(
      calculateDeletionProgress({
        total: 1,
        deleted: 0,
        failed: 0,
        skipped: 0,
        retries: 0,
        requestsPerMinute: 60,
        activeElapsedMs: 0,
        paused: true,
      }).etaMs,
    ).toBeNull();
  });
});
