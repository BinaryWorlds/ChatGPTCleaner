import { describe, expect, it } from "vitest";
import {
  buildDeletionPlan,
  confirmDeletionPlan,
  type ConfirmedDeletionPlan,
} from "../domain/deletionPlan";
import type { Conversation } from "../domain/conversation";
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
  SESSION_MISMATCH_FIXTURE,
  type FakeGatewayFixture,
} from "../infrastructure/fake/fixtures";
import { DeletionRun } from "./deletionRun";
import { loadInventory, loadSafetyInventory } from "./inventory";
import { runPreflight } from "./preflight";

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
    contexts: ["account:workspace"],
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

describe("inventory and preflight", () => {
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
    const fixture: FakeGatewayFixture = {
      ...DEMO_FIXTURE,
      standalonePages: {
        first: { conversations: [], nextCursor: "loop" },
        loop: { conversations: [], nextCursor: "loop" },
      },
      projects: [],
      projectConversationPages: {},
    };
    const result = await loadSafetyInventory(
      new FakeConversationGateway(fixture, new FakeClock()),
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

  it("blocks a changed session/workspace context", async () => {
    const gateway = new FakeConversationGateway(
      SESSION_MISMATCH_FIXTURE,
      new FakeClock(),
    );
    const initial = await loadSafetyInventory(gateway);
    expect(initial.kind).toBe("ready");
    const result = await runPreflight({
      selectedConversationIds: ["standalone-001"],
      expectedContextFingerprint: "demo-account:workspace-a",
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
    });
    expect(result).toEqual({ kind: "blocked", reason: "context-changed" });
  });

  it("builds a fresh plan that excludes Project, protected, and missing IDs", async () => {
    const result = await runPreflight({
      selectedConversationIds: [
        "standalone-001",
        "standalone-010",
        "project-overlap",
        "missing",
      ],
      expectedContextFingerprint: "demo-account:demo-workspace",
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
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
      requestsPerMinute: 60,
      gateway,
      protectedConversationStore: new FakeProtectedConversationStore(),
      clock,
      destructiveRunLock: new FakeDestructiveRunLock(),
    });

    expect((await run.startDeletion()).kind).toBe("fatal");
    expect(gateway.deleteAttempts.map(({ id }) => id)).toEqual(["forbidden"]);
  });

  it("allows only one destructive executor", async () => {
    const sharedLockState = { active: true };
    const run = new DeletionRun({
      confirmedPlan: confirmedPlan(["a"]),
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
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
      expectedContextFingerprint: "account:workspace",
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
