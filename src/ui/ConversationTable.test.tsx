import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  clampTablePage,
  CONVERSATION_TABLE_PAGINATION,
  ConversationTable,
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

function renderConversationTable(
  onCopyId: (conversationId: string) => Promise<void>,
): void {
  render(
    <ConversationTable
      view="standalone"
      conversations={[
        {
          id: "alpha",
          title: "Alpha",
          createdAt: 100,
          updatedAt: 200,
        },
      ]}
      protectedConversationIds={new Set()}
      selectedConversationIds={new Set()}
      selectionDisabled={false}
      protectionDisabled={false}
      protectionFilter={null}
      sortField="updatedAt"
      sortDirection="descending"
      page={1}
      pageSize={50}
      onSelectionChange={vi.fn()}
      onProtectionFilterChange={vi.fn()}
      onProtect={vi.fn()}
      onUnprotect={vi.fn()}
      onOpen={vi.fn()}
      onCopyId={onCopyId}
      onSort={vi.fn()}
      onPageChange={vi.fn()}
    />,
  );
}

describe("ConversationTable Copy ID feedback", () => {
  it("shows local success feedback without adding a global alert", async () => {
    const user = userEvent.setup();
    const onCopyId = vi.fn(() => Promise.resolve());
    renderConversationTable(onCopyId);

    expect(
      screen.queryByRole("columnheader", { name: "ID" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy ID: alpha" }));

    expect(onCopyId).toHaveBeenCalledWith("alpha");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(
      screen
        .queryAllByRole("alert")
        .some((alert) => alert.textContent?.includes("Copied")),
    ).toBe(false);
  });

  it("shows local failure feedback without reporting success", async () => {
    const user = userEvent.setup();
    renderConversationTable(() =>
      Promise.reject(new Error("Clipboard blocked")),
    );

    await user.click(screen.getByRole("button", { name: "Copy ID: alpha" }));

    expect(
      await screen.findByRole("button", {
        name: "Could not copy the conversation ID.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copied" }),
    ).not.toBeInTheDocument();
  });
});
