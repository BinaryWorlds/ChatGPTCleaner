import type { Clock, SleepResult } from "application/ports/Clock";

interface PendingSleep {
  readonly endsAt: number;
  readonly resolve: (result: SleepResult) => void;
  readonly signal: AbortSignal;
  readonly abortListener: () => void;
}

export class FakeClock implements Clock {
  private currentTime: number;
  private readonly pendingSleeps: PendingSleep[] = [];
  public readonly requestedSleeps: number[] = [];

  public constructor(
    initialTime = 0,
    private readonly automaticallyAdvance = true,
  ) {
    this.currentTime = initialTime;
  }

  public now(): number {
    return this.currentTime;
  }

  public sleep(
    milliseconds: number,
    signal: AbortSignal,
  ): Promise<SleepResult> {
    this.requestedSleeps.push(milliseconds);
    if (signal.aborted) return Promise.resolve("cancelled");
    if (this.automaticallyAdvance) {
      this.currentTime += milliseconds;
      return Promise.resolve("completed");
    }

    return new Promise((resolve) => {
      const abortListener = () => {
        this.removeSleep(signal);
        resolve("cancelled");
      };
      signal.addEventListener("abort", abortListener, { once: true });
      this.pendingSleeps.push({
        endsAt: this.currentTime + milliseconds,
        resolve,
        signal,
        abortListener,
      });
    });
  }

  public advanceBy(milliseconds: number): void {
    this.currentTime += milliseconds;
    const completedSleeps = this.pendingSleeps.filter(
      ({ endsAt }) => endsAt <= this.currentTime,
    );
    for (const sleep of completedSleeps) {
      sleep.signal.removeEventListener("abort", sleep.abortListener);
      this.pendingSleeps.splice(this.pendingSleeps.indexOf(sleep), 1);
      sleep.resolve("completed");
    }
  }

  private removeSleep(signal: AbortSignal): void {
    const index = this.pendingSleeps.findIndex(
      (sleep) => sleep.signal === signal,
    );
    if (index >= 0) this.pendingSleeps.splice(index, 1);
  }
}
