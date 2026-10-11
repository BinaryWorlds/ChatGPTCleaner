import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "domain/conversation";
import ConversationTable from ".";
import {
  clampTablePage,
  CONVERSATION_TABLE_PAGINATION,
} from "./conversationTableContract";

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
  conversations: readonly Conversation[] = [
    {
      id: "alpha",
      title: "Alpha",
      createdAt: 100,
      updatedAt: 200,
    },
  ],
) {
  return render(
    <ConversationTable
      view="standalone"
      conversations={conversations}
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

  it("keeps feedback shared so only the latest copied row reports success", async () => {
    const user = userEvent.setup();
    renderConversationTable(
      () => Promise.resolve(),
      [
        { id: "alpha", title: "Alpha", createdAt: 100, updatedAt: 200 },
        { id: "beta", title: "Beta", createdAt: 300, updatedAt: 400 },
      ],
    );
    const alphaRow = screen.getByText("Alpha").closest("tr");
    const betaRow = screen.getByText("Beta").closest("tr");
    if (alphaRow === null || betaRow === null) {
      throw new Error("Expected both conversation rows");
    }

    await user.click(
      within(alphaRow).getByRole("button", { name: "Copy ID: alpha" }),
    );
    expect(
      await within(alphaRow).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    await user.click(
      within(betaRow).getByRole("button", { name: "Copy ID: beta" }),
    );
    expect(
      await within(betaRow).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(
      within(alphaRow).getByRole("button", { name: "Copy ID: alpha" }),
    ).toBeInTheDocument();
  });

  it("preserves active copy feedback when the table view changes", async () => {
    const user = userEvent.setup();
    const onCopyId = vi.fn(() => Promise.resolve());
    const rendered = renderConversationTable(onCopyId);

    await user.click(screen.getByRole("button", { name: "Copy ID: alpha" }));
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    rendered.rerender(
      <ConversationTable
        view="projects"
        conversations={[
          {
            id: "alpha",
            title: "Alpha",
            createdAt: 100,
            updatedAt: 200,
          },
        ]}
        sortField="updatedAt"
        sortDirection="descending"
        page={1}
        pageSize={50}
        onOpen={vi.fn()}
        onCopyId={onCopyId}
        onSort={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Select /)).not.toBeInTheDocument();
  });
});
