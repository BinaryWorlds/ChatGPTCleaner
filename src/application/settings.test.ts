import { describe, expect, it } from "vitest";
import type { SettingsStore } from "./ports/SettingsStore";
import { SerializedRequestsPerMinuteWriter } from "./settings";

describe("serialized settings writes", () => {
  it("persists rapid rate changes in user-command order", async () => {
    const startedValues: number[] = [];
    const resolvers: Array<() => void> = [];
    const settingsStore: SettingsStore = {
      loadRequestsPerMinute: () => Promise.resolve(60),
      saveRequestsPerMinute: (value) => {
        startedValues.push(value);
        return new Promise<void>((resolve) => resolvers.push(resolve));
      },
    };
    const writer = new SerializedRequestsPerMinuteWriter(settingsStore);

    const firstWrite = writer.save(30);
    const secondWrite = writer.save(90);
    await Promise.resolve();
    expect(startedValues).toEqual([30]);

    resolvers[0]?.();
    await firstWrite;
    await Promise.resolve();
    expect(startedValues).toEqual([30, 90]);

    resolvers[1]?.();
    await expect(secondWrite).resolves.toBe(true);
  });
});
