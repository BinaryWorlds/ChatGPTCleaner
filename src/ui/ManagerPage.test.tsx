import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManagerComposition,
  ManagerDependencies,
} from "../composition/types";
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

function fixtureWithProjects(input?: {
  readonly projectConversations?: readonly Record<string, unknown>[];
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
            updatedAt: Date.now() - DAY_MS,
          },
          {
            id: "project-chat",
            title: "Project planning",
            createdAt: Date.now() - 20 * DAY_MS,
            updatedAt: Date.now() - 10 * DAY_MS,
          },
        ],
        nextCursor: null,
      },
    },
  };
}

function renderManager(input?: {
  readonly gatewayFixture?: FakeGatewayFixture;
  readonly protectedIds?: readonly string[];
  readonly clock?: FakeClock;
}) {
  const clock = input?.clock ?? new FakeClock(Date.now());
  const gateway = new FakeConversationGateway(
    input?.gatewayFixture ??
      fixture([
        {
          id: "alpha",
          title: "Alpha",
          createdAt: Date.now() - 20 * DAY_MS,
          updatedAt: Date.now() - 20 * DAY_MS,
        },
        {
          id: "beta",
          title: "Beta",
          createdAt: Date.now() - DAY_MS,
          updatedAt: Date.now() - DAY_MS,
        },
        { id: "unknown", title: "Unknown dates" },
      ]),
    clock,
  );
  const protectedConversationStore = new FakeProtectedConversationStore(
    input?.protectedIds ?? [],
  );
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

describe("ManagerPage inventory controls", () => {
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
    await user.click(screen.getByRole("button", { name: "Older than 7 days" }));
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

describe("ManagerPage destructive flow", () => {
  it("requires the exact DELETE N confirmation", async () => {
    const user = userEvent.setup();
    renderManager();
    await waitForInventory();
    await openConfirmation(user, "Alpha");

    const confirmButton = screen.getByRole("button", { name: "Delete 1" });
    expect(confirmButton).toBeDisabled();
    await user.type(screen.getByLabelText("Deletion confirmation"), "delete 1");
    expect(confirmButton).toBeDisabled();
    await user.clear(screen.getByLabelText("Deletion confirmation"));
    await user.type(screen.getByLabelText("Deletion confirmation"), "DELETE 1");
    expect(confirmButton).toBeEnabled();
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
    expect(gateway.deleteAttempts).toHaveLength(5);
    await user.click(retryButton);
    await waitFor(() => expect(gateway.deleteAttempts).toHaveLength(6));
    expect(screen.getByText("FINISHED")).toBeInTheDocument();
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
    expect(screen.getByText("Authentication unavailable")).toBeInTheDocument();
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
