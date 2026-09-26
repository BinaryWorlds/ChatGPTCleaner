import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeletionPlan,
  type ConfirmedDeletionPlan,
} from "../domain/deletionPlan";
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
  it("keeps confirmation typing local and preserves exact DELETE N behavior", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(confirmedPlan: ConfirmedDeletionPlan) => void>();
    let parentRenderCount = 0;

    function Harness() {
      parentRenderCount += 1;
      return (
        <DeletionConfirmationModal
          plan={plan}
          onCancel={() => undefined}
          onConfirm={onConfirm}
        />
      );
    }

    render(<Harness />);
    const renderCountBeforeTyping = parentRenderCount;
    const input = screen.getByLabelText("Deletion confirmation");
    const confirmButton = screen.getByRole("button", { name: "Delete 1" });

    await user.type(input, "delete 1");
    expect(parentRenderCount).toBe(renderCountBeforeTyping);
    expect(confirmButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "DELETE 1");
    expect(parentRenderCount).toBe(renderCountBeforeTyping);
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0].confirmedConversationIds).toEqual([
      "one",
    ]);
  });
});
