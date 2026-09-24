import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createManagerComposition as createDemoComposition } from "../composition/demo";
import { createManagerComposition as createProductionComposition } from "../composition/production";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("instructs the user to launch from ChatGPT without a source tab", () => {
    render(<App composition={createProductionComposition()} />);

    expect(
      screen.getByText(
        "Open ChatGPT in a tab and launch ChatGPTCleaner from that tab.",
      ),
    ).toBeInTheDocument();
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
                    readyState: "complete",
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

  it("shows demo mode without requiring a source tab", () => {
    render(<App composition={createDemoComposition()} />);

    expect(screen.getByText("Demo mode")).toBeInTheDocument();
    expect(
      screen.getByText(/No request can reach ChatGPT/),
    ).toBeInTheDocument();
  });
});
