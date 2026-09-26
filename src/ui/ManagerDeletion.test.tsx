import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManagerComposition,
  ManagerDependencies,
} from "../composition/types";
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
import type { FakeGatewayFixture } from "../infrastructure/fake/fixtures";
import { ManagerPage } from "./ManagerPage";

const DAY_MS = 86_400_000;
const FIXED_NOW = Date.UTC(2026, 0, 15, 12);

class DeferredProtectedConversationStore implements ProtectedConversationStore {
  public readonly pendingSaves: {
    readonly protectedConversationIds: ReadonlySet<string>;
    readonly resolve: () => void;
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
    return new Promise((resolve) => {
      this.pendingSaves.push({
        protectedConversationIds: savedIds,
        resolve: () => {
          this.storedProtectedConversationIds = savedIds;
          resolve();
        },
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
}

function fixture(
  conversations: readonly Record<string, unknown>[],
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
    destructiveRunLock: new FakeDestructiveRunLock(),
  };
  const openConversation = vi.fn();
  const composition: ManagerComposition = {
    mode: "demo",
    sourceAvailable: true,
    scenarios: [
      { id: "test", label: "Test scenario", description: "Test fixture" },
    ],
    initialScenarioId: "test",
    createDependencies: () => dependencies,
    openConversation,
  };

  render(<ManagerPage composition={composition} />);
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
  await user.click(screen.getByRole("button", { name: "Delete selected (1)" }));
  await screen.findByText("Confirm deletion");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagerPage destructive flow", () => {
  it("requires the exact DELETE N confirmation", async () => {
    const user = userEvent.setup();
    const { gateway } = renderManager();
    await waitForInventory();
    const standaloneReadsAfterInventory = gateway.standalonePageReadCount;
    const projectReadsAfterInventory = gateway.projectDiscoveryReadCount;
    await openConfirmation(user, "Alpha");
    expect(gateway.standalonePageReadCount).toBe(standaloneReadsAfterInventory);
    expect(gateway.projectDiscoveryReadCount).toBe(projectReadsAfterInventory);

    const confirmButton = screen.getByRole("button", { name: "Delete 1" });
    expect(confirmButton).toBeDisabled();
    await user.type(screen.getByLabelText("Deletion confirmation"), "delete 1");
    expect(confirmButton).toBeDisabled();
    await user.clear(screen.getByLabelText("Deletion confirmation"));
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 1");
    expect(confirmButton).toBeEnabled();
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
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 1");
    await user.click(screen.getByRole("button", { name: "Delete 1" }));

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
    await user.click(
      screen.getByRole("button", { name: "Delete selected (1)" }),
    );
    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(within(alphaRow).getByText("Protected")).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 1");
    await user.click(screen.getByRole("button", { name: "Delete 1" }));

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
      screen.getByRole("button", { name: "Select all matching" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete selected (2)" }),
    );
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 2");
    await user.click(screen.getByRole("button", { name: "Delete 2" }));

    const pauseButton = await screen.findByRole("button", { name: "Pause" });
    expect(screen.getByLabelText("Requests per minute")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh inventory" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Select all matching" }),
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
    ).toBeEnabled();
    await user.click(resumeButton);
    await screen.findByRole("button", { name: "Pause" });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText("STOPPED");
  });

  it("keeps Resume disabled until a paused protection write completes", async () => {
    const user = userEvent.setup();
    const controlledClock = new FakeClock(0, false);
    const protectedConversationStore = new DeferredProtectedConversationStore();
    const { gateway } = renderManager({
      clock: controlledClock,
      protectedConversationStore,
      gatewayFixture: fixture([
        { id: "alpha", title: "Alpha", updatedAt: 200 },
        { id: "beta", title: "Beta", updatedAt: 100 },
      ]),
    });
    await waitForInventory();
    await user.click(
      screen.getByRole("button", { name: "Select all matching" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete selected (2)" }),
    );
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 2");
    await user.click(screen.getByRole("button", { name: "Delete 2" }));

    await user.click(await screen.findByRole("button", { name: "Pause" }));
    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    const betaRow = screen.getByText("Beta").closest("tr");
    if (betaRow === null) throw new Error("Beta row not found");
    await user.click(within(betaRow).getByRole("button", { name: "Protect" }));

    await waitFor(() =>
      expect(protectedConversationStore.pendingSaves).toHaveLength(1),
    );
    expect(resumeButton).toBeDisabled();
    await user.click(resumeButton);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["alpha"]);

    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(within(betaRow).getByText("Protected")).toBeInTheDocument(),
    );
    const enabledResumeButton = screen.getByRole("button", { name: "Resume" });
    expect(enabledResumeButton).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText("STOPPED");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["alpha"]);
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
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 1");
    await user.click(screen.getByRole("button", { name: "Delete 1" }));

    const retryButton = await screen.findByRole("button", {
      name: "Retry Failed",
    });
    expect(screen.getByText("Failed conversations")).toBeInTheDocument();
    expect(screen.getAllByText("network")).toHaveLength(2);
    expect(screen.getByText("Network failure")).toBeInTheDocument();
    expect(gateway.deleteAttempts).toHaveLength(5);
    await user.click(retryButton);
    await waitFor(() => expect(gateway.deleteAttempts).toHaveLength(6));
    expect(screen.getByText("FINISHED")).toBeInTheDocument();
    expect(screen.queryByText("Network failure")).not.toBeInTheDocument();
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
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 1");
    await user.click(screen.getByRole("button", { name: "Delete 1" }));

    expect(
      await screen.findByText("Deletion stopped for safety"),
    ).toBeInTheDocument();
    expect(screen.getByText("Authorization denied")).toBeInTheDocument();
  });

  it("shows BLOCKED for malformed inventory", async () => {
    const malformed = fixture([{ title: "Missing ID" }]);
    const firstRender = renderManager({ gatewayFixture: malformed });
    expect(
      await screen.findByText("Read API compatibility failed"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("BLOCKED").length).toBeGreaterThan(0);

    firstRender.gateway.deleteAttempts.length = 0;
  });
});
