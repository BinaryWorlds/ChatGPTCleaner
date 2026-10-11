import type { Clock, SleepResult } from "application/ports/Clock";

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }

  public sleep(
    milliseconds: number,
    signal: AbortSignal,
  ): Promise<SleepResult> {
    if (signal.aborted) return Promise.resolve("cancelled");

    return new Promise((resolve) => {
      const handleAbort = () => {
        clearTimeout(timeoutId);
        resolve("cancelled");
      };
      const timeoutId = setTimeout(() => {
        signal.removeEventListener("abort", handleAbort);
        resolve("completed");
      }, milliseconds);
      signal.addEventListener("abort", handleAbort, { once: true });
    });
  }
}
