import { describe, expect, it } from "vitest";
import { FakeClock } from "./FakeClock";
import { FakeConversationGateway } from "./FakeConversationGateway";
import { FakeDestructiveRunLock } from "./FakeDestructiveRunLock";
import { DEMO_FIXTURE } from "./fixtures";

describe("fake infrastructure", () => {
  it("uses deterministic latency and successful default demo deletion", async () => {
    const clock = new FakeClock();
    const gateway = new FakeConversationGateway(DEMO_FIXTURE, clock);

    expect(await gateway.deleteConversation("standalone-004")).toEqual({
      kind: "deleted",
      status: 204,
    });
    expect(clock.now()).toBe(25);
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
