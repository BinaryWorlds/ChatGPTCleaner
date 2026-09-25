import type { StandalonePage } from "./conversationPageParsing";

export function parseOffset(cursor: string | null): number | null {
  if (cursor === null) return 0;
  if (!/^\d+$/.test(cursor)) return null;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) ? offset : null;
}

export type StandalonePaginationDecision =
  | {
      readonly kind: "blocked";
      readonly reason: "offset-mismatch" | "item-limit-exceeded";
      readonly effectivePageLimit: number;
    }
  | {
      readonly kind: "accepted";
      readonly complete: boolean;
      readonly observedEnd: number;
      readonly effectivePageLimit: number;
      readonly reason:
        "short-final-page" | "full-page" | "total-indicates-more";
    };

export function decideStandalonePagination(
  requestedOffset: number,
  requestedLimit: number,
  page: StandalonePage,
): StandalonePaginationDecision {
  const effectivePageLimit = Math.min(requestedLimit, page.limit);
  if (page.offset !== requestedOffset) {
    return {
      kind: "blocked",
      reason: "offset-mismatch",
      effectivePageLimit,
    };
  }
  if (page.items.length > effectivePageLimit) {
    return {
      kind: "blocked",
      reason: "item-limit-exceeded",
      effectivePageLimit,
    };
  }

  const observedEnd = requestedOffset + page.items.length;
  const pageIsFull = page.items.length === effectivePageLimit;
  const totalIndicatesMore = page.items.length > 0 && observedEnd < page.total;
  const complete = !pageIsFull && !totalIndicatesMore;
  return {
    kind: "accepted",
    complete,
    observedEnd,
    effectivePageLimit,
    reason: complete
      ? "short-final-page"
      : pageIsFull
        ? "full-page"
        : "total-indicates-more",
  };
}

export type CursorPaginationDecision =
  | { readonly kind: "complete" }
  | { readonly kind: "continue"; readonly nextCursor: string }
  | { readonly kind: "blocked" };

export function decideCursorPagination(
  currentCursor: string | null,
  visitedCursors: ReadonlySet<string>,
  nextCursor: string | null,
): CursorPaginationDecision {
  if (nextCursor === null) return { kind: "complete" };
  if (nextCursor === currentCursor || visitedCursors.has(nextCursor)) {
    return { kind: "blocked" };
  }
  return { kind: "continue", nextCursor };
}
