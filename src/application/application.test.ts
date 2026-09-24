import { describe, expect, it } from "vitest";
import {
  buildDeletionPlan,
  confirmDeletionPlan,
  type ConfirmedDeletionPlan,
} from "../domain/deletionPlan";
import type { Conversation } from "../domain/conversation";
import type { ConversationPage, ReadResult } from "./ports/ConversationGateway";
import { FakeClock } from "../infrastructure/fake/FakeClock";
import { FakeConversationGateway } from "../infrastructure/fake/FakeConversationGateway";
import { FakeDestructiveRunLock } from "../infrastructure/fake/FakeDestructiveRunLock";
import {
  FakeProtectedConversationStore,
  FakeSettingsStore,
} from "../infrastructure/fake/FakeStores";
import {
  DEMO_FIXTURE,
  MALFORMED_STANDALONE_FIXTURE,
  type FakeGatewayFixture,
} from "../infrastructure/fake/fixtures";
import { DeletionRun } from "./deletionRun";
import { loadInventory, loadSafetyInventory } from "./inventory";
import { runPreflight } from "./preflight";
import type {
  ApplicationObservability,
  ObservabilityFields,
} from "./ports/Observability";

function confirmedPlan(ids: readonly string[]): ConfirmedDeletionPlan {
  const conversations: Conversation[] = ids.map((id) => ({
    id,
    title: id,
    createdAt: null,
    updatedAt: null,
  }));
  const plan = buildDeletionPlan({
    selectedConversationIds: ids,
    standaloneConversations: conversations,
    projectConversationIds: new Set(),
    protectedConversationIds: new Set(),
  });
  const confirmation = confirmDeletionPlan(plan, `DELETE ${ids.length}`);
  if (confirmation.kind !== "confirmed") {
    throw new Error("Test setup failed to confirm a deletion plan.");
  }
  return confirmation.plan;
}

function fixtureForDeletion(
  ids: readonly string[],
  deleteOutcomes: FakeGatewayFixture["deleteOutcomes"],
): FakeGatewayFixture {
  return {
    standalonePages: {
      first: {
        conversations: ids.map((id) => ({ id, title: id })),
        nextCursor: null,
      },
    },
    projects: [],
    projectConversationPages: {},
    ...(deleteOutcomes === undefined ? {} : { deleteOutcomes }),
  };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class CapturingObservability implements ApplicationObservability {
  public readonly entries: {
    readonly level: "debug" | "info" | "warn" | "error";
    readonly event: string;
    readonly errorCode?: string;
    readonly fields?: ObservabilityFields;
  }[] = [];
  private sequence = 0;

  public createOperationId(): string {
    this.sequence += 1;
    return `operation-${this.sequence}`;
  }

  public debug(event: string, fields?: ObservabilityFields): void {
    this.entries.push({
      level: "debug",
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  public info(event: string, fields?: ObservabilityFields): void {
    this.entries.push({
      level: "info",
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  public warn(event: string, fields?: ObservabilityFields): void {
    this.entries.push({
      level: "warn",
      event,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  public error(
    event: string,
    errorCode: string,
    fields?: ObservabilityFields,
  ): void {
    this.entries.push({
      level: "error",
      event,
      errorCode,
      ...(fields === undefined ? {} : { fields }),
    });
  }
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

class SequentialProjectGateway extends FakeConversationGateway {
  public activeProjectReads = 0;
  public maxActiveProjectReads = 0;
  public readonly projectReadOrder: string[] = [];

  public override async fetchProjectConversationPage(
    projectId: string,
    cursor: string | null,
  ) {
    this.activeProjectReads += 1;
    this.maxActiveProjectReads = Math.max(
      this.maxActiveProjectReads,
      this.activeProjectReads,
    );
    this.projectReadOrder.push(`${projectId}:${cursor ?? "first"}`);
    await Promise.resolve();
    try {
      return await super.fetchProjectConversationPage(projectId, cursor);
    } finally {
      this.activeProjectReads -= 1;
    }
  }
}

class ConcurrencyTrackingDeleteGateway extends FakeConversationGateway {
  public activeDeletes = 0;
  public maxActiveDeletes = 0;

  public override async deleteConversation(conversationId: string) {
    this.activeDeletes += 1;
    this.maxActiveDeletes = Math.max(this.maxActiveDeletes, this.activeDeletes);
    await Promise.resolve();
    try {
      return await super.deleteConversation(conversationId);
    } finally {
      this.activeDeletes -= 1;
    }
  }
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

describe("inventory and preflight", () => {
  it("loads standalone windows with at most three reads and commits out-of-order pages by offset", async () => {
    const gateway = new DeferredStandaloneGateway();
    const progress: number[] = [];
    const loading = loadSafetyInventory(gateway, (event) => {
      if (event.kind === "standalone-progress") {
        progress.push(event.loadedConversationCount);
      }
    });
    await settleAsyncWork();

    expect(gateway.requestedOffsets).toEqual([0, 100, 200]);
    expect(gateway.maxActiveReads).toBe(3);
    gateway.resolveOffset(200, standalonePage(200, 100));
    gateway.resolveOffset(0, standalonePage(0, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200]);

    gateway.resolveOffset(
      100,
      standalonePage(100, 100, { duplicateFirstId: "conversation-0" }),
    );
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300, 400, 500]);

    gateway.resolveOffset(400, standalonePage(400, 2));
    gateway.resolveOffset(500, { kind: "failure", reason: "compatibility" });
    gateway.resolveOffset(300, standalonePage(300, 100));
    const result = await loading;

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(gateway.maxActiveReads).toBe(3);
    expect(progress).toEqual([100, 199, 299, 399, 401]);
    expect(result.inventory.standaloneConversations).toHaveLength(401);
    expect(result.inventory.standaloneConversations[0]?.id).toBe(
      "conversation-0",
    );
    expect(result.inventory.standaloneConversations.at(-1)?.id).toBe(
      "conversation-401",
    );
  });

  it("fails the whole standalone window on a required authentication failure", async () => {
    const gateway = new DeferredStandaloneGateway();
    const loading = loadSafetyInventory(gateway);
    await settleAsyncWork();

    gateway.resolveOffset(200, standalonePage(200, 100));
    gateway.resolveOffset(100, { kind: "failure", reason: "authentication" });
    gateway.resolveOffset(0, standalonePage(0, 100));

    await expect(loading).resolves.toEqual({
      kind: "blocked",
      reason: "authentication",
    });
    expect(gateway.requestedOffsets).toEqual([0, 100, 200]);
  });

  it("does not schedule another window while one request is waiting to retry", async () => {
    const gateway = new DeferredStandaloneGateway();
    const loading = loadSafetyInventory(gateway);
    await settleAsyncWork();

    gateway.resolveOffset(0, standalonePage(0, 100));
    gateway.resolveOffset(200, standalonePage(200, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200]);

    gateway.resolveOffset(100, standalonePage(100, 100));
    await settleAsyncWork();
    expect(gateway.requestedOffsets).toEqual([0, 100, 200, 300, 400, 500]);
    gateway.resolveOffset(300, standalonePage(300, 1));
    gateway.resolveOffset(400, { kind: "failure", reason: "retry-later" });
    gateway.resolveOffset(500, { kind: "failure", reason: "network" });

    await expect(loading).resolves.toMatchObject({ kind: "ready" });
  });

  it("keeps Project conversation enumeration sequential", async () => {
    const gateway = new SequentialProjectGateway(DEMO_FIXTURE, new FakeClock());

    await expect(loadSafetyInventory(gateway)).resolves.toMatchObject({
      kind: "ready",
    });
    expect(gateway.maxActiveProjectReads).toBe(1);
    expect(gateway.projectReadOrder).toEqual([
      "project-alpha:first",
      "project-alpha:project-alpha-page-2",
      "project-beta:first",
    ]);
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
    expect(result.inventory.projectConversationIds.size).toBe(4);
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

  it("builds a fresh plan that excludes Project, protected, and missing IDs", async () => {
    const result = await runPreflight({
      selectedConversationIds: [
        "standalone-001",
        "standalone-010",
        "project-overlap",
        "missing",
      ],
      gateway: new FakeConversationGateway(DEMO_FIXTURE, new FakeClock()),
      protectedConversationStore: new FakeProtectedConversationStore([
        "standalone-010",
      ]),
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.plan.eligibleConversationIds).toEqual(["standalone-001"]);
    expect(result.plan.excludedProjectIds).toEqual(["project-overlap"]);
    expect(result.plan.excludedProtectedIds).toEqual(["standalone-010"]);
    expect(result.plan.missingConversationIds).toEqual(["missing"]);
  });
});

describe("destructive run", () => {
  it("logs the privacy-safe API lifecycle for a successful DELETE attempt", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["PRIVATE_CONVERSATION_ID_SENTINEL"]),
      requestsPerMinute: 60,
      gateway: new FakeConversationGateway(
        fixtureForDeletion(["PRIVATE_CONVERSATION_ID_SENTINEL"], {}),
        clock,
      ),
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();

    expect(
      observability.entries.some(
        ({ level, event, fields }) =>
          level === "debug" &&
          event === "api.request.started" &&
          fields?.operation === "conversation.delete" &&
          fields.ordinal === 1 &&
          fields.attempt === 1,
      ),
    ).toBe(true);
    expect(
      observability.entries.some(
        ({ level, event, fields }) =>
          level === "debug" &&
          event === "api.request.succeeded" &&
          fields?.operation === "conversation.delete" &&
          fields.status === 204 &&
          fields.ordinal === 1 &&
          fields.attempt === 1,
      ),
    ).toBe(true);
    expect(JSON.stringify(observability.entries)).not.toContain(
      "PRIVATE_CONVERSATION_ID_SENTINEL",
    );
  });

  it("keeps DELETE strictly sequential with one request in flight", async () => {
    const ids = ["one", "two", "three"];
    const clock = new FakeClock();
    const gateway = new ConcurrencyTrackingDeleteGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    await run.startDeletion();
    expect(gateway.maxActiveDeletes).toBe(1);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(ids);
  });

  it("honors Retry-After without stacking fallback or normal spacing", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["limited"], {
        limited: ["long-rate-limit", "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["limited"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    await run.startDeletion();
    expect(clock.requestedSleeps).toEqual([120_000]);
    expect(gateway.deleteAttempts.map(({ startedAt }) => startedAt)).toEqual([
      0, 120_000,
    ]);
  });

  it("handles success, 404, 410, retries, and sequential rate limiting", async () => {
    const ids = ["success", "gone", "removed", "limited", "server", "network"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {
        success: ["success"],
        gone: [404],
        removed: [410],
        limited: [429, "success"],
        server: [500, "success"],
        network: ["network", "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const state = await run.startDeletion();
    expect(state.kind).toBe("finished");
    expect(state.progress.deleted).toBe(4);
    expect(state.progress.skipped).toBe(2);
    expect(state.progress.retries).toBe(3);
    expect(gateway.deleteAttempts).toHaveLength(9);
    for (let index = 1; index < gateway.deleteAttempts.length; index += 1) {
      const previous = gateway.deleteAttempts[index - 1];
      const current = gateway.deleteAttempts[index];
      if (previous === undefined || current === undefined) continue;
      expect(current.startedAt - previous.startedAt).toBeGreaterThanOrEqual(
        1_000,
      );
    }
  });

  it("stops fatally on 403 without attempting later IDs", async () => {
    const ids = ["forbidden", "untouched"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, { forbidden: [403] }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    expect((await run.startDeletion()).kind).toBe("fatal");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["forbidden"]);
  });

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [422, "client"],
  ] as const)(
    "stops on fatal HTTP %i before the next confirmed ID",
    async (status, reason) => {
      const ids = ["fatal", "untouched"];
      const clock = new FakeClock();
      const lockState = { active: false };
      const gateway = new FakeConversationGateway(
        fixtureForDeletion(ids, { fatal: [status] }),
        clock,
      );
      const run = new DeletionRun({
        confirmedPlan: confirmedPlan(ids),
        requestsPerMinute: 60,
        gateway,
        protectedConversationStore: new FakeProtectedConversationStore(),
        clock,
        destructiveRunLock: new FakeDestructiveRunLock(lockState),
      });

      const result = await run.startDeletion();
      expect(result).toMatchObject({ kind: "fatal", reason });
      expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["fatal"]);
      expect(lockState.active).toBe(false);
    },
  );

  it("continues after exhausted server and network failures", async () => {
    const ids = ["server-failed", "network-failed", "success"];
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {
        "server-failed": [500, 500, 500, 500, 500],
        "network-failed": [
          "network",
          "network",
          "network",
          "network",
          "network",
        ],
        success: ["success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const result = await run.startDeletion();
    expect(result).toMatchObject({
      kind: "finished",
      progress: { failed: 2, deleted: 1, processed: 3 },
    });
    expect(gateway.deleteAttempts.at(-1)?.id).toBe("success");
  });

  it("logs destructive ordinals without IDs and only one terminal fatal error", async () => {
    const privateId = "PRIVATE_CONVERSATION_ID_SENTINEL";
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion([privateId], { [privateId]: [403] }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan([privateId]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();
    const serializedLogs = JSON.stringify(observability.entries);
    expect(serializedLogs).not.toContain(privateId);
    expect(serializedLogs).not.toContain("PRIVATE_TOKEN_SENTINEL");
    expect(serializedLogs).not.toContain("PRIVATE_RESPONSE_SENTINEL");
    expect(serializedLogs).toContain('"ordinal":1');
    expect(
      observability.entries.filter(({ level }) => level === "error"),
    ).toHaveLength(1);
  });

  it("does not log a recovered retry as terminal ERROR", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["retry"], { retry: [500, "success"] }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["retry"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();
    expect(
      observability.entries.filter(({ level }) => level === "error"),
    ).toEqual([]);
    expect(
      observability.entries.some(
        ({ event }) => event === "deletion.attempt.retry",
      ),
    ).toBe(true);
  });

  it("maps an exhausted rate limit to RATE_LIMITED without a terminal run error", async () => {
    const clock = new FakeClock();
    const observability = new CapturingObservability();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["limited"], {
        limited: [429, 429, 429, 429, 429],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["limited"]),
      requestsPerMinute: 120,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
      observability,
    });

    await run.startDeletion();
    expect(
      observability.entries.filter(({ level }) => level === "error"),
    ).toEqual([]);
    expect(
      observability.entries.some(
        ({ level, event, fields }) =>
          level === "warn" &&
          event === "deletion.attempt.failed" &&
          fields?.errorCode === "RATE_LIMITED",
      ),
    ).toBe(true);
  });

  it("allows only one destructive executor", async () => {
    const sharedLockState = { active: true };
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["a"]),
      requestsPerMinute: 60,
      gateway: new FakeConversationGateway(
        fixtureForDeletion(["a"], {}),
        new FakeClock(),
      ),
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock: new FakeClock(),
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
    });

    expect((await run.startDeletion()).kind).toBe("blocked");
  });

  it("pauses a local wait, revalidates, resumes, and does not replay success", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
    run.pauseDeletion();
    await settleAsyncWork();
    expect(run.getState().kind).toBe("paused");
    run.resumeDeletion();
    await settleAsyncWork();
    clock.advanceBy(1_000);
    await settleAsyncWork();

    expect((await completion).kind).toBe("finished");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("lets an in-flight attempt finish and holds the lock while paused", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const fixture = {
      ...fixtureForDeletion(ids, {}),
      latencyMs: 100,
    };
    const gateway = new FakeConversationGateway(fixture, clock);
    const sharedLockState = { active: false };
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(sharedLockState),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    expect(run.getState().kind).toBe("pausing");
    clock.advanceBy(100);
    await settleAsyncWork();

    expect(run.getState().kind).toBe("paused");
    expect(sharedLockState.active).toBe(true);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);

    run.stopDeletion();
    expect((await completion).kind).toBe("stopped");
    expect(sharedLockState.active).toBe(false);
  });

  it("stop cancels a local wait and starts no further attempt", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.stopDeletion();

    expect((await completion).kind).toBe("stopped");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
  });

  it("resume removes a newly protected remaining ID", async () => {
    const ids = ["a", "b"];
    const clock = new FakeClock(0, false);
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(ids, {}),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(ids),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const completion = run.startDeletion();
    await settleAsyncWork();
    run.pauseDeletion();
    await settleAsyncWork();
    await store.saveProtectedConversationIds(new Set(["b"]));
    run.resumeDeletion();

    expect((await completion).kind).toBe("finished");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["a"]);
  });

  it("retry failed revalidates and cannot add or delete a newly protected ID", async () => {
    const clock = new FakeClock();
    const store = new FakeProtectedConversationStore();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["failed"], {
        failed: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: store,
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    const initial = await run.startDeletion();
    expect(initial.progress.failed).toBe(1);
    await store.saveProtectedConversationIds(new Set(["failed"]));
    const retried = await run.retryFailedDeletion();

    expect(retried.kind).toBe("finished");
    expect(gateway.deleteAttempts).toHaveLength(5);
  });

  it("retry failed can delete only the previously confirmed failed subset", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(
      fixtureForDeletion(["failed"], {
        failed: [500, 500, 500, 500, 500, "success"],
      }),
      clock,
    );
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["failed"]),
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    expect((await run.startDeletion()).progress.failed).toBe(1);
    const retryResult = await run.retryFailedDeletion();

    expect(retryResult.kind).toBe("finished");
    expect(retryResult.progress.deleted).toBe(1);
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual([
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
  });
});
