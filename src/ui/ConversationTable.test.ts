import { describe, expect, it } from "vitest";
import {
  clampTablePage,
  CONVERSATION_TABLE_PAGINATION,
} from "./ConversationTable";

describe("clampTablePage", () => {
  it("owns the manager table pagination defaults", () => {
    expect(CONVERSATION_TABLE_PAGINATION).toEqual({
      defaultPageSize: 50,
      pageSizeOptions: [25, 50, 100],
    });
  });

  it("keeps a requested page inside the current record range", () => {
    expect(clampTablePage(3, 101, 50)).toBe(3);
    expect(clampTablePage(3, 50, 50)).toBe(1);
    expect(clampTablePage(2, 0, 50)).toBe(1);
    expect(clampTablePage(0, 100, 50)).toBe(1);
  });
});
