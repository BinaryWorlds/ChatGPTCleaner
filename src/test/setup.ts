import "@testing-library/jest-dom/vitest";
import "../i18n/i18n";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(() => {
    throw new Error("Real network access is forbidden in automated tests.");
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
  globalThis.ResizeObserver = class ResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  };
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
});

afterEach(cleanup);

afterAll(() => {
  globalThis.fetch = originalFetch;
});
