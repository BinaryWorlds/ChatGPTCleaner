import { describe, expect, it } from "vitest";
import type { SettingsStore } from "./ports/SettingsStore";
import {
  loadMaximumConcurrentDeleteRequests,
  SerializedMaximumConcurrentDeleteRequestsWriter,
  SerializedRequestsPerMinuteWriter,
} from "./settings";

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
      loadMaximumConcurrentDeleteRequests: () => Promise.resolve(1),
      saveMaximumConcurrentDeleteRequests: () => Promise.resolve(),
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

  it("normalizes malformed concurrency and serializes valid changes", async () => {
    let storedValue: unknown = "many";
    const savedValues: number[] = [];
    const settingsStore: SettingsStore = {
      loadRequestsPerMinute: () => Promise.resolve(60),
      saveRequestsPerMinute: () => Promise.resolve(),
      loadMaximumConcurrentDeleteRequests: () => Promise.resolve(storedValue),
      saveMaximumConcurrentDeleteRequests: (value) => {
        storedValue = value;
        savedValues.push(value);
        return Promise.resolve();
      },
    };

    await expect(
      loadMaximumConcurrentDeleteRequests(settingsStore),
    ).resolves.toBe(1);
    const writer = new SerializedMaximumConcurrentDeleteRequestsWriter(
      settingsStore,
    );
    await expect(writer.save(20)).resolves.toBe(true);
    await expect(writer.save(21)).resolves.toBe(false);
    expect(savedValues).toEqual([1, 20]);
  });

  it("keeps a stored concurrency value at the upper boundary", async () => {
    const savedValues: number[] = [];
    const settingsStore: SettingsStore = {
      loadRequestsPerMinute: () => Promise.resolve(60),
      saveRequestsPerMinute: () => Promise.resolve(),
      loadMaximumConcurrentDeleteRequests: () => Promise.resolve(20),
      saveMaximumConcurrentDeleteRequests: (value) => {
        savedValues.push(value);
        return Promise.resolve();
      },
    };

    await expect(
      loadMaximumConcurrentDeleteRequests(settingsStore),
    ).resolves.toBe(20);
    expect(savedValues).toEqual([]);
  });
});
