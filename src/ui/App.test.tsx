import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagerComposition as createDemoComposition } from "../composition/demo";
import { createManagerComposition as createProductionComposition } from "../composition/production";
import { FakeThemePreferenceStore } from "../infrastructure/fake/FakeStores";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("keeps the persisted theme control available without a source tab", async () => {
    const user = userEvent.setup();
    const themePreferenceStore = new FakeThemePreferenceStore("auto");
    render(
      <App
        composition={{
          ...createProductionComposition(),
          themePreferenceStore,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Open ChatGPT in a tab and launch ChatGPTCleaner from that tab.",
    );
    expect(
      screen.getByRole("heading", { name: "ChatGPTCleaner" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("radiogroup", { name: "Theme preference" }),
    ).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Auto" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    const darkPreference = screen.getByRole("radio", { name: "Dark" });
    expect(
      screen.queryByRole("button", { name: "Refresh inventory" }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(darkPreference).toBeEnabled());
    const darkPreferenceLabel = darkPreference.closest("label");
    if (darkPreferenceLabel === null) {
      throw new Error("Dark theme preference label not found");
    }
    await user.click(darkPreferenceLabel);

    await waitFor(() =>
      expect(themePreferenceStore.savedPreferences).toEqual(["dark"]),
    );
  });

  it("validates a captured numeric source tab and fails closed on the unverified contract", async () => {
    window.history.replaceState({}, "", "/manager.html?sourceTabId=42");

    render(
      <App
        composition={createProductionComposition({
          sourceTabBrowser: {
            getTab: () =>
              Promise.resolve({ id: 42, url: "https://chatgpt.com/" }),
            probePage: () =>
              Promise.resolve([
                {
                  result: {
                    origin: "https://chatgpt.com",
                  },
                },
              ]),
          },
          pageReadExecutor: {
            fetchStandalonePage: () =>
              Promise.resolve([{ result: { malformed: true } }]),
            fetchProjectsPage: () =>
              Promise.resolve([{ result: { malformed: true } }]),
            fetchProjectConversationsPage: () =>
              Promise.resolve([{ result: { malformed: true } }]),
          },
          storage: {
            get: () => Promise.resolve({}),
            set: () => Promise.resolve(),
          },
          locks: null,
        })}
      />,
    );

    expect(
      await screen.findByText("Read API compatibility failed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Standalone conversations.*executionResult/),
    ).toBeInTheDocument();
  });

  it("renders the deterministic demo composition without a source tab", async () => {
    render(<App composition={createDemoComposition()} />);

    expect(screen.getByText("Demo mode")).toBeInTheDocument();
    expect(
      screen.getByText(/No request can reach ChatGPT/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("table", { name: "Standalone conversations" }),
    ).toBeInTheDocument();
  });

  it("persists an explicit theme and updates the native color scheme", async () => {
    const user = userEvent.setup();
    const themePreferenceStore = new FakeThemePreferenceStore("auto");
    const composition = {
      ...createDemoComposition(),
      themePreferenceStore,
    };
    render(<App composition={composition} />);

    expect(
      screen.getAllByRole("radiogroup", { name: "Theme preference" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Refresh inventory" }),
    ).toBeInTheDocument();
    const darkPreference = await screen.findByRole("radio", { name: "Dark" });
    await waitFor(() => expect(darkPreference).toBeEnabled());
    const darkPreferenceLabel = darkPreference.closest("label");
    if (darkPreferenceLabel === null) {
      throw new Error("Dark theme preference label not found");
    }
    await user.click(darkPreferenceLabel);

    await waitFor(() =>
      expect(document.documentElement.style.colorScheme).toBe("dark"),
    );
    expect(themePreferenceStore.savedPreferences).toEqual(["dark"]);
  });

  it("tracks system changes only while Auto is active", async () => {
    const user = userEvent.setup();
    let matches = true;
    const themeMediaQuery = "(prefers-color-scheme: dark)";
    const themeChangeListeners = new Set<EventListenerOrEventListenerObject>();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const mediaQueryList: MediaQueryList = {
        get matches() {
          return query === themeMediaQuery && matches;
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (
          _type: string,
          listener: EventListenerOrEventListenerObject,
        ) => {
          if (query === themeMediaQuery) themeChangeListeners.add(listener);
        },
        removeEventListener: (
          _type: string,
          listener: EventListenerOrEventListenerObject,
        ) => {
          if (query === themeMediaQuery) themeChangeListeners.delete(listener);
        },
        dispatchEvent: vi.fn(() => false),
      };
      return mediaQueryList;
    });

    const themePreferenceStore = new FakeThemePreferenceStore("auto");
    render(
      <App
        composition={{
          ...createDemoComposition(),
          themePreferenceStore,
        }}
      />,
    );
    await waitFor(() =>
      expect(document.documentElement.style.colorScheme).toBe("dark"),
    );

    matches = false;
    const event = { matches, media: themeMediaQuery } as MediaQueryListEvent;
    act(() => {
      for (const listener of themeChangeListeners) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    });
    await waitFor(() =>
      expect(document.documentElement.style.colorScheme).toBe("light"),
    );

    const lightPreference = screen.getByRole("radio", { name: "Light" });
    const lightPreferenceLabel = lightPreference.closest("label");
    if (lightPreferenceLabel === null) {
      throw new Error("Light theme preference label not found");
    }
    await user.click(lightPreferenceLabel);
    await waitFor(() =>
      expect(themePreferenceStore.savedPreferences).toEqual(["light"]),
    );

    matches = true;
    const darkSystemEvent = {
      matches,
      media: themeMediaQuery,
    } as MediaQueryListEvent;
    act(() => {
      for (const listener of themeChangeListeners) {
        if (typeof listener === "function") {
          listener(darkSystemEvent);
        } else {
          listener.handleEvent(darkSystemEvent);
        }
      }
    });
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
