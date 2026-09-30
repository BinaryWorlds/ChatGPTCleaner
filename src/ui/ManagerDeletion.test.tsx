import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerDependencies } from "../composition/types";
import type { DestructiveRunLock } from "../application/ports/DestructiveRunLock";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../application/ports/ProtectedConversationStore";
import { FakeClock } from "../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../infrastructure/fake/FakeStores";
import {
  STANDALONE_COMPATIBILITY_FAILURE_FIXTURE,
  type FakeConversationFixture,
  type FakeGatewayFixture,
} from "../infrastructure/fake/fixtures";
import { ManagerPage } from "./ManagerPage";

const DAY_MS = 86_400_000;
const FIXED_NOW = Date.UTC(2026, 0, 15, 12);

class DeferredProtectedConversationStore implements ProtectedConversationStore {
  public readonly pendingSaves: {
    readonly protectedConversationIds: ReadonlySet<string>;
    readonly resolve: () => void;
    readonly reject: () => void;
  }[] = [];

  private storedProtectedConversationIds: ReadonlySet<string>;

  public constructor(initialIds: readonly string[] = []) {
    this.storedProtectedConversationIds = new Set(initialIds);
  }

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    const protectedConversationIds = new Set(
      this.storedProtectedConversationIds,
    );
    return Promise.resolve({
      kind: "success",
      protectedConversationIds,
    });
  }

  public saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    const savedIds = new Set(protectedConversationIds);
    return new Promise((resolve, reject) => {
      this.pendingSaves.push({
        protectedConversationIds: savedIds,
        resolve: () => {
          this.storedProtectedConversationIds = savedIds;
          resolve();
        },
        reject: () => reject(new Error("Storage unavailable")),
      });
    });
  }

  public resolveNextSave(): void {
    const pendingSave = this.pendingSaves.shift();
    if (pendingSave === undefined) {
      throw new Error("No pending protection save");
    }
    pendingSave.resolve();
  }

  public rejectNextSave(): void {
    const pendingSave = this.pendingSaves.shift();
    if (pendingSave === undefined) {
      throw new Error("No pending protection save");
    }
    pendingSave.reject();
  }
}

class FailAfterInitialProtectedStore implements ProtectedConversationStore {
  private loadCount = 0;
  private failing = true;

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    this.loadCount += 1;
    if (this.loadCount === 1 || !this.failing) {
      return Promise.resolve({
        kind: "success",
        protectedConversationIds: new Set(),
      });
    }
    return Promise.resolve({ kind: "invalid" });
  }

  public saveProtectedConversationIds(): Promise<void> {
    return Promise.resolve();
  }

  public recover(): void {
    this.failing = false;
  }
}

function fixture(
  conversations: readonly FakeConversationFixture[],
  deleteOutcomes: FakeGatewayFixture["deleteOutcomes"] = {},
): FakeGatewayFixture {
  return {
    standalonePages: {
      first: { conversations, nextCursor: null },
    },
    projects: [],
    projectConversationPages: {},
    deleteOutcomes,
  };
}

function renderManager(input?: {
  readonly gatewayFixture?: FakeGatewayFixture;
  readonly protectedIds?: readonly string[];
  readonly protectedConversationStore?: ProtectedConversationStore;
  readonly clock?: FakeClock;
  readonly destructiveRunLock?: DestructiveRunLock;
}) {
  const clock = input?.clock ?? new FakeClock(FIXED_NOW);
  const gateway = new FakeConversationGateway(
    input?.gatewayFixture ??
      fixture([
        {
          id: "alpha",
          title: "Alpha",
          createdAt: FIXED_NOW - 20 * DAY_MS,
          updatedAt: FIXED_NOW - 20 * DAY_MS,
        },
        {
          id: "beta",
          title: "Beta",
          createdAt: FIXED_NOW - DAY_MS,
          updatedAt: FIXED_NOW - DAY_MS,
        },
        { id: "unknown", title: "Unknown dates" },
      ]),
    clock,
  );
  const protectedConversationStore =
    input?.protectedConversationStore ??
    new FakeProtectedConversationStore(input?.protectedIds ?? []);
  const dependencies: ManagerDependencies = {
    gateway,
    protectedConversationStore,
    settingsStore: new FakeSettingsStore(60),
    clock,
    destructiveRunLock:
      input?.destructiveRunLock ?? new FakeDestructiveRunLock(),
  };
  const openConversation = vi.fn();
  render(
    <ManagerPage
      mode="demo"
      dependencies={dependencies}
      openConversation={openConversation}
      copyConversationId={() => Promise.resolve()}
    />,
  );
  return { gateway, protectedConversationStore, openConversation };
}

async function waitForInventory(): Promise<void> {
  await screen.findByRole("table", { name: "Standalone conversations" });
}

async function selectConversation(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  await user.click(screen.getByLabelText(`Select ${title}`));
}

async function openConfirmation(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  await selectConversation(user, title);
  await user.click(screen.getByRole("button", { name: "Delete (1)" }));
  await screen.findByText("Delete 1 conversation?");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagerPage destructive flow", () => {
  it("shows lock contention as an operation notice without a fake run", async () => {
    const user = userEvent.setup();
    renderManager({
      destructiveRunLock: new FakeDestructiveRunLock({ active: true }),
    });
    await waitForInventory();
    await openConfirmation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText(
        /Deletion is running in another ChatGPTCleaner tab/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Deletion operation")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Safety status")).not.toBeInTheDocument();
  });

  it("does not create a 0/N run when protected storage fails before execution", async () => {
    const user = userEvent.setup();
    renderManager({
      protectedConversationStore: new FailAfterInitialProtectedStore(),
    });
    await waitForInventory();
    await openConfirmation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText("Protected conversation data is unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Deletion operation")).not.toBeInTheDocument();
    expect(screen.queryByText("0 / 1")).not.toBeInTheDocument();
  });

  it("clears a pre-execution storage blocker only after Refresh revalidates storage", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new FailAfterInitialProtectedStore();
    renderManager({ protectedConversationStore });
    await waitForInventory();
    await openConfirmation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );
    expect(
      await screen.findByText("Protected conversation data is unavailable"),
    ).toBeInTheDocument();

    protectedConversationStore.recover();
    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("Inventory refreshed.");

    expect(
      screen.queryByText("Protected conversation data is unavailable"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Deletion operation")).not.toBeInTheDocument();
    expect(screen.queryByText("Safety status")).not.toBeInTheDocument();
  });
  it("uses a standard confirmation without typed input or inventory reads", async () => {
    const user = userEvent.setup();
    const { gateway } = renderManager();
    await waitForInventory();
    const standaloneReadsAfterInventory = gateway.standalonePageReadCount;
    const projectReadsAfterInventory = gateway.projectDiscoveryReadCount;
    await openConfirmation(user, "Alpha");
    expect(gateway.standalonePageReadCount).toBe(standaloneReadsAfterInventory);
    expect(gateway.projectDiscoveryReadCount).toBe(projectReadsAfterInventory);

    const confirmButton = screen.getByRole("button", {
      name: "Delete 1 conversation",
    });
    expect(
      screen.queryByLabelText("Deletion confirmation"),
    ).not.toBeInTheDocument();
    expect(confirmButton).toBeEnabled();
  });

  it("deletes only the unprotected subset of a mixed selection", async () => {
    const user = userEvent.setup();
    const { gateway } = renderManager({ protectedIds: ["alpha"] });
    await waitForInventory();
    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );

    expect(screen.getByTestId("selected-count")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "Protect (2)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Unprotect (1)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Delete (2)" }));
    expect(
      screen.getByText(
        "3 conversations selected. 1 protected conversation will be skipped. This cannot be undone.",
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Delete 2 conversations" }),
    );

    expect(await screen.findByText("FINISHED")).toBeInTheDocument();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "beta",
      "unknown",
    ]);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("updates the local snapshot after DELETE without refreshing inventory", async () => {
    const user = userEvent.setup();
    const { gateway } = renderManager({
      gatewayFixture: fixture([{ id: "alpha", title: "Alpha" }]),
    });
    await waitForInventory();
    const inventoryReads = {
      safety: gateway.safetyInventoryReadCount,
      standalone: gateway.standalonePageReadCount,
      projects: gateway.projectDiscoveryReadCount,
      projectPages: gateway.projectConversationPageReadCount,
    };

    await openConfirmation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(await screen.findByText("FINISHED")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("standalone-summary")).toHaveTextContent("0");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
    expect(gateway.safetyInventoryReadCount).toBe(inventoryReads.safety);
    expect(gateway.standalonePageReadCount).toBe(inventoryReads.standalone);
    expect(gateway.projectDiscoveryReadCount).toBe(inventoryReads.projects);
    expect(gateway.projectConversationPageReadCount).toBe(
      inventoryReads.projectPages,
    );
  });

  it("applies current local protection when confirming a stale preview", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new DeferredProtectedConversationStore();
    const { gateway } = renderManager({ protectedConversationStore });
    await waitForInventory();
    await selectConversation(user, "Alpha");

    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");
    await user.click(within(alphaRow).getByRole("button", { name: "Protect" }));
    await waitFor(() =>
      expect(protectedConversationStore.pendingSaves).toHaveLength(1),
    );
    await user.click(screen.getByRole("button", { name: "Delete (1)" }));
    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(
        within(alphaRow).getByLabelText("Protected — it will not be deleted."),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText(
        "No confirmed conversations remain eligible for deletion.",
      ),
    ).toBeInTheDocument();
    expect(gateway.deleteAttempts).toEqual([]);
  });

  it("disables mutations while running and supports Pause, Resume, and Stop", async () => {
    const user = userEvent.setup();
    const controlledClock = new FakeClock(0, false);
    renderManager({
      clock: controlledClock,
      gatewayFixture: fixture([
        { id: "alpha", title: "Alpha", updatedAt: 200 },
        { id: "beta", title: "Beta", updatedAt: 100 },
      ]),
    });
    await waitForInventory();
    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete (2)" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 2 conversations" }),
    );

    const pauseButton = await screen.findByRole("button", { name: "Pause" });
    const selectionSection = screen.getByRole("region", { name: "Selection" });
    const deletionSection = screen.getByRole("region", {
      name: "Deletion operation",
    });
    expect(
      within(selectionSection).queryByText("Current deletion run"),
    ).not.toBeInTheDocument();
    expect(
      within(deletionSection).getByRole("button", { name: "Pause" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Delete rate")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh inventory" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Select all results" }),
    ).toBeDisabled();
    const betaRow = screen.getByText("Beta").closest("tr");
    if (betaRow === null) throw new Error("Beta row not found");
    expect(
      within(betaRow).getByRole("button", { name: "Protect" }),
    ).toBeDisabled();

    await user.click(pauseButton);
    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    expect(
      within(betaRow).getByRole("button", { name: "Protect" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Select Beta")).toBeDisabled();
    await user.click(resumeButton);
    await screen.findByRole("button", { name: "Pause" });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText("STOPPED");
    expect(screen.getByLabelText("Select Beta")).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Deletion operation" }),
    ).toBeInTheDocument();
  });

  it("shows failed outcomes and retries only the confirmed failed ID", async () => {
    const user = userEvent.setup();
    const { gateway } = renderManager({
      gatewayFixture: fixture(
        [{ id: "network", title: "Network failure", updatedAt: 100 }],
        { network: [500, 500, 500, 500, 500, "success"] },
      ),
    });
    await waitForInventory();
    await openConfirmation(user, "Network failure");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    const retryButton = await screen.findByRole("button", {
      name: "Retry Failed",
    });
    expect(
      screen.getByRole("button", { name: "Select all results" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Select Network failure")).toBeDisabled();
    expect(screen.getByText("Failed conversations")).toBeInTheDocument();
    expect(screen.getByText("network")).toBeInTheDocument();
    expect(screen.getByText("Network failure")).toBeInTheDocument();
    expect(gateway.deleteAttempts).toHaveLength(5);
    await user.click(retryButton);
    await waitFor(() => expect(gateway.deleteAttempts).toHaveLength(6));
    expect(screen.getByText("FINISHED")).toBeInTheDocument();
    expect(screen.queryByText("Network failure")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select all results" }),
    ).toBeEnabled();
  });

  it("keeps Retry Failed available after contention and clears the stale notice on success", async () => {
    const user = userEvent.setup();
    const sharedLockState = { active: false };
    const { gateway } = renderManager({
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
      gatewayFixture: fixture(
        [{ id: "network", title: "Network failure", updatedAt: 100 }],
        { network: [500, 500, 500, 500, 500, "success"] },
      ),
    });
    await waitForInventory();
    await openConfirmation(user, "Network failure");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );
    await screen.findByRole("button", { name: "Retry Failed" });

    sharedLockState.active = true;
    await user.click(screen.getByRole("button", { name: "Retry Failed" }));

    expect(
      await screen.findByText(
        /Deletion is running in another ChatGPTCleaner tab/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Failed" })).toBeEnabled();
    expect(gateway.deleteAttempts).toHaveLength(5);

    sharedLockState.active = false;
    await user.click(screen.getByRole("button", { name: "Retry Failed" }));

    await waitFor(() => expect(gateway.deleteAttempts).toHaveLength(6));
    expect(screen.getByText("FINISHED")).toBeInTheDocument();
    expect(
      screen.queryByText(/Deletion is running in another ChatGPTCleaner tab/),
    ).not.toBeInTheDocument();
  });

  it("displays a fatal 403 safety stop", async () => {
    const user = userEvent.setup();
    renderManager({
      gatewayFixture: fixture(
        [{ id: "forbidden", title: "Forbidden", updatedAt: 100 }],
        { forbidden: [403] },
      ),
    });
    await waitForInventory();
    await openConfirmation(user, "Forbidden");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText("Deletion stopped for safety"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ChatGPT rejected the deletion request"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reason: Authorization denied/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No deletion has started/),
    ).not.toBeInTheDocument();
  });

  it("keeps a destructive-only blocker and operation history after Refresh", async () => {
    const user = userEvent.setup();
    renderManager({
      gatewayFixture: fixture(
        [{ id: "invalid", title: "Invalid deletion response", updatedAt: 100 }],
        { invalid: [422] },
      ),
    });
    await waitForInventory();
    await openConfirmation(user, "Invalid deletion response");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText("Deletion stopped for safety"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ChatGPT rejected the deletion request"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh inventory" }),
      ).toBeEnabled(),
    );

    expect(
      screen.getByText("ChatGPT rejected the deletion request"),
    ).toBeInTheDocument();
    expect(screen.getByText("Deletion stopped for safety")).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
    expect(
      screen.queryByText(/No deletion has started/),
    ).not.toBeInTheDocument();
  });

  it("shows BLOCKED for malformed inventory", async () => {
    const firstRender = renderManager({
      gatewayFixture: STANDALONE_COMPATIBILITY_FAILURE_FIXTURE,
    });
    expect(
      await screen.findByText("ChatGPT interface is not supported"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    firstRender.gateway.deleteAttempts.length = 0;
  });
});
