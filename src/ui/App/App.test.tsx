import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagerComposition as createDemoComposition } from "composition/demo";
import { createManagerComposition as createProductionComposition } from "composition/production";
import { FakeThemePreferenceStore } from "infrastructure/fake/FakeStores";
import App from "./App";

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

    expect(
      screen.getByRole("heading", {
        name: "Launch ChatGPTCleaner from a ChatGPT tab",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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
      await screen.findByText("ChatGPT interface is not supported"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the unbound state for a restored manager with a stale source tab", async () => {
    window.history.replaceState({}, "", "/manager.html?sourceTabId=42");

    render(
      <App
        composition={createProductionComposition({
          sourceTabBrowser: {
            getTab: () => Promise.reject(new Error("closed")),
            probePage: () => Promise.resolve([]),
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
      await screen.findByRole("heading", {
        name: "Launch ChatGPTCleaner from a ChatGPT tab",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("completes the default demo deletion through the normal executor", async () => {
    const user = userEvent.setup();
    render(<App composition={createDemoComposition()} />);
    await screen.findByRole("table", { name: "Standalone conversations" });

    await user.click(screen.getByLabelText("Select Conversation 1"));
    await user.click(screen.getByRole("button", { name: "Delete (1)" }));
    await user.click(
      screen.getByRole("button", { name: "Delete 1 conversation" }),
    );

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Completed 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Conversation deletion")).toBeInTheDocument();
    expect(
      screen.queryByText("Deletion stopped for safety"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Failed conversations")).not.toBeInTheDocument();
  });

  it("renders the demo composition and persists an explicit theme", async () => {
    const user = userEvent.setup();
    const themePreferenceStore = new FakeThemePreferenceStore("auto");
    const composition = {
      ...createDemoComposition(),
      themePreferenceStore,
    };
    render(<App composition={composition} />);

    expect(screen.getByText("Demo mode")).toBeInTheDocument();
    expect(
      screen.getByText("Test data. Your ChatGPT account remains unchanged."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("table", { name: "Standalone conversations" }),
    ).toBeInTheDocument();
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

  it("falls back to Auto when loading the theme preference fails", async () => {
    const themePreferenceStore = {
      loadThemePreference: () => Promise.reject(new Error("load failed")),
      saveThemePreference: vi.fn(() => Promise.resolve()),
    };

    render(
      <App
        composition={{
          ...createDemoComposition(),
          themePreferenceStore,
        }}
      />,
    );

    const autoPreference = screen.getByRole("radio", { name: "Auto" });
    await waitFor(() => expect(autoPreference).toBeEnabled());
    expect(autoPreference).toBeChecked();
    expect(themePreferenceStore.saveThemePreference).not.toHaveBeenCalled();
  });

  it("guards repeated theme writes while pending and rolls back a failed save", async () => {
    let rejectSave: (() => void) | undefined;
    const saveThemePreference = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = () => reject(new Error("save failed"));
        }),
    );
    const themePreferenceStore = {
      loadThemePreference: () => Promise.resolve("auto"),
      saveThemePreference,
    };

    render(
      <App
        composition={{
          ...createDemoComposition(),
          themePreferenceStore,
        }}
      />,
    );

    const autoPreference = screen.getByRole("radio", { name: "Auto" });
    const lightPreference = screen.getByRole("radio", { name: "Light" });
    const darkPreference = screen.getByRole("radio", { name: "Dark" });
    await waitFor(() => expect(darkPreference).toBeEnabled());

    const darkPreferenceLabel = darkPreference.closest("label");
    const lightPreferenceLabel = lightPreference.closest("label");
    if (darkPreferenceLabel === null || lightPreferenceLabel === null) {
      throw new Error("Theme preference label not found");
    }

    fireEvent.click(darkPreferenceLabel);
    fireEvent.click(lightPreferenceLabel);

    expect(saveThemePreference).toHaveBeenCalledTimes(1);
    expect(saveThemePreference).toHaveBeenCalledWith("dark");
    expect(darkPreference).toBeChecked();
    expect(lightPreference).toBeDisabled();

    if (rejectSave === undefined) {
      throw new Error("Theme preference save did not start");
    }
    rejectSave();

    await waitFor(() => expect(autoPreference).toBeChecked());
    expect(darkPreference).toBeEnabled();
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
