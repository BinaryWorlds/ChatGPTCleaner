import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, vi } from "vitest";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(() => {
    throw new Error("Real network access is forbidden in automated tests.");
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
