import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildDeletionPlan } from "../domain/deletionPlan";
import { DeletionConfirmationModal } from "./DeletionConfirmationModal";

const plan = buildDeletionPlan({
  selectedConversationIds: ["one"],
  standaloneConversations: [
    {
      id: "one",
      title: "One",
      createdAt: null,
      updatedAt: null,
    },
  ],
  projectConversationIds: new Set(),
  protectedConversationIds: new Set(),
});

describe("DeletionConfirmationModal", () => {
  it("confirms with a standard destructive action and no typed token", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeletionConfirmationModal
        plan={plan}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
