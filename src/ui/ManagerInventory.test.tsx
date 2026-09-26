import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerDependencies } from "../composition/types";
import type {
  ProtectedConversationIdsResult,
  ProtectedConversationStore,
} from "../application/ports/ProtectedConversationStore";
import type { ReadResult } from "../application/ports/ConversationGateway";
import { FakeClock } from "../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../infrastructure/fake/FakeStores";
import type {
  FakeConversationFixture,
  FakeConversationPageResult,
  FakeGatewayFixture,
} from "../infrastructure/fake/fixtures";
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
  render(
    <ManagerPage
      mode="demo"
      dependencies={dependencies}
      openConversation={openConversation}
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

function conversationRows(): HTMLElement[] {
  return within(screen.getByTestId("conversation-table"))
    .getAllByRole("row")
    .slice(1);
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

afterEach(() => {
  vi.useRealTimers();
});

describe("ManagerPage inventory controls", () => {
  it("atomically replaces the snapshot and clears selection after Refresh", async () => {
    const user = userEvent.setup();
    const gatewayFixture = fixture([{ id: "alpha", title: "Alpha" }]);
    const gateway = new DeferredRefreshGateway(
      gatewayFixture,
      new FakeClock(FIXED_NOW),
    );
    const protectedConversationStore = new FakeProtectedConversationStore();
    const settingsStore = new FakeSettingsStore(60);
    const loadSettings = vi.spyOn(settingsStore, "loadRequestsPerMinute");
    renderManager({ gateway, protectedConversationStore, settingsStore });
    await waitForInventory();
    await selectConversation(user, "Alpha");
    await user.click(
      screen.getByRole("button", { name: "Delete selected (1)" }),
    );
    expect(screen.getByText("Confirm deletion")).toBeInTheDocument();

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

    expect(screen.getByText(/Refreshing inventory/)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Fresh snapshot")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete 1" })).toBeDisabled();

    gateway.continueRefresh();
    expect(await screen.findByText("Fresh snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm deletion")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
    expect(gateway.safetyInventoryReadCount).toBe(2);
    expect(gateway.standalonePageReadCount).toBe(2);
    expect(gateway.projectDiscoveryReadCount).toBe(2);
    expect(protectedConversationStore.loadCount).toBe(1);
    expect(loadSettings).toHaveBeenCalledOnce();
  });

  it("preserves the previous valid snapshot when Refresh is incomplete", async () => {
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
      await screen.findByText(
        "Refresh failed. The previous inventory is still active.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Partial refresh")).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("1");
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
    expect(screen.getAllByText("Project protected")).toHaveLength(2);
    expect(screen.queryByLabelText(/Select /)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select all matching" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select current page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Delete selected/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^(Unprotect|Protect)$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Requests per minute"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("1");

    const projectRow = screen.getByText("Project planning").closest("tr");
    if (projectRow === null) throw new Error("Project row not found");
    await user.click(within(projectRow).getByRole("button", { name: "Open" }));
    expect(openConversation).toHaveBeenCalledWith("project-chat");
  });

  it("filters and sorts Project conversation metadata", async () => {
    const user = userEvent.setup();
    renderManager({ gatewayFixture: fixtureWithProjects() });
    await waitForInventory();
    await showProjectConversations(user);

    await user.type(screen.getByLabelText("Search titles"), "planning");
    expect(screen.getByText("Project planning")).toBeInTheDocument();
    expect(screen.queryByText("Project overlap")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await user.click(screen.getByRole("columnheader", { name: /Title/ }));
    const rows = conversationRows();
    expect(rows[0]).toHaveTextContent("Project overlap");
    expect(rows[1]).toHaveTextContent("Project planning");
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

  it("filters by title, applies an older-than preset, and resets", async () => {
    const user = userEvent.setup();
    renderManager();
    await waitForInventory();

    await user.type(screen.getByLabelText("Search titles"), "Alpha");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Older than 7 days" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown dates")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Unknown dates")).toBeInTheDocument();
  });

  it("applies calendar age presets in standalone and Project views and resets them", async () => {
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

    await user.click(
      screen.getByRole("button", { name: "Older than 6 months" }),
    );
    expect(screen.getByText("Standalone old")).toBeInTheDocument();
    expect(screen.queryByText("Standalone recent")).not.toBeInTheDocument();
    expect(screen.queryByText("Standalone null")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Standalone recent")).toBeInTheDocument();
    expect(screen.getByText("Standalone null")).toBeInTheDocument();

    await showProjectConversations(user);
    await user.click(screen.getByRole("button", { name: "Older than 1 year" }));
    expect(screen.getByText("Project old")).toBeInTheDocument();
    expect(screen.queryByText("Project recent")).not.toBeInTheDocument();
    expect(screen.queryByText("Project null")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
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

  it("selects the eligible current page and preserves other-page selections", async () => {
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
    await user.click(
      screen.getByRole("button", { name: "Select current page" }),
    );

    expect(screen.getByLabelText("Select Item 02")).toBeDisabled();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("50");
  });

  it("uses Ant native Shift selection in both directions and skips protected rows", async () => {
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
    expect(screen.getByTestId("selected-count")).toHaveTextContent("3");
    expect(screen.getByLabelText("Select Beta")).toBeDisabled();

    await user.keyboard("{Shift>}");
    await selectConversation(user, "Alpha");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");

    await selectConversation(user, "Delta");
    await user.keyboard("{Shift>}");
    await selectConversation(user, "Alpha");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("3");
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
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    await selectConversation(user, "Item 50");
    await user.keyboard("{Shift>}");
    await selectConversation(user, "Item 55");
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("6");
  });

  it("implements explicit bulk selection and skips protected rows", async () => {
    const user = userEvent.setup();
    renderManager({ protectedIds: ["beta"] });
    await waitForInventory();

    expect(screen.getByLabelText("Select Beta")).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Select all matching" }),
    );
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Invert matching" }));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
    await user.click(
      screen.getByRole("button", { name: "Select all matching" }),
    );
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0");
  });

  it("protects, unprotects, and removes a protected row from selection", async () => {
    const user = userEvent.setup();
    renderManager();
    await waitForInventory();
    await selectConversation(user, "Alpha");

    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");
    await user.click(within(alphaRow).getByRole("button", { name: "Protect" }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-count")).toHaveTextContent("0"),
    );
    expect(within(alphaRow).getByText("Protected")).toBeInTheDocument();
    await user.click(
      within(alphaRow).getByRole("button", { name: "Unprotect" }),
    );
    await waitFor(() =>
      expect(within(alphaRow).getByText("Unprotected")).toBeInTheDocument(),
    );
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
      expect(within(betaRow).getByText("Protected")).toBeInTheDocument(),
    );
  });

  it("routes Open through the composition without navigation", async () => {
    const user = userEvent.setup();
    const { openConversation } = renderManager();
    await waitForInventory();
    const alphaRow = screen.getByText("Alpha").closest("tr");
    if (alphaRow === null) throw new Error("Alpha row not found");

    await user.click(within(alphaRow).getByRole("button", { name: "Open" }));
    expect(openConversation).toHaveBeenCalledWith("alpha");
    expect(screen.getByText("Demo Open action: alpha")).toBeInTheDocument();
  });
});
