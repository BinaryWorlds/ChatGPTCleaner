import { describe, expect, it } from "vitest";
import {
  normalizeConversation,
  parseProjectConversationPage,
  parseProjectsPage,
  parseStandalonePage,
  type StandalonePage,
} from "./conversationPageParsing";
import {
  decideCursorPagination,
  decideStandalonePagination,
  parseOffset,
} from "./paginationDecisions";

function standalonePage(
  itemCount: number,
  overrides: Partial<Pick<StandalonePage, "limit" | "offset" | "total">> = {},
): StandalonePage {
  return {
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: `conversation-${index}`,
    })),
    limit: overrides.limit ?? 100,
    offset: overrides.offset ?? 0,
    total: overrides.total ?? itemCount,
  };
}

describe("production page parsing", () => {
  it("validates standalone, Project, and Project-conversation page shapes", () => {
    expect(parseStandalonePage(standalonePage(1)).success).toBe(true);
    expect(
      parseProjectsPage({
        items: [{ gizmo: { gizmo: { id: "g-p-project" } } }],
        cursor: null,
      }).success,
    ).toBe(true);
    expect(
      parseProjectConversationPage({
        items: [{ id: "conversation-1" }],
        cursor: "next",
      }).success,
    ).toBe(true);
    expect(parseStandalonePage({ items: [] }).success).toBe(false);
  });

  it("normalizes display-only conversation fields without weakening IDs", () => {
    expect(
      normalizeConversation({
        id: "conversation-1",
        title: null,
        create_time: "invalid",
        update_time: "2025-01-02T00:00:00.000Z",
      }),
    ).toEqual({
      id: "conversation-1",
      title: "(Untitled)",
      createdAt: null,
      updatedAt: Date.parse("2025-01-02T00:00:00.000Z"),
    });
  });
});

describe("standalone pagination decisions", () => {
  it("parses only safe non-negative offset cursors", () => {
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset("200")).toBe(200);
    expect(parseOffset("-1")).toBeNull();
    expect(parseOffset("not-an-offset")).toBeNull();
  });

  it("continues on a full page even when the informational total shrinks", () => {
    expect(
      decideStandalonePagination(
        100,
        100,
        standalonePage(100, { offset: 100, total: 50 }),
      ),
    ).toMatchObject({
      kind: "accepted",
      complete: false,
      observedEnd: 200,
      reason: "full-page",
    });
  });

  it("continues when a short page has an informational total beyond it", () => {
    expect(
      decideStandalonePagination(
        0,
        100,
        standalonePage(28, { limit: 100, total: 393 }),
      ),
    ).toMatchObject({
      kind: "accepted",
      complete: false,
      observedEnd: 28,
      reason: "total-indicates-more",
    });
  });

  it("uses the response limit and completes only on a short terminal page", () => {
    expect(
      decideStandalonePagination(
        0,
        100,
        standalonePage(28, { limit: 28, total: 28 }),
      ),
    ).toMatchObject({ kind: "accepted", complete: false });
    expect(
      decideStandalonePagination(
        28,
        100,
        standalonePage(5, { limit: 28, offset: 28, total: 33 }),
      ),
    ).toMatchObject({
      kind: "accepted",
      complete: true,
      reason: "short-final-page",
    });
  });

  it("blocks offset mismatches and responses larger than the effective limit", () => {
    expect(
      decideStandalonePagination(100, 100, standalonePage(1, { offset: 0 })),
    ).toMatchObject({ kind: "blocked", reason: "offset-mismatch" });
    expect(
      decideStandalonePagination(0, 100, standalonePage(29, { limit: 28 })),
    ).toMatchObject({ kind: "blocked", reason: "item-limit-exceeded" });
  });
});

describe("cursor pagination decisions", () => {
  it("distinguishes completion, progress, and repeated cursors", () => {
    expect(decideCursorPagination("current", new Set(), null)).toEqual({
      kind: "complete",
    });
    expect(decideCursorPagination("current", new Set(), "next")).toEqual({
      kind: "continue",
      nextCursor: "next",
    });
    expect(decideCursorPagination("current", new Set(), "current")).toEqual({
      kind: "blocked",
    });
    expect(
      decideCursorPagination("current", new Set(["seen"]), "seen"),
    ).toEqual({ kind: "blocked" });
  });
});
