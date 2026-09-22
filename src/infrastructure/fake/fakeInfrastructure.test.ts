import { describe, expect, it } from "vitest";
import { FakeClock } from "./FakeClock";
import { FakeConversationGateway } from "./FakeConversationGateway";
import { FakeDestructiveRunLock } from "./FakeDestructiveRunLock";
import { DEMO_FIXTURE } from "./fixtures";

describe("fake infrastructure", () => {
  it("supports deterministic latency and scripted outcomes", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(DEMO_FIXTURE, clock);

    expect(await gateway.deleteConversation("standalone-004")).toEqual({
      kind: "retryable",
      reason: "rate-limit",
      retryAfterMs: 2_000,
    });
    expect(await gateway.deleteConversation("standalone-004")).toEqual({
      kind: "deleted",
    });
    expect(clock.now()).toBe(50);
  });

  it("releases a fake lock after errors", async () => {
    const lock = new FakeDestructiveRunLock();
    await expect(
      lock.runExclusive(() => Promise.reject(new Error("expected"))),
    ).rejects.toThrow("expected");
    await expect(
      lock.runExclusive(() => Promise.resolve("ok")),
    ).resolves.toEqual({ kind: "acquired", value: "ok" });
  });
});
