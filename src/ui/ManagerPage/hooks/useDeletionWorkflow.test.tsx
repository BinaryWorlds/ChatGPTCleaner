import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeletionRun } from "application/deletionRun";
import { confirmDeletionPlan } from "domain/deletionPlan";
import { FakeClock } from "infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "infrastructure/fake/FakeStores";
import { useDeletionWorkflow } from "./useDeletionWorkflow";

describe("useDeletionWorkflow retry command", () => {
  it("does not enter retry while deletion availability is blocked", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      {
        standalonePages: {
          first: {
            conversations: [{ id: "failed", title: "Failed" }],
            nextCursor: null,
          },
        },
        projects: [],
        projectConversationPages: {},
        deleteOutcomes: {
          failed: [500, 500, 500, 500, 500, "success"],
        },
      },
      clock,
    );
    const protectedConversationStore = new FakeProtectedConversationStore();
    const destructiveRunLock = new FakeDestructiveRunLock();
    const onOperationAttempt = vi.fn();
    const sharedOptions = {
      dependencies: {
        gateway,
        protectedConversationStore,
        settingsStore: new FakeSettingsStore(60),
        clock,
        destructiveRunLock,
      },
      standaloneConversations: [
        {
          id: "failed",
          title: "Failed",
          createdAt: null,
          updatedAt: null,
        },
      ],
      projectConversationIds: new Set<string>(),
      protectedConversationIds: new Set<string>(),
      selectedConversationIds: new Set(["failed"]),
      requestsPerMinute: 60,
      maximumConcurrentDeleteRequests: 1,
      isProtectionMutationPending: () => false,
      onConversationRemoved: vi.fn(),
      onNotice: vi.fn(),
      onOperationAttempt,
      onOperationLockConflict: vi.fn(),
    } as const;
    const { result, rerender } = renderHook(
      ({ inventoryReady }: { readonly inventoryReady: boolean }) =>
        useDeletionWorkflow({ ...sharedOptions, inventoryReady }),
      { initialProps: { inventoryReady: true } },
    );

    act(() => result.current.beginDeletionPreview());
    const previewPlan = result.current.previewPlan;
    if (previewPlan === null) throw new Error("Expected a deletion preview");
    const confirmation = confirmDeletionPlan(previewPlan);
    if (confirmation.kind !== "confirmed") {
      throw new Error("Expected a confirmed deletion plan");
    }

    act(() => result.current.confirmAndStartDeletion(confirmation.plan));
    await waitFor(() =>
      expect(result.current.runState).toMatchObject({
        kind: "finished",
        progress: { failedConversationIds: ["failed"] },
      }),
    );
    expect(gateway.deleteAttempts).toHaveLength(5);
    expect(protectedConversationStore.loadCount).toBe(1);

    const retryEntryPoint = vi.spyOn(
      DeletionRun.prototype,
      "retryFailedDeletion",
    );
    onOperationAttempt.mockClear();
    rerender({ inventoryReady: false });

    act(() => result.current.retryFailed());

    expect(retryEntryPoint).not.toHaveBeenCalled();
    expect(onOperationAttempt).not.toHaveBeenCalled();
    expect(gateway.deleteAttempts).toHaveLength(5);
    expect(protectedConversationStore.loadCount).toBe(1);

    rerender({ inventoryReady: true });
    act(() => result.current.retryFailed());

    expect(retryEntryPoint).toHaveBeenCalledOnce();
    await waitFor(() => expect(gateway.deleteAttempts).toHaveLength(6));
    expect(protectedConversationStore.loadCount).toBe(2);
  });
});
