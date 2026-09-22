export type SleepResult = "completed" | "cancelled";

export interface Clock {
  now(): number;
  sleep(milliseconds: number, signal: AbortSignal): Promise<SleepResult>;
}
