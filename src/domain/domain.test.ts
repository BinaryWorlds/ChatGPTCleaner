import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION_FILTERS,
  filterConversations,
  olderThanCalendarPreset,
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

  it("uses clamped calendar-month semantics for the six-month preset", () => {
    expect(
      olderThanCalendarPreset("six-months", new Date(2026, 7, 31, 15, 30)),
    ).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it("uses calendar-year semantics across a leap-day boundary", () => {
    expect(
      olderThanCalendarPreset("one-year", new Date(2024, 1, 29, 8, 0)),
    ).toEqual({ year: 2023, month: 2, day: 28 });
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

  it("bulk selection and inversion are independent from protection", () => {
    const selected = selectAllMatching(new Set<string>(), conversations);
    expect([...selected]).toEqual(["a", "b", "c"]);
    expect([...invertMatchingSelection(selected, conversations)]).toEqual([]);
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

  it("confirms a non-empty eligible deletion plan without typed input", () => {
    const plan = buildDeletionPlan({
      selectedConversationIds: ["a"],
      standaloneConversations: conversations,
      projectConversationIds: new Set(),
      protectedConversationIds: new Set(),
    });

    expect(confirmDeletionPlan(plan).kind).toBe("confirmed");
  });

  it("confirmation applies the current snapshot and local protection without adding IDs", () => {
    const originalPlan = buildDeletionPlan({
      selectedConversationIds: ["a", "b"],
      standaloneConversations: conversations,
      projectConversationIds: new Set(),
      protectedConversationIds: new Set(),
    });
    const confirmation = confirmDeletionPlan(originalPlan);
    if (confirmation.kind !== "confirmed") throw new Error("Expected plan");

    expect(
      shrinkConfirmedDeletionPlan(confirmation.plan, {
        projectConversationIds: new Set(),
        protectedConversationIds: new Set(["b"]),
        standaloneConversationIds: new Set(["a", "b", "c"]),
      }).confirmedConversationIds,
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
