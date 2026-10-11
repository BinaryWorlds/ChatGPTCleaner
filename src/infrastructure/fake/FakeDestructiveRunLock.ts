import type {
  DestructiveRunLock,
  LockResult,
} from "application/ports/DestructiveRunLock";

interface FakeLockState {
  active: boolean;
}

export class FakeDestructiveRunLock implements DestructiveRunLock {
  public constructor(
    private readonly sharedState: FakeLockState = { active: false },
  ) {}

  public async runExclusive<T>(work: () => Promise<T>): Promise<LockResult<T>> {
    if (this.sharedState.active) return { kind: "unavailable" };

    this.sharedState.active = true;
    try {
      return { kind: "acquired", value: await work() };
    } finally {
      this.sharedState.active = false;
    }
  }
}
