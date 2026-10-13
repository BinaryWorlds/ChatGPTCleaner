import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerDependencies } from "composition/types";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "application/ports/ProtectedConversationStore";
import type {
  ConversationPage,
  ReadResult,
} from "application/ports/ConversationGateway";
import { FakeClock } from "infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "infrastructure/fake/FakeStores";
import type {
  FakeConversationFixture,
  FakeConversationPageResult,
  FakeGatewayFixture,
} from "infrastructure/fake/fixtures";
import ManagerPage from ".";
import type {
  SourceTabLifecycle,
  SourceTabValidationResult,
} from "application/ports/SourceTabLifecycle";

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
  public loadCount = 0;

  public readonly pendingSaves: {
    readonly protectedConversationIds: ReadonlySet<string>;
    readonly resolve: () => void;
  }[] = [];

  private storedProtectedConversationIds: ReadonlySet<string>;
  private loadFailure: "invalid" | "unreadable" | null = null;

  public constructor(initialIds: readonly string[] = []) {
    this.storedProtectedConversationIds = new Set(initialIds);
  }

  public loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult> {
    this.loadCount += 1;
    if (this.loadFailure === "invalid") {
      return Promise.resolve({ kind: "invalid" });
    }
    if (this.loadFailure === "unreadable") {
      return Promise.reject(new Error("Storage unavailable"));
    }
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

  public replaceCanonicalIds(
    protectedConversationIds: readonly string[],
  ): void {
    this.storedProtectedConversationIds = new Set(protectedConversationIds);
    this.loadFailure = null;
  }

  public makeCanonicalIdsInvalid(): void {
    this.loadFailure = "invalid";
  }

  public makeCanonicalIdsUnreadable(): void {
    this.loadFailure = "unreadable";
  }
}

class DeferredRefreshGateway extends FakeConversationGateway {
  private resolveRefreshStart: (() => void) | null = null;

  public override beginSafetyInventoryRead(): Promise<ReadResult<null>> {
    const result = super.beginSafetyInventoryRead();
    if (this.safetyInventoryReadCount === 1) return result;
    return new Promise((resolve) => {
      this.resolveRefreshStart = () =>
        resolve({ kind: "success", value: null });
    });
  }

  public continueRefresh(): void {
    if (this.resolveRefreshStart === null) {
      throw new Error("No pending Refresh inventory read");
    }
    this.resolveRefreshStart();
    this.resolveRefreshStart = null;
  }
}

class PendingStandalonePageGateway extends FakeConversationGateway {
  public override fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    if (cursor === null) return super.fetchStandaloneConversationPage(cursor);
    return new Promise(() => undefined);
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

function fixtureWithProjects(input?: {
  readonly projectConversations?: readonly FakeConversationFixture[];
}): FakeGatewayFixture {
  return {
    standalonePages: {
      first: {
        conversations: [
          { id: "standalone", title: "Standalone row", updatedAt: 300 },
          { id: "overlap", title: "Standalone overlap", updatedAt: 200 },
        ],
        nextCursor: null,
      },
    },
    projects: [{ id: "project-one" }],
    projectConversationPages: {
      "project-one:first": {
        conversations: input?.projectConversations ?? [
          {
            id: "overlap",
            title: "Project overlap",
            updatedAt: FIXED_NOW - DAY_MS,
          },
          {
            id: "project-chat",
            title: "Project planning",
            createdAt: FIXED_NOW - 20 * DAY_MS,
            updatedAt: FIXED_NOW - 10 * DAY_MS,
          },
        ],
        nextCursor: null,
      },
    },
  };
}

function renderManager(input?: {
  readonly gatewayFixture?: FakeGatewayFixture;
  readonly gateway?: FakeConversationGateway;
  readonly protectedIds?: readonly string[];
  readonly protectedConversationStore?: ProtectedConversationStore;
  readonly settingsStore?: FakeSettingsStore;
  readonly clock?: FakeClock;
  readonly copyConversationId?: (conversationId: string) => Promise<void>;
  readonly sourceTabLifecycle?: SourceTabLifecycle;
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
    destructiveRunLock: new FakeDestructiveRunLock(),
  };
  const openConversation = vi.fn();
  const copyConversationId =
    input?.copyConversationId ?? vi.fn(() => Promise.resolve());
  render(
    <ManagerPage
      mode="demo"
      dependencies={dependencies}
      openConversation={openConversation}
      copyConversationId={copyConversationId}
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
    copyConversationId,
  };
}

async function waitForInventory(): Promise<void> {
  await screen.findByRole("table", { name: "Standalone conversations" });
}

function conversationRows(): HTMLElement[] {
  return within(screen.getByTestId("conversation-table"))
    .getAllByRole("row")
    .slice(1);
}

function expectConversationOrder(...titles: readonly string[]): void {
  const rows = conversationRows();
  expect(rows).toHaveLength(titles.length);
  titles.forEach((title, index) =>
    expect(rows[index]).toHaveTextContent(title),
  );
}

async function selectConversation(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  await user.click(screen.getByLabelText(`Select ${title}`));
}

async function showProjectConversations(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const input = screen.getByRole("radio", { name: "Project conversations" });
  const label = input.closest("label");
  if (label === null) throw new Error("Project view label not found");
  await user.click(label);
}

async function applyDatePreset(
  user: ReturnType<typeof userEvent.setup>,
  presetLabel: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Date" }));
  const dialog = await screen.findByRole("dialog", { name: "Date" });
  await user.click(within(dialog).getByRole("radio", { name: presetLabel }));
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagerPage inventory controls", () => {
  it("explains and persists both deletion scheduling inputs independently", async () => {
    const settingsStore = new FakeSettingsStore(60, 2);
    renderManager({ settingsStore });
    await waitForInventory();
    expect(
      screen.queryByRole("region", { name: "Conversation deletion" }),
    ).not.toBeInTheDocument();

    const rateInput = screen.getByLabelText("Deletion rate");
    const concurrencyInput = screen.getByLabelText("Chats at once");
    expect(rateInput).toHaveValue("60");
    expect(concurrencyInput).toHaveValue("2");
    expect(screen.getByText("/min")).toBeInTheDocument();

    fireEvent.focus(screen.getByLabelText("About deletion rate"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Maximum deletion attempts per minute, including retries. Default: 60.",
    );
    fireEvent.focus(screen.getByLabelText("About chats at once"));
    expect(
      await screen.findByText(
        "How many chats can be deleted at the same time. Deletions start at the configured rate. Default: 10.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(rateInput, { target: { value: "75" } });
    await waitFor(() => expect(settingsStore.savedValues).toEqual([75]));
    expect(rateInput).toHaveValue("75");
    fireEvent.change(concurrencyInput, { target: { value: "20" } });
    await waitFor(() =>
      expect(settingsStore.savedMaximumConcurrentDeleteRequests).toEqual([20]),
    );
    expect(concurrencyInput).toHaveValue("20");
  });

  it("labels the loading value as a conversation count", async () => {
    const conversations = Array.from({ length: 100 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `Conversation ${index}`,
    }));
    const gateway = new PendingStandalonePageGateway(
      {
        standalonePages: {
          first: { conversations, nextCursor: "100" },
        },
        projects: [],
        projectConversationPages: {},
      },
      new FakeClock(FIXED_NOW),
    );

    renderManager({ gateway });

    expect(
      await screen.findByText(
        "Loading conversations… 100 conversations loaded",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Inventory: Loading 100"),
    ).not.toBeInTheDocument();
  });

  it("cycles sort directions and switches sortable columns", async () => {
    const user = userEvent.setup();
    renderManager();
    await waitForInventory();
    const updatedHeader = screen.getByRole("columnheader", {
      name: "Updated",
    });
    const titleHeader = screen.getByRole("columnheader", { name: "Title" });
    const createdHeader = screen.getByRole("columnheader", {
      name: "Created",
    });

    expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
    expectConversationOrder("Beta", "Alpha", "Unknown dates");

    await user.click(updatedHeader);
    expect(updatedHeader).toHaveAttribute("aria-sort", "ascending");
    expectConversationOrder("Alpha", "Beta", "Unknown dates");

    await user.click(updatedHeader);
    expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
    expectConversationOrder("Beta", "Alpha", "Unknown dates");

    await user.click(updatedHeader);
    expect(updatedHeader).toHaveAttribute("aria-sort", "ascending");
    expectConversationOrder("Alpha", "Beta", "Unknown dates");

    await user.click(updatedHeader);
    expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
    expectConversationOrder("Beta", "Alpha", "Unknown dates");

    await user.click(titleHeader);
    expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    expect(createdHeader).not.toHaveAttribute("aria-sort");

    await user.click(createdHeader);
    expect(createdHeader).toHaveAttribute("aria-sort", "ascending");
    expect(titleHeader).not.toHaveAttribute("aria-sort");

    await user.click(titleHeader);
    expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    expect(createdHeader).not.toHaveAttribute("aria-sort");
  });

  it("sorts and filters Project conversation metadata", async () => {
    const user = userEvent.setup();
    renderManager({ gatewayFixture: fixtureWithProjects() });
    await waitForInventory();
    await showProjectConversations(user);
    const updatedHeader = screen.getByRole("columnheader", {
      name: "Updated",
    });

    expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
    expectConversationOrder("Project overlap", "Project planning");

    await user.click(updatedHeader);
    expect(updatedHeader).toHaveAttribute("aria-sort", "ascending");
    expectConversationOrder("Project planning", "Project overlap");

    await user.click(updatedHeader);
    expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
    expectConversationOrder("Project overlap", "Project planning");

    await user.type(screen.getByLabelText("Search titles"), "planning");
    expect(screen.getByText("Project planning")).toBeInTheDocument();
    expect(screen.queryByText("Project overlap")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    const titleHeader = screen.getByRole("columnheader", { name: /Title/ });
    await user.click(titleHeader);
    expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    expectConversationOrder("Project overlap", "Project planning");
  });

  it("atomically replaces the snapshot and clears selection after Refresh", async () => {
    const user = userEvent.setup();
    const gatewayFixture = fixture([{ id: "alpha", title: "Alpha" }]);
    const gateway = new DeferredRefreshGateway(
      gatewayFixture,
      new FakeClock(FIXED_NOW),
    );
    const protectedConversationStore = new FakeProtectedConversationStore();
    const saveProtection = vi.spyOn(
      protectedConversationStore,
      "saveProtectedConversationIds",
    );
    const settingsStore = new FakeSettingsStore(60);
    const loadSettings = vi.spyOn(settingsStore, "loadRequestsPerMinute");
    renderManager({ gateway, protectedConversationStore, settingsStore });
    await waitForInventory();
    await selectConversation(user, "Alpha");
    await user.click(screen.getByRole("button", { name: "Delete (1)" }));
    expect(screen.getByText("Delete 1 conversation?")).toBeInTheDocument();

    (
      gatewayFixture.standalonePages as Record<
        string,
        FakeConversationPageResult
      >
    ).first = {
      conversations: [{ id: "fresh", title: "Fresh snapshot" }],
      nextCursor: null,
    };
    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));

    const refreshStatus = screen.getByText(/Refreshing inventory/);
    const refreshButton = screen.getByRole("button", {
      name: "Refresh inventory",
    });
    const languageControl = screen.getByRole("radiogroup", {
      name: "Language",
    });
    const themeControl = screen.getByRole("radiogroup", {
      name: "Theme preference",
    });
    const controls = refreshButton.closest(".manager-header-controls");
    const statusRegion = refreshStatus.closest(".manager-header-status");

    expect(statusRegion).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(statusRegion?.nextElementSibling).toBe(controls);
    expect(Array.from(controls?.children ?? [])).toEqual([
      refreshButton,
      languageControl,
      themeControl,
    ]);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Fresh snapshot")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    ).toBeDisabled();
    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");
    const protectButton = within(alphaRow).getByRole("button", {
      name: "Protect",
    });
    expect(protectButton).toBeDisabled();
    fireEvent.click(protectButton);
    expect(saveProtection).not.toHaveBeenCalled();

    gateway.continueRefresh();
    expect(await screen.findByText("Fresh snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Delete 1 conversation?"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
    expect(gateway.safetyInventoryReadCount).toBe(2);
    expect(gateway.standalonePageReadCount).toBe(2);
    expect(gateway.projectDiscoveryReadCount).toBe(2);
    expect(protectedConversationStore.loadCount).toBe(2);
    expect(loadSettings).toHaveBeenCalledOnce();
  });

  it("refreshes the in-memory protection state from canonical storage", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new DeferredProtectedConversationStore();
    renderManager({ protectedConversationStore });
    await waitForInventory();

    protectedConversationStore.replaceCanonicalIds(["alpha"]);
    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("Inventory refreshed.");

    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");
    expect(
      within(alphaRow).getByLabelText("Protected — it will not be deleted."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("protected-summary")).toHaveTextContent("1");

    await selectConversation(user, "Alpha");
    expect(screen.getByRole("button", { name: "Delete (0)" })).toBeDisabled();
    expect(protectedConversationStore.loadCount).toBe(2);
  });

  it.each(["invalid", "unreadable"] as const)(
    "rejects a Refresh candidate when protected storage is %s and recovers after repair",
    async (failureKind) => {
      const user = userEvent.setup();
      const gatewayFixture = fixture([{ id: "alpha", title: "Alpha" }]);
      const protectedConversationStore =
        new DeferredProtectedConversationStore();
      const { gateway } = renderManager({
        gatewayFixture,
        protectedConversationStore,
      });
      await waitForInventory();
      await selectConversation(user, "Alpha");

      (
        gatewayFixture.standalonePages as Record<
          string,
          FakeConversationPageResult
        >
      ).first = {
        conversations: [{ id: "candidate", title: "Rejected candidate" }],
        nextCursor: null,
      };
      if (failureKind === "invalid") {
        protectedConversationStore.makeCanonicalIdsInvalid();
      } else {
        protectedConversationStore.makeCanonicalIdsUnreadable();
      }

      await user.click(
        screen.getByRole("button", { name: "Refresh inventory" }),
      );
      expect(
        await screen.findByText("Protected conversation data is unavailable"),
      ).toBeInTheDocument();
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.queryByText("Rejected candidate")).not.toBeInTheDocument();
      expect(screen.getByTestId("protected-summary")).toHaveTextContent("0");
      expect(screen.getByRole("button", { name: "Delete (1)" })).toBeDisabled();
      expect(gateway.deleteAttempts).toEqual([]);

      (
        gatewayFixture.standalonePages as Record<
          string,
          FakeConversationPageResult
        >
      ).first = {
        conversations: [{ id: "recovered", title: "Recovered snapshot" }],
        nextCursor: null,
      };
      protectedConversationStore.replaceCanonicalIds(["recovered"]);
      await user.click(
        screen.getByRole("button", { name: "Refresh inventory" }),
      );

      expect(await screen.findByText("Recovered snapshot")).toBeInTheDocument();
      expect(screen.queryByText("Safety status")).not.toBeInTheDocument();
      expect(screen.getByTestId("protected-summary")).toHaveTextContent("1");
      expect(protectedConversationStore.loadCount).toBe(3);
    },
  );

  it("keeps the destructive-lock protection reload authoritative after Refresh", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new DeferredProtectedConversationStore();
    const { gateway } = renderManager({ protectedConversationStore });
    await waitForInventory();

    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("Inventory refreshed.");
    protectedConversationStore.replaceCanonicalIds(["alpha"]);

    await selectConversation(user, "Alpha");
    await user.click(screen.getByRole("button", { name: "Delete (1)" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(
      await screen.findByText(
        "No confirmed conversations remain eligible for deletion.",
      ),
    ).toBeInTheDocument();
    expect(protectedConversationStore.loadCount).toBe(3);
    expect(gateway.deleteAttempts).toEqual([]);
  });

  it("preserves the snapshot and blocks deletion when Refresh finds an incompatible API", async () => {
    const user = userEvent.setup();
    const gatewayFixture = fixture([{ id: "alpha", title: "Alpha" }]);
    renderManager({ gatewayFixture });
    await waitForInventory();
    await selectConversation(user, "Alpha");

    (
      gatewayFixture.standalonePages as Record<
        string,
        FakeConversationPageResult
      >
    ).first = {
      conversations: [{ id: "partial", title: "Partial refresh" }],
      nextCursor: null,
    };
    (gatewayFixture.projects as unknown[]).push({ id: "project" });
    (
      gatewayFixture.projectConversationPages as Record<
        string,
        FakeConversationPageResult
      >
    )["project:first"] = { conversations: [], nextCursor: "missing" };

    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(
      await screen.findByText("ChatGPT interface is not supported"),
    ).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Partial refresh")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Delete (1)" })).toBeDisabled();
  });

  it("keeps an accepted snapshot ready after a transient Refresh failure", async () => {
    const user = userEvent.setup();
    const gatewayFixture = fixture([{ id: "alpha", title: "Alpha" }]);
    renderManager({ gatewayFixture });
    await waitForInventory();
    await selectConversation(user, "Alpha");

    (
      gatewayFixture.standalonePages as Record<
        string,
        FakeConversationPageResult
      >
    ).first = { kind: "failure", reason: "network" };
    await user.click(screen.getByRole("button", { name: "Refresh inventory" }));

    expect(
      await screen.findByText(
        "Could not refresh data. The last successfully loaded state is still being shown.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Safety status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete (1)" })).toBeEnabled();
  });

  it("blocks deletion reactively when the accepted snapshot loses its source tab", async () => {
    const lifecycle = new FakeSourceTabLifecycle();
    renderManager({ sourceTabLifecycle: lifecycle });
    await waitForInventory();

    lifecycle.loseSource();

    expect(
      await screen.findByText("ChatGPT source tab is unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Standalone conversations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete (0)" })).toBeDisabled();
    expect(
      screen.queryByText("Read API compatibility failed"),
    ).not.toBeInTheDocument();
  });

  it("defaults to standalone rows and exposes Projects only in the read-only view", async () => {
    const user = userEvent.setup();
    const { openConversation } = renderManager({
      gatewayFixture: fixtureWithProjects(),
    });
    await waitForInventory();

    expect(
      screen.getByRole("table", { name: "Standalone conversations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Standalone row")).toBeInTheDocument();
    expect(screen.queryByText("Project overlap")).not.toBeInTheDocument();
    expect(screen.queryByText("Standalone overlap")).not.toBeInTheDocument();
    expect(screen.getByTestId("standalone-summary")).toHaveTextContent("1");
    expect(screen.getByTestId("project-summary")).toHaveTextContent("2");
    expect(screen.getByTestId("protected-summary")).toHaveTextContent("0");
    await selectConversation(user, "Standalone row");

    await showProjectConversations(user);

    expect(
      screen.getByRole("table", { name: "Project conversations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Project overlap")).toBeInTheDocument();
    expect(screen.getByText("Project planning")).toBeInTheDocument();
    expect(screen.queryByText("Standalone row")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Project protected")).toHaveLength(2);
    expect(screen.queryByLabelText(/Select /)).not.toBeInTheDocument();
    expect(screen.getByText("Selection")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select all results" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Invert" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Protect (1)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete \(/ })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^(Unprotect|Protect)$/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deletion rate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Chats at once")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("1");

    const projectRow = screen.getByText("Project planning").closest("tr");
    if (projectRow === null) throw new Error("Project row not found");
    await user.click(within(projectRow).getByRole("button", { name: "Open" }));
    expect(openConversation).toHaveBeenCalledWith("project-chat");
  });

  it("paginates Project conversations without exposing selection", async () => {
    const user = userEvent.setup();
    const projectConversations = Array.from({ length: 55 }, (_, index) => ({
      id: `project-${index + 1}`,
      title: `Project item ${String(index + 1).padStart(2, "0")}`,
      updatedAt: 1_000 - index,
    }));
    renderManager({
      gatewayFixture: fixtureWithProjects({ projectConversations }),
    });
    await waitForInventory();
    await showProjectConversations(user);

    expect(screen.queryByText("Project item 55")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Next Page"));
    expect(await screen.findByText("Project item 55")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Select Project item 55"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("55 conversations")).toBeInTheDocument();
  });

  it("filters by title, applies an older-than preset, and clears", async () => {
    const user = userEvent.setup();
    renderManager();
    await waitForInventory();

    await user.type(screen.getByLabelText("Search titles"), "Alpha");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await applyDatePreset(user, "More than 7 days ago");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown dates")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Unknown dates")).toBeInTheDocument();
  });

  it("applies calendar age presets in standalone and Project views and clears them", async () => {
    const user = userEvent.setup();
    const now = new Date(2026, 7, 31, 12, 0).getTime();
    renderManager({
      clock: new FakeClock(now),
      gatewayFixture: {
        standalonePages: {
          first: {
            conversations: [
              {
                id: "standalone-old",
                title: "Standalone old",
                updatedAt: new Date(2026, 0, 31, 12, 0).getTime(),
              },
              {
                id: "standalone-recent",
                title: "Standalone recent",
                updatedAt: new Date(2026, 7, 1, 12, 0).getTime(),
              },
              { id: "standalone-null", title: "Standalone null" },
            ],
            nextCursor: null,
          },
        },
        projects: [{ id: "project" }],
        projectConversationPages: {
          "project:first": {
            conversations: [
              {
                id: "project-old",
                title: "Project old",
                updatedAt: new Date(2025, 7, 30, 12, 0).getTime(),
              },
              {
                id: "project-recent",
                title: "Project recent",
                updatedAt: new Date(2026, 0, 1, 12, 0).getTime(),
              },
              { id: "project-null", title: "Project null" },
            ],
            nextCursor: null,
          },
        },
      },
    });
    await waitForInventory();

    await applyDatePreset(user, "More than 6 months ago");
    expect(screen.getByText("Standalone old")).toBeInTheDocument();
    expect(screen.queryByText("Standalone recent")).not.toBeInTheDocument();
    expect(screen.queryByText("Standalone null")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Standalone recent")).toBeInTheDocument();
    expect(screen.getByText("Standalone null")).toBeInTheDocument();

    await showProjectConversations(user);
    await applyDatePreset(user, "More than 1 year ago");
    expect(screen.getByText("Project old")).toBeInTheDocument();
    expect(screen.queryByText("Project recent")).not.toBeInTheDocument();
    expect(screen.queryByText("Project null")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Project recent")).toBeInTheDocument();
    expect(screen.getByText("Project null")).toBeInTheDocument();
  });

  it("sorts through the Ant table while keeping null dates last", async () => {
    const user = userEvent.setup();
    renderManager({
      gatewayFixture: fixture([
        { id: "z", title: "Zulu", updatedAt: 100 },
        { id: "a", title: "Alpha", updatedAt: 200 },
        { id: "n", title: "No date", updatedAt: null },
      ]),
    });
    await waitForInventory();

    let rows = conversationRows();
    expect(rows[0]).toHaveTextContent("Alpha");
    expect(rows.at(-1)).toHaveTextContent("No date");

    await user.click(screen.getByRole("columnheader", { name: /Title/ }));
    rows = conversationRows();
    expect(rows[0]).toHaveTextContent("Alpha");
    expect(rows[1]).toHaveTextContent("No date");
    expect(rows[2]).toHaveTextContent("Zulu");
  });

  it("paginates at 50 rows and preserves selection across pages", async () => {
    const user = userEvent.setup();
    const conversations = Array.from({ length: 55 }, (_, index) => ({
      id: `item-${index + 1}`,
      title: `Item ${String(index + 1).padStart(2, "0")}`,
      updatedAt: 1_000 - index,
    }));
    renderManager({ gatewayFixture: fixture(conversations) });
    await waitForInventory();

    await selectConversation(user, "Item 01");
    expect(screen.queryByText("Item 55")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Next Page"));
    await user.click(await screen.findByLabelText("Select Item 55"));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2");

    await user.type(screen.getByLabelText("Search titles"), "Item 01");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2");
  });

  it("changes the standalone page size and returns to the first page", async () => {
    const user = userEvent.setup();
    const conversations = Array.from({ length: 55 }, (_, index) => ({
      id: `item-${index + 1}`,
      title: `Item ${String(index + 1).padStart(2, "0")}`,
      updatedAt: 1_000 - index,
    }));
    renderManager({ gatewayFixture: fixture(conversations) });
    await waitForInventory();

    await user.click(screen.getByTitle("Next Page"));
    expect(await screen.findByText("Item 55")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("25 / page"));

    expect(await screen.findByText("Item 01")).toBeInTheDocument();
    expect(screen.queryByText("Item 26")).not.toBeInTheDocument();
  });

  it("selects the current page including protected rows and preserves other-page selections", async () => {
    const user = userEvent.setup();
    const conversations = Array.from({ length: 55 }, (_, index) => ({
      id: `item-${index + 1}`,
      title: `Item ${String(index + 1).padStart(2, "0")}`,
      updatedAt: 1_000 - index,
    }));
    renderManager({
      gatewayFixture: fixture(conversations),
      protectedIds: ["item-2"],
    });
    await waitForInventory();

    await user.click(screen.getByTitle("Next Page"));
    await selectConversation(user, "Item 55");
    await user.click(screen.getByTitle("Previous Page"));
    await user.click(screen.getByRole("button", { name: "Select page" }));

    expect(screen.getByLabelText("Select Item 02")).toBeEnabled();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("51");
  });

  it("uses Ant native Shift selection in both directions for protected rows too", async () => {
    const user = userEvent.setup();
    renderManager({
      gatewayFixture: fixture([
        { id: "a", title: "Alpha", updatedAt: 400 },
        { id: "b", title: "Beta", updatedAt: 300 },
        { id: "c", title: "Charlie", updatedAt: 200 },
        { id: "d", title: "Delta", updatedAt: 100 },
      ]),
      protectedIds: ["b"],
    });
    await waitForInventory();

    await selectConversation(user, "Alpha");
    await user.keyboard("{Shift>}");
    await selectConversation(user, "Delta");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("4");
    expect(screen.getByLabelText("Select Beta")).toBeEnabled();

    await user.keyboard("{Shift>}");
    await selectConversation(user, "Alpha");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");

    await selectConversation(user, "Delta");
    await user.keyboard("{Shift>}");
    await selectConversation(user, "Alpha");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("4");
  });

  it("limits Shift ranges to the current filtered, sorted UI page", async () => {
    const user = userEvent.setup();
    const conversations = Array.from({ length: 55 }, (_, index) => ({
      id: `item-${index + 1}`,
      title: `Item ${String(index + 1).padStart(2, "0")}`,
      updatedAt: 1_000 - index,
    }));
    renderManager({ gatewayFixture: fixture(conversations) });
    await waitForInventory();

    await selectConversation(user, "Item 49");
    await user.click(screen.getByTitle("Next Page"));
    await user.keyboard("{Shift>}");
    await selectConversation(user, "Item 55");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2");

    await user.type(screen.getByLabelText("Search titles"), "Item 5");
    await user.click(screen.getByRole("columnheader", { name: /Title/ }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await selectConversation(user, "Item 50");
    await user.keyboard("{Shift>}");
    await selectConversation(user, "Item 55");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("6");
  }, 30_000);

  it("keeps Select all results as an explicit snapshot across filter changes", async () => {
    const user = userEvent.setup();
    renderManager({ protectedIds: ["beta"] });
    await waitForInventory();

    expect(screen.getByLabelText("Select Beta")).toBeEnabled();
    expect(screen.getByTestId("selection-summary")).toHaveTextContent(
      "Selected 0",
    );
    const selectAllResults = screen.getByRole("button", {
      name: "Select all results",
    });
    await user.hover(selectAllResults);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Selects all conversations matching the current filters, including those outside the current page.",
    );
    await user.click(selectAllResults);
    expect(screen.getByTestId("selected-count")).toHaveTextContent("3");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent(
      "Selected 3",
    );

    await user.type(screen.getByLabelText("Search titles"), "Alpha");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("3");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent(
      "Selected 3",
    );
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: "Invert" }));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
    await user.click(selectAllResults);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
  });

  it("filters the standalone table by user protection state", async () => {
    const user = userEvent.setup();
    renderManager({ protectedIds: ["beta"] });
    await waitForInventory();

    await user.click(screen.getByRole("button", { name: "filter" }));
    await user.click(await screen.findByText("Protected"));
    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown dates")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );
    expect(screen.getByTestId("selected-count")).toHaveTextContent("1");
  });

  it("protects and unprotects while keeping the row selected", async () => {
    const user = userEvent.setup();
    renderManager();
    await waitForInventory();
    await selectConversation(user, "Alpha");

    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");
    await user.click(within(alphaRow).getByRole("button", { name: "Protect" }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-count")).toHaveTextContent("1"),
    );
    expect(
      within(alphaRow).getByLabelText("Protected — it will not be deleted."),
    ).toBeInTheDocument();
    await user.click(
      within(alphaRow).getByRole("button", { name: "Unprotect" }),
    );
    await waitFor(() =>
      expect(
        within(alphaRow).getByLabelText("Unprotected — it can be deleted."),
      ).toBeInTheDocument(),
    );
  });

  it("bulk protects eligible selection with one canonical mutation", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new DeferredProtectedConversationStore();
    renderManager({ protectedConversationStore });
    await waitForInventory();

    expect(screen.getByRole("button", { name: "Protect (0)" })).toBeDisabled();
    await selectConversation(user, "Alpha");
    await selectConversation(user, "Beta");
    protectedConversationStore.replaceCanonicalIds(["other-manager-id"]);

    await user.click(screen.getByRole("button", { name: "Protect (2)" }));
    await waitFor(() =>
      expect(protectedConversationStore.pendingSaves).toHaveLength(1),
    );
    expect(protectedConversationStore.loadCount).toBe(2);
    expect(
      protectedConversationStore.pendingSaves[0]?.protectedConversationIds,
    ).toEqual(new Set(["other-manager-id", "alpha", "beta"]));

    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(screen.getByTestId("selected-count")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("protected-summary")).toHaveTextContent("3");
    expect(
      screen.getAllByLabelText("Protected — it will not be deleted."),
    ).toHaveLength(2);
  });

  it("prevents overlapping protection writes", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new DeferredProtectedConversationStore();
    renderManager({ protectedConversationStore });
    await waitForInventory();

    const alphaRow = screen.getByText("Alpha").closest("tr");
    const betaRow = screen.getByText("Beta").closest("tr");
    if (alphaRow === null || betaRow === null) {
      throw new Error("Expected standalone conversation rows");
    }

    await selectConversation(user, "Beta");
    await user.click(within(alphaRow).getByRole("button", { name: "Protect" }));
    await waitFor(() =>
      expect(protectedConversationStore.pendingSaves).toHaveLength(1),
    );
    expect(
      within(alphaRow).getByRole("button", { name: "Protect" }),
    ).toBeDisabled();
    expect(
      within(betaRow).getByRole("button", { name: "Protect" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Protect (1)" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh inventory" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh inventory" }));
    expect(protectedConversationStore.loadCount).toBe(2);

    await user.click(within(betaRow).getByRole("button", { name: "Protect" }));
    expect(protectedConversationStore.pendingSaves).toHaveLength(1);
    const firstPendingSave = protectedConversationStore.pendingSaves[0];
    if (firstPendingSave === undefined) {
      throw new Error("Expected the first pending protection save");
    }
    expect([...firstPendingSave.protectedConversationIds]).toEqual(["alpha"]);

    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(
        within(alphaRow).getByRole("button", { name: "Unprotect" }),
      ).toBeEnabled(),
    );

    await user.click(within(betaRow).getByRole("button", { name: "Protect" }));
    await waitFor(() =>
      expect(protectedConversationStore.pendingSaves).toHaveLength(1),
    );
    const secondPendingSave = protectedConversationStore.pendingSaves[0];
    if (secondPendingSave === undefined) {
      throw new Error("Expected the second pending protection save");
    }
    expect(new Set(secondPendingSave.protectedConversationIds)).toEqual(
      new Set(["alpha", "beta"]),
    );
    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(
        within(betaRow).getByLabelText("Protected — it will not be deleted."),
      ).toBeInTheDocument(),
    );
  });

  it("confirms bulk Unprotect and only removes its captured requested IDs", async () => {
    const user = userEvent.setup();
    const protectedConversationStore = new DeferredProtectedConversationStore([
      "alpha",
      "beta",
    ]);
    renderManager({ protectedConversationStore });
    await waitForInventory();
    await user.click(
      screen.getByRole("button", { name: "Select all results" }),
    );

    await user.click(screen.getByRole("button", { name: "Unprotect (2)" }));
    expect(screen.getByText("Unprotect 2 conversations?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(protectedConversationStore.pendingSaves).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Unprotect (2)" }));
    protectedConversationStore.replaceCanonicalIds([
      "alpha",
      "newly-protected-by-other-manager",
    ]);
    await user.click(
      screen.getByRole("button", { name: "Unprotect 2 conversations" }),
    );
    await waitFor(() =>
      expect(protectedConversationStore.pendingSaves).toHaveLength(1),
    );
    expect(
      protectedConversationStore.pendingSaves[0]?.protectedConversationIds,
    ).toEqual(new Set(["newly-protected-by-other-manager"]));

    protectedConversationStore.resolveNextSave();
    await waitFor(() =>
      expect(screen.getByTestId("selected-count")).toHaveTextContent("3"),
    );
  });

  it("wires Copy and Open row actions through the composition", async () => {
    const user = userEvent.setup();
    const copyConversationId = vi.fn(() => Promise.resolve());
    const { openConversation } = renderManager({ copyConversationId });
    await waitForInventory();

    await user.click(screen.getByRole("button", { name: "Copy ID: alpha" }));
    expect(copyConversationId).toHaveBeenCalledWith("alpha");
    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");

    await user.click(within(alphaRow).getByRole("button", { name: "Open" }));
    expect(openConversation).toHaveBeenCalledWith("alpha");
    expect(screen.getByText("Demo Open action: alpha")).toBeInTheDocument();
  });
});
