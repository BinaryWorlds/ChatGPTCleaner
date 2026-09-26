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
  it("keeps confirmation typing local to the modal", async () => {
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
    const input = screen.getByLabelText("Deletion confirmation");

    await user.type(input, "draft confirmation");

    expect(input).toHaveValue("draft confirmation");
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
