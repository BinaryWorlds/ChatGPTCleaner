import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerDependencies } from "../../composition/types";
import type {
  DestructiveRunLock,
  LockResult,
} from "../../application/ports/DestructiveRunLock";
import type {
  DeleteAttemptEvents,
  DeleteAttemptResult,
} from "../../application/ports/ConversationGateway";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../../application/ports/ProtectedConversationStore";
import type {
  SourceTabLifecycle,
  SourceTabValidationResult,
} from "../../application/ports/SourceTabLifecycle";
import { FakeClock } from "../../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../../infrastructure/fake/FakeStores";
import {
  STANDALONE_COMPATIBILITY_FAILURE_FIXTURE,
  type FakeConversationFixture,
  type FakeGatewayFixture,
} from "../../infrastructure/fake/fixtures";
import ManagerPage from ".";

const DAY_MS = 86_400_000;
const FIXED_NOW = Date.UTC(2026, 0, 15, 12);

class FakeSourceTabLifecycle implements SourceTabLifecycle {
  private valid = true;
  private listener: (() => void) | null = null;

  public validate(): Promise<SourceTabValidationResult> {
    return Promise.resolve(
      this.valid ? { kind: "valid", tabId: 42 } : { kind: "invalid" },
    );
  }

  public subscribe(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  public loseSource(): void {
    this.valid = false;
    this.listener?.();
  }
}

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

class DeferredSchedulingSettingsStore extends FakeSettingsStore {
  private completeRateSave: (() => Promise<void>) | null = null;
  private completeConcurrencySave: (() => Promise<void>) | null = null;

  public override saveRequestsPerMinute(
    requestsPerMinute: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.completeRateSave = async () => {
        await super.saveRequestsPerMinute(requestsPerMinute);
        resolve();
      };
    });
  }

  public override saveMaximumConcurrentDeleteRequests(
    maximumConcurrentDeleteRequests: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.completeConcurrencySave = async () => {
        await super.saveMaximumConcurrentDeleteRequests(
          maximumConcurrentDeleteRequests,
        );
        resolve();
      };
    });
  }

  public hasPendingSaves(): boolean {
    return (
      this.completeRateSave !== null && this.completeConcurrencySave !== null
    );
  }

  public async completePendingSaves(): Promise<void> {
    const completeRateSave = this.completeRateSave;
    const completeConcurrencySave = this.completeConcurrencySave;
    if (completeRateSave === null || completeConcurrencySave === null) {
      throw new Error("Scheduling settings saves are not pending");
    }
    this.completeRateSave = null;
    this.completeConcurrencySave = null;
    await Promise.all([completeRateSave(), completeConcurrencySave()]);
  }
}

class SlowReportingConversationGateway extends FakeConversationGateway {
  public override deleteConversation(
    conversationId: string,
    events?: DeleteAttemptEvents,
  ): Promise<DeleteAttemptResult> {
    events?.onResponseSlow();
    return super.deleteConversation(conversationId);
  }
}

class DeferredRetryConversationGateway extends FakeConversationGateway {
  private attemptCount = 0;
  private completePendingRetry: (() => void) | null = null;

  public override deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    this.attemptCount += 1;
    const result = super.deleteConversation(conversationId);
    if (this.attemptCount !== 6) return result;

    return new Promise((resolve, reject) => {
      this.completePendingRetry = () => {
        result.then(resolve, reject);
      };
    });
  }

  public completeRetry(): void {
    const completePendingRetry = this.completePendingRetry;
    if (completePendingRetry === null) throw new Error("No pending retry");
    this.completePendingRetry = null;
    completePendingRetry();
  }
}

class DeferredDrainConversationGateway extends FakeConversationGateway {
  public readonly startedConversationIds: string[] = [];
  private readonly pendingAttempts = new Map<string, () => void>();

  public override deleteConversation(
    conversationId: string,
  ): Promise<DeleteAttemptResult> {
    this.startedConversationIds.push(conversationId);
    return new Promise((resolve, reject) => {
      this.pendingAttempts.set(conversationId, () => {
        this.pendingAttempts.delete(conversationId);
        super.deleteConversation(conversationId).then(resolve, reject);
      });
    });
  }

  public complete(conversationId: string): void {
    const completePendingAttempt = this.pendingAttempts.get(conversationId);
    if (completePendingAttempt === undefined) {
      throw new Error(`No pending ${conversationId} deletion`);
    }
    completePendingAttempt();
  }
}

class DeferredResumeProtectedConversationStore implements ProtectedConversationStore {
  public loadCount = 0;
  private resolvePendingLoad: (() => void) | null = null;

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    this.loadCount += 1;
    if (this.loadCount !== 3) {
      return Promise.resolve({
        kind: "success",
        protectedConversationIds: new Set(),
      });
    }
    return new Promise((resolve) => {
      this.resolvePendingLoad = () => {
        resolve({
          kind: "success",
          protectedConversationIds: new Set(),
        });
      };
    });
  }

  public saveProtectedConversationIds(): Promise<void> {
    return Promise.resolve();
  }

  public completeResumePreflight(): void {
    const resolvePendingLoad = this.resolvePendingLoad;
    if (resolvePendingLoad === null) throw new Error("No pending resume load");
    this.resolvePendingLoad = null;
    resolvePendingLoad();
  }
}

class DeferredSecondDestructiveRunLock implements DestructiveRunLock {
  public acquisitionCount = 0;
  private readonly secondAcquisition: Promise<void>;
  private releaseSecond: () => void = () => undefined;

  public constructor() {
    this.secondAcquisition = new Promise((resolve) => {
      this.releaseSecond = resolve;
    });
  }

  public async runExclusive<T>(work: () => Promise<T>): Promise<LockResult<T>> {
    this.acquisitionCount += 1;
    if (this.acquisitionCount === 2) await this.secondAcquisition;
    return { kind: "acquired", value: await work() };
  }

  public releaseSecondAcquisition(): void {
    this.releaseSecond();
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
  readonly gateway?: FakeConversationGateway;
  readonly protectedIds?: readonly string[];
  readonly protectedConversationStore?: ProtectedConversationStore;
  readonly clock?: FakeClock;
  readonly destructiveRunLock?: DestructiveRunLock;
  readonly sourceTabLifecycle?: SourceTabLifecycle;
  readonly settingsStore?: FakeSettingsStore;
}) {
  const clock = input?.clock ?? new FakeClock(FIXED_NOW);
  const gateway =
    input?.gateway ??
    new FakeConversationGateway(
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
  const settingsStore = input?.settingsStore ?? new FakeSettingsStore(60);
  const dependencies: ManagerDependencies = {
    gateway,
    protectedConversationStore,
    settingsStore,
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
      {...(input?.sourceTabLifecycle === undefined
        ? {}
        : { sourceTabLifecycle: input.sourceTabLifecycle })}
    />,
  );
  return {
    gateway,
    protectedConversationStore,
    settingsStore,
    openConversation,
  };
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
    expect(screen.queryByText("Conversation deletion")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Conversation deletion")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed 0 of 1")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Conversation deletion")).not.toBeInTheDocument();
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

    expect(await screen.findByText("Completed")).toBeInTheDocument();
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

    expect(await screen.findByText("Completed")).toBeInTheDocument();
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

  it("replaces a previous slow notice while the next confirmed run awaits preflight", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(FIXED_NOW);
    const gateway = new SlowReportingConversationGateway(
      fixture([
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
      ]),
      clock,
    );
    const destructiveRunLock = new DeferredSecondDestructiveRunLock();
    renderManager({ clock, gateway, destructiveRunLock });
    await waitForInventory();

    await openConfirmation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(
      screen.getByText("ChatGPT responded slowly during deletion."),
    ).toBeInTheDocument();

    await openConfirmation(user, "Beta");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText(
        "Checking protection and acquiring the deletion lock…",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Completed 0 of 0")).not.toBeInTheDocument();
    expect(
      screen.queryByText("ChatGPT responded slowly during deletion."),
    ).not.toBeInTheDocument();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["alpha"]);
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh inventory" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Select Beta")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete (1)" })).toBeDisabled();

    destructiveRunLock.releaseSecondAcquisition();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("clears a previous slow notice when the next confirmed run becomes empty during protection preflight", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(FIXED_NOW);
    const gateway = new SlowReportingConversationGateway(
      fixture([
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
      ]),
      clock,
    );
    const protectedConversationStore = new FakeProtectedConversationStore();
    renderManager({ clock, gateway, protectedConversationStore });
    await waitForInventory();

    await openConfirmation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(
      screen.getByText("ChatGPT responded slowly during deletion."),
    ).toBeInTheDocument();
    await protectedConversationStore.saveProtectedConversationIds(
      new Set(["beta"]),
    );

    await openConfirmation(user, "Beta");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText(
        "No confirmed conversations remain eligible for deletion.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("ChatGPT responded slowly during deletion."),
    ).not.toBeInTheDocument();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["alpha"]);
  });

  it("disables mutations while running and supports Pause, Resume, and Stop", async () => {
    const user = userEvent.setup();
    const controlledClock = new FakeClock(0, false);
    const settingsStore = new FakeSettingsStore(75, 2);
    renderManager({
      clock: controlledClock,
      settingsStore,
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
      name: /Conversation deletion/,
    });
    expect(
      within(selectionSection).queryByText("Current deletion run"),
    ).not.toBeInTheDocument();
    expect(within(deletionSection).getAllByRole("heading")).toHaveLength(1);
    expect(
      within(deletionSection).getByRole("button", { name: "Pause" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
    expect(screen.queryByTestId("current-state-strip")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();
    expect(screen.getByLabelText("Deletion rate")).toHaveValue("75");
    expect(screen.getByLabelText("Chats at once")).toHaveValue("2");
    await user.type(screen.getByLabelText("Deletion rate"), "90");
    await user.type(screen.getByLabelText("Chats at once"), "3");
    expect(settingsStore.savedValues).toEqual([]);
    expect(settingsStore.savedMaximumConcurrentDeleteRequests).toEqual([]);
    expect(screen.getByLabelText("Deletion rate")).toHaveValue("75");
    expect(screen.getByLabelText("Chats at once")).toHaveValue("2");
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
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();
    expect(
      within(betaRow).getByRole("button", { name: "Protect" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Select Beta")).toBeDisabled();
    await user.click(resumeButton);
    await screen.findByRole("button", { name: "Pause" });
    await user.click(
      within(deletionSection).getByRole("button", { name: "Stop" }),
    );
    await screen.findByText("STOPPED");
    expect(screen.getByLabelText("Deletion rate")).toBeEnabled();
    expect(screen.getByLabelText("Chats at once")).toBeEnabled();
    expect(screen.getByLabelText("Select Beta")).toBeEnabled();
    expect(
      screen.getByRole("region", { name: /Conversation deletion/ }),
    ).toBeInTheDocument();
  });

  it("shows captured run settings when pending preference saves settle during ownership", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(0, false);
    const settingsStore = new DeferredSchedulingSettingsStore(60, 1);
    renderManager({
      clock,
      settingsStore,
      gatewayFixture: fixture([
        { id: "alpha", title: "Alpha", updatedAt: 200 },
        { id: "beta", title: "Beta", updatedAt: 100 },
      ]),
    });
    await waitForInventory();

    fireEvent.change(screen.getByLabelText("Deletion rate"), {
      target: { value: "75" },
    });
    fireEvent.change(screen.getByLabelText("Chats at once"), {
      target: { value: "2" },
    });
    await waitFor(() => expect(settingsStore.hasPendingSaves()).toBe(true));

    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete (2)" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 2 conversations" }),
    );
    await screen.findByRole("button", { name: "Pause" });
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();

    await act(() => settingsStore.completePendingSaves());
    expect(screen.getByLabelText("Deletion rate")).toHaveValue("60");
    expect(screen.getByLabelText("Chats at once")).toHaveValue("1");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText("STOPPED");
    expect(screen.getByLabelText("Deletion rate")).toBeEnabled();
    expect(screen.getByLabelText("Chats at once")).toBeEnabled();
    expect(screen.getByLabelText("Deletion rate")).toHaveValue("75");
    expect(screen.getByLabelText("Chats at once")).toHaveValue("2");
  });

  it("shows and owns Resume preflight until the protection check resolves", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(0, false);
    const protectedConversationStore =
      new DeferredResumeProtectedConversationStore();
    renderManager({
      clock,
      protectedConversationStore,
      gatewayFixture: fixture([
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
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
    await user.click(await screen.findByRole("button", { name: "Pause" }));

    const resumeButton = await screen.findByRole("button", { name: "Resume" });
    await user.click(resumeButton);
    expect(await screen.findByText("Preparing to resume")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(protectedConversationStore.loadCount).toBe(3);

    protectedConversationStore.completeResumePreflight();
    await screen.findByRole("button", { name: "Pause" });
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
      screen.getAllByRole("button", { name: "Retry Failed" }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();
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
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Network failure")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select all results" }),
    ).toBeEnabled();
  });

  it("shows pending Retry Failed ownership and the retry execution context", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(FIXED_NOW);
    const gateway = new DeferredRetryConversationGateway(
      fixture([{ id: "network", title: "Network failure", updatedAt: 100 }], {
        network: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const destructiveRunLock = new DeferredSecondDestructiveRunLock();
    const settingsStore = new FakeSettingsStore(75, 2);
    renderManager({ clock, gateway, destructiveRunLock, settingsStore });
    await waitForInventory();
    await openConfirmation(user, "Network failure");
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Retry Failed" }),
    );
    expect(
      await screen.findByText("Preparing failed retry"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();
    expect(screen.getByLabelText("Deletion rate")).toHaveValue("75");
    expect(screen.getByLabelText("Chats at once")).toHaveValue("2");
    await user.type(screen.getByLabelText("Deletion rate"), "90");
    await user.type(screen.getByLabelText("Chats at once"), "3");
    expect(settingsStore.savedValues).toEqual([]);
    expect(settingsStore.savedMaximumConcurrentDeleteRequests).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Retry Failed/ }));
    expect(destructiveRunLock.acquisitionCount).toBe(2);
    expect(gateway.deleteAttempts).toHaveLength(5);

    destructiveRunLock.releaseSecondAcquisition();
    expect(
      await screen.findByText("Retrying failed conversations"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toHaveValue("75");
    expect(screen.getByLabelText("Chats at once")).toHaveValue("2");
    expect(screen.getByText("Completed 0 of 1")).toBeInTheDocument();
    gateway.completeRetry();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeEnabled();
    expect(screen.getByLabelText("Chats at once")).toBeEnabled();
  });

  it("keeps settings locked while Stop drains active operations", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDrainConversationGateway(
      fixture([
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
      ]),
      clock,
    );
    renderManager({
      clock,
      gateway,
      settingsStore: new FakeSettingsStore(120, 2),
    });
    await waitForInventory();
    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete (2)" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 2 conversations" }),
    );
    await waitFor(() =>
      expect(gateway.startedConversationIds).toEqual(["alpha"]),
    );
    await act(async () => {
      clock.advanceBy(500);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(gateway.startedConversationIds).toEqual(["alpha", "beta"]),
    );

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("STOPPING")).toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();

    act(() => gateway.complete("alpha"));
    await waitFor(() =>
      expect(screen.getByText("In progress").parentElement).toHaveTextContent(
        "1",
      ),
    );
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();

    act(() => gateway.complete("beta"));
    expect(await screen.findByText("STOPPED")).toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeEnabled();
    expect(screen.getByLabelText("Chats at once")).toBeEnabled();
  });

  it("keeps settings locked while a fatal result drains active operations", async () => {
    const user = userEvent.setup();
    const clock = new FakeClock(0, false);
    const gateway = new DeferredDrainConversationGateway(
      fixture(
        [
          { id: "alpha", title: "Alpha" },
          { id: "beta", title: "Beta" },
        ],
        { alpha: [403] },
      ),
      clock,
    );
    renderManager({
      clock,
      gateway,
      settingsStore: new FakeSettingsStore(120, 2),
    });
    await waitForInventory();
    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete (2)" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 2 conversations" }),
    );
    await waitFor(() =>
      expect(gateway.startedConversationIds).toEqual(["alpha"]),
    );
    await act(async () => {
      clock.advanceBy(500);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(gateway.startedConversationIds).toEqual(["alpha", "beta"]),
    );

    act(() => gateway.complete("alpha"));
    await waitFor(() =>
      expect(screen.getByText("In progress").parentElement).toHaveTextContent(
        "1",
      ),
    );
    expect(screen.queryByText("FATAL")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeDisabled();
    expect(screen.getByLabelText("Chats at once")).toBeDisabled();

    act(() => gateway.complete("beta"));
    expect(await screen.findByText("FATAL")).toBeInTheDocument();
    expect(screen.getByLabelText("Deletion rate")).toBeEnabled();
    expect(screen.getByLabelText("Chats at once")).toBeEnabled();
  });

  it("blocks Retry Failed when canonical deletion availability becomes blocked", async () => {
    const user = userEvent.setup();
    const sourceTabLifecycle = new FakeSourceTabLifecycle();
    const { gateway } = renderManager({
      sourceTabLifecycle,
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

    expect(
      await screen.findByRole("button", { name: "Retry Failed" }),
    ).toBeEnabled();
    expect(gateway.deleteAttempts).toHaveLength(5);

    sourceTabLifecycle.loseSource();

    expect(await screen.findByTestId("current-state-strip")).toHaveTextContent(
      "ChatGPT source tab is unavailable",
    );
    const blockedRetryButton = screen.getByRole("button", {
      name: "Retry Failed",
    });
    expect(blockedRetryButton).toBeDisabled();
    await user.click(blockedRetryButton);
    expect(gateway.deleteAttempts).toHaveLength(5);
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
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry Failed" }),
      ).toBeEnabled(),
    );
    expect(gateway.deleteAttempts).toHaveLength(5);

    sharedLockState.active = false;
    await user.click(screen.getByRole("button", { name: "Retry Failed" }));

    await waitFor(() => expect(gateway.deleteAttempts).toHaveLength(6));
    expect(screen.getByText("Completed")).toBeInTheDocument();
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

    const currentStateStrip = await screen.findByTestId("current-state-strip");
    expect(currentStateStrip).toHaveTextContent(
      "ChatGPT rejected the deletion request",
    );
    expect(
      screen.queryByText("Deletion stopped for safety"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /Conversation deletion/ }),
    ).toHaveTextContent("FATAL");
    expect(
      screen.queryByText(/No deletion has started/),
    ).not.toBeInTheDocument();
  });

  it("does not expose or execute Retry Failed after an earlier failure and fatal stop", async () => {
    const user = userEvent.setup();
    const { gateway } = renderManager({
      gatewayFixture: fixture(
        [
          { id: "failed", title: "Failed first", updatedAt: 200 },
          { id: "fatal", title: "Fatal second", updatedAt: 100 },
        ],
        {
          failed: [500, 500, 500, 500, 500, "success"],
          fatal: [403],
        },
      ),
    });
    await waitForInventory();
    await selectConversation(user, "Failed first");
    await selectConversation(user, "Fatal second");
    await user.click(screen.getByRole("button", { name: "Delete (2)" }));
    await user.click(
      await screen.findByRole("button", { name: "Delete 2 conversations" }),
    );

    expect(
      await screen.findByText("Reason: Authorization denied"),
    ).toBeInTheDocument();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "failed",
      "failed",
      "fatal",
    ]);
    expect(
      screen.queryByRole("button", { name: "Retry Failed" }),
    ).not.toBeInTheDocument();

    await Promise.resolve();
    expect(gateway.deleteAttempts).toHaveLength(3);
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

    expect(await screen.findByTestId("current-state-strip")).toHaveTextContent(
      "ChatGPT rejected the deletion request",
    );
    expect(screen.getByText("Completed 0 of 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh inventory" }),
      ).toBeEnabled(),
    );

    expect(screen.getByTestId("current-state-strip")).toHaveTextContent(
      "ChatGPT rejected the deletion request",
    );
    expect(
      screen.queryByText("Deletion stopped for safety"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Completed 0 of 1")).toBeInTheDocument();
    expect(
      screen.queryByText(/No deletion has started/),
    ).not.toBeInTheDocument();
  });

  it("shows BLOCKED for malformed inventory", async () => {
    renderManager({
      gatewayFixture: STANDALONE_COMPATIBILITY_FAILURE_FIXTURE,
    });
    expect(
      await screen.findByText("ChatGPT interface is not supported"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
