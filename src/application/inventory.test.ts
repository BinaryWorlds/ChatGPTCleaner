import { describe, expect, it } from "vitest";
import type {
  ConversationPage,
  ProjectConversationPage,
  ReadResult,
} from "./ports/ConversationGateway";
import { FakeClock } from "../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../infrastructure/fake/FakeStores";
import {
  DEMO_FIXTURE,
  MALFORMED_STANDALONE_FIXTURE,
  type FakeGatewayFixture,
} from "../infrastructure/fake/fixtures";
import { loadInventory, loadSafetyInventory } from "./inventory";
import { buildDeletionPlan } from "../domain/deletionPlan";

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class DeferredStandaloneGateway extends FakeConversationGateway {
  public readonly requestedOffsets: number[] = [];
  public activeReads = 0;
  public maxActiveReads = 0;
  private readonly resolvers = new Map<
    number,
    (result: ReadResult<ConversationPage>) => void
  >();

  public constructor() {
    super(
      {
        standalonePages: {},
        projects: [],
        projectConversationPages: {},
      },
      new FakeClock(),
    );
  }

  public override fetchStandaloneConversationPage(
    cursor: string | null,
  ): Promise<ReadResult<ConversationPage>> {
    const offset = cursor === null ? 0 : Number(cursor);
    this.requestedOffsets.push(offset);
    this.activeReads += 1;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    return new Promise((resolve) => {
      this.resolvers.set(offset, (result) => {
        this.activeReads -= 1;
        resolve(result);
      });
    });
  }

  public resolveOffset(
    offset: number,
    result: ReadResult<ConversationPage>,
  ): void {
    const resolve = this.resolvers.get(offset);
    if (resolve === undefined) {
      throw new Error(`No pending standalone request for offset ${offset}`);
    }
    this.resolvers.delete(offset);
    resolve(result);
  }
}

class DeferredProjectGateway extends FakeConversationGateway {
  public activeProjectReads = 0;
  public maxActiveProjectReads = 0;
  public readonly projectReadOrder: string[] = [];
  private readonly resolvers = new Map<
    string,
    (result: ReadResult<ProjectConversationPage>) => void
  >();

  public constructor(projectIds: readonly string[]) {
    super(
      {
        standalonePages: {
          first: { conversations: [], nextCursor: null },
        },
        projects: projectIds.map((id) => ({ id })),
        projectConversationPages: {},
      },
      new FakeClock(),
    );
  }

  public override fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ): Promise<ReadResult<ProjectConversationPage>> {
    const key = `${projectId}:${cursor ?? "first"}`;
    this.activeProjectReads += 1;
    this.maxActiveProjectReads = Math.max(
      this.maxActiveProjectReads,
      this.activeProjectReads,
    );
    this.projectReadOrder.push(key);
    return new Promise((resolve) => {
      this.resolvers.set(key, (result) => {
        this.activeProjectReads -= 1;
        resolve(result);
      });
    });
  }

  public resolveProjectPage(
    key: string,
    result: ReadResult<ProjectConversationPage>,
  ): void {
    const resolve = this.resolvers.get(key);
    if (resolve === undefined) {
      throw new Error(`No pending Project request for ${key}`);
    }
    this.resolvers.delete(key);
    resolve(result);
  }
}

function projectPage(
  conversationId: string,
  nextCursor: string | null = null,
): ReadResult<ProjectConversationPage> {
  return {
    kind: "success",
    value: {
      conversations: [
        {
          id: conversationId,
          title: conversationId,
          createdAt: null,
          updatedAt: null,
        },
      ],
      nextCursor,
    },
  };
}

function standalonePage(
  offset: number,
  count: number,
  options?: { readonly duplicateFirstId?: string },
): ReadResult<ConversationPage> {
  const conversations = Array.from({ length: count }, (_, index) => ({
    id:
      index === 0 && options?.duplicateFirstId !== undefined
        ? options.duplicateFirstId
        : `conversation-${offset + index}`,
    title: `Conversation ${offset + index}`,
    createdAt: null,
    updatedAt: null,
  }));
  return {
    kind: "success",
    value: {
      conversations,
      nextCursor: count < 100 ? null : String(offset + 100),
    },
  };
}

describe("inventory and deletion planning", () => {
  it("loads standalone windows with at most three reads and commits out-of-order pages by offset", async () => {
    const gateway = new DeferredStandaloneGateway();
    const progress: number[] = [];
    const loading = loadSafetyInventory(gateway, (event) => {
      if (event.kind === "standalone-progress") {
        progress.push(event.loadedConversationCount);
      }
    });
    await settleAsyncWork();

    expect(gateway.requestedOffsets).toEqual([0]);
    expect(gateway.maxActiveReads).toBe(1);
    gateway.resolveOffset(0, standalonePage(0, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300]);

    gateway.resolveOffset(300, standalonePage(300, 100));
    gateway.resolveOffset(
      100,
      standalonePage(100, 100, { duplicateFirstId: "conversation-0" }),
    );
    gateway.resolveOffset(200, standalonePage(200, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300, 400, 500, 600]);

    gateway.resolveOffset(400, standalonePage(400, 100));
    gateway.resolveOffset(500, standalonePage(500, 2));
    gateway.resolveOffset(600, { kind: "failure", reason: "compatibility" });
    const result = await loading;

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(gateway.maxActiveReads).toBe(3);
    expect(progress).toEqual([100, 199, 299, 399, 499, 501]);
    expect(result.inventory.standaloneConversations).toHaveLength(501);
    expect(result.inventory.standaloneConversations[0]?.id).toBe(
      "conversation-0",
    );
    expect(result.inventory.standaloneConversations.at(-1)?.id).toBe(
      "conversation-501",
    );
  });

  it("fails the whole standalone window on a required authentication failure", async () => {
    const gateway = new DeferredStandaloneGateway();
    const loading = loadSafetyInventory(gateway);
    await settleAsyncWork();

    expect(gateway.requestedOffsets).toEqual([0]);
    gateway.resolveOffset(0, standalonePage(0, 100));
    await settleAsyncWork();
    gateway.resolveOffset(200, standalonePage(200, 100));
    gateway.resolveOffset(100, { kind: "failure", reason: "authentication" });
    gateway.resolveOffset(300, standalonePage(300, 100));

    await expect(loading).resolves.toEqual({
      kind: "blocked",
      reason: "authentication",
    });
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300]);
  });

  it("does not schedule another window while one request is waiting to retry", async () => {
    const gateway = new DeferredStandaloneGateway();
    const loading = loadSafetyInventory(gateway);
    await settleAsyncWork();

    gateway.resolveOffset(0, standalonePage(0, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300]);

    gateway.resolveOffset(200, standalonePage(200, 100));
    gateway.resolveOffset(100, standalonePage(100, 100));
    gateway.resolveOffset(300, standalonePage(300, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300, 400, 500, 600]);
    gateway.resolveOffset(400, standalonePage(400, 1));
    gateway.resolveOffset(500, { kind: "failure", reason: "retry-later" });
    gateway.resolveOffset(600, { kind: "failure", reason: "network" });

    await expect(loading).resolves.toMatchObject({ kind: "ready" });
  });

  it("bounds concurrent Projects while keeping each Project sequential", async () => {
    const gateway = new DeferredProjectGateway(["a", "b", "c", "d"]);
    const loading = loadSafetyInventory(gateway);
    await settleAsyncWork();

    expect(gateway.maxActiveProjectReads).toBe(3);
    expect(gateway.projectReadOrder).toEqual(["a:first", "b:first", "c:first"]);
    gateway.resolveProjectPage("a:first", projectPage("a-1", "a-next"));
    await settleAsyncWork();
    expect(gateway.projectReadOrder).toEqual([
      "a:first",
      "b:first",
      "c:first",
      "a:a-next",
    ]);

    gateway.resolveProjectPage("a:a-next", projectPage("a-2"));
    await settleAsyncWork();
    expect(gateway.projectReadOrder.at(-1)).toBe("d:first");
    gateway.resolveProjectPage("b:first", projectPage("b-1"));
    gateway.resolveProjectPage("c:first", projectPage("c-1"));
    gateway.resolveProjectPage("d:first", projectPage("d-1"));

    await expect(loading).resolves.toMatchObject({ kind: "ready" });
    expect(gateway.maxActiveProjectReads).toBe(3);
  });

  it("fails the whole Project enumeration without scheduling new Projects", async () => {
    const gateway = new DeferredProjectGateway(["a", "b", "c", "d"]);
    const loading = loadSafetyInventory(gateway);
    await settleAsyncWork();

    gateway.resolveProjectPage("a:first", {
      kind: "failure",
      reason: "authentication",
    });
    await settleAsyncWork();
    gateway.resolveProjectPage("b:first", projectPage("partial-b"));
    gateway.resolveProjectPage("c:first", projectPage("partial-c"));

    await expect(loading).resolves.toEqual({
      kind: "blocked",
      reason: "authentication",
    });
    expect(gateway.projectReadOrder).toEqual(["a:first", "b:first", "c:first"]);
  });
  it("loads and deduplicates paginated standalone and Project fixtures", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(DEMO_FIXTURE, clock);
    const result = await loadInventory({
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore([
        "standalone-010",
      ]),
      settingsStore: new FakeSettingsStore(75),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.inventory.standaloneConversations).toHaveLength(64);
    expect(result.inventory.projectConversations).toHaveLength(4);
    expect(
      result.inventory.projectConversations.find(
        ({ id }) => id === "project-overlap",
      )?.title,
    ).toBe("Project overlap");
    expect(
      result.inventory.projectConversations.find(
        ({ id }) => id === "project-chat-2",
      ),
    ).toMatchObject({ title: "(Untitled)", createdAt: null, updatedAt: null });
    expect(
      result.inventory.standaloneConversations.some(
        ({ id }) => id === "project-overlap",
      ),
    ).toBe(false);
    expect(
      result.inventory.standaloneConversations.find(
        ({ id }) => id === "standalone-005",
      )?.title,
    ).toBe("(Untitled)");
    expect(result.requestsPerMinute).toBe(75);
  });

  it("loads 393 standalone conversations in four 100-record pages and reports phases", async () => {
    const conversations = Array.from({ length: 393 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `Conversation ${index}`,
    }));
    const progress: string[] = [];
    const result = await loadSafetyInventory(
      new FakeConversationGateway(
        {
          standalonePages: {
            first: {
              conversations: conversations.slice(0, 100),
              nextCursor: "100",
            },
            "100": {
              conversations: conversations.slice(100, 200),
              nextCursor: "200",
            },
            "200": {
              conversations: conversations.slice(200, 300),
              nextCursor: "300",
            },
            "300": {
              conversations: conversations.slice(300),
              nextCursor: null,
            },
          },
          projects: [],
          projectConversationPages: {},
        },
        new FakeClock(),
      ),
      (event) => {
        progress.push(
          event.kind === "read-compatible"
            ? event.kind
            : `${event.kind}:${event.loadedConversationCount}`,
        );
      },
    );

    expect(result.kind).toBe("ready");
    expect(progress).toEqual([
      "read-compatible",
      "standalone-progress:100",
      "standalone-progress:200",
      "standalone-progress:300",
      "standalone-progress:393",
      "project-protection-started:393",
    ]);
  });

  it("follows a smaller effective standalone cursor sequentially", async () => {
    const conversations = Array.from({ length: 60 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `Conversation ${index}`,
    }));
    const result = await loadSafetyInventory(
      new FakeConversationGateway(
        {
          standalonePages: {
            first: {
              conversations: conversations.slice(0, 28),
              nextCursor: "28",
            },
            "28": {
              conversations: conversations.slice(28, 56),
              nextCursor: "56",
            },
            "56": {
              conversations: conversations.slice(56),
              nextCursor: null,
            },
          },
          projects: [],
          projectConversationPages: {},
        },
        new FakeClock(),
      ),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.inventory.standaloneConversations).toHaveLength(60);
  });

  it("blocks a duplicate full standalone page that makes no ID progress", async () => {
    const conversations = Array.from({ length: 100 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `Conversation ${index}`,
    }));
    const result = await loadSafetyInventory(
      new FakeConversationGateway(
        {
          standalonePages: {
            first: { conversations, nextCursor: "100" },
            "100": { conversations, nextCursor: "200" },
          },
          projects: [],
          projectConversationPages: {},
        },
        new FakeClock(),
      ),
    );

    expect(result).toEqual({ kind: "blocked", reason: "pagination" });
  });

  it("blocks malformed safety-critical response data", async () => {
    const result = await loadSafetyInventory(
      new FakeConversationGateway(
        MALFORMED_STANDALONE_FIXTURE,
        new FakeClock(),
      ),
    );
    expect(result).toEqual({ kind: "blocked", reason: "compatibility" });
  });

  it("blocks non-progressing pagination", async () => {
    const conversations = Array.from({ length: 100 }, (_, index) => ({
      id: `conversation-${index}`,
      title: `Conversation ${index}`,
    }));
    const fixture: FakeGatewayFixture = {
      ...DEMO_FIXTURE,
      standalonePages: {
        first: { conversations, nextCursor: "loop" },
        loop: { conversations, nextCursor: "loop" },
      },
      projects: [],
      projectConversationPages: {},
    };
    const result = await loadSafetyInventory(
      new FakeConversationGateway(fixture, new FakeClock()),
    );
    expect(result).toEqual({ kind: "blocked", reason: "pagination" });
  });

  it("blocks standalone pagination that reaches the safety ceiling", async () => {
    const standalonePages: Record<string, unknown> = {};
    for (let index = 0; index < 1_000; index += 1) {
      const key = index === 0 ? "first" : String(index * 100);
      standalonePages[key] = {
        conversations: Array.from({ length: 100 }, (_, itemIndex) => ({
          id: `conversation-${index}-${itemIndex}`,
        })),
        nextCursor: String((index + 1) * 100),
      };
    }
    const result = await loadSafetyInventory(
      new FakeConversationGateway(
        {
          ...DEMO_FIXTURE,
          standalonePages,
          projects: [],
          projectConversationPages: {},
        },
        new FakeClock(),
      ),
    );
    expect(result).toEqual({ kind: "blocked", reason: "pagination" });
  });

  it("blocks incomplete Project-conversation pagination", async () => {
    const result = await loadSafetyInventory(
      new FakeConversationGateway(
        {
          ...DEMO_FIXTURE,
          standalonePages: {
            first: { conversations: [], nextCursor: null },
          },
          projects: [{ id: "project" }],
          projectConversationPages: {
            "project:first": {
              conversations: [{ id: "project-chat", title: "Project chat" }],
              nextCursor: "loop",
            },
            "project:loop": {
              conversations: [{ id: "project-chat", title: "Project chat" }],
              nextCursor: "loop",
            },
          },
        },
        new FakeClock(),
      ),
    );
    expect(result).toEqual({ kind: "blocked", reason: "pagination" });
  });

  it("normalizes malformed rate settings but blocks malformed protections", async () => {
    const settingsStore = new FakeSettingsStore("fast");
    const normalized = await loadInventory({
      gateway: new FakeConversationGateway(DEMO_FIXTURE, new FakeClock()),
      protectedConversationStore: new FakeProtectedConversationStore([]),
      settingsStore,
    });
    expect(normalized.kind === "ready" && normalized.requestsPerMinute).toBe(
      60,
    );
    expect(settingsStore.savedValues).toEqual([60]);

    const blocked = await loadInventory({
      gateway: new FakeConversationGateway(DEMO_FIXTURE, new FakeClock()),
      protectedConversationStore: new FakeProtectedConversationStore([42]),
      settingsStore: new FakeSettingsStore(),
    });
    expect(blocked).toEqual({ kind: "blocked", reason: "protected-storage" });
  });

  it("builds a snapshot plan that excludes Project, protected, and missing IDs", () => {
    const plan = buildDeletionPlan({
      selectedConversationIds: [
        "standalone",
        "protected",
        "project",
        "missing",
      ],
      standaloneConversations: [
        {
          id: "standalone",
          title: "Standalone",
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "protected",
          title: "Protected",
          createdAt: null,
          updatedAt: null,
        },
      ],
      projectConversationIds: new Set(["project"]),
      protectedConversationIds: new Set(["protected"]),
    });
    expect(plan.eligibleConversationIds).toEqual(["standalone"]);
    expect(plan.excludedProjectIds).toEqual(["project"]);
    expect(plan.excludedProtectedIds).toEqual(["protected"]);
    expect(plan.missingConversationIds).toEqual(["missing"]);
  });
});
