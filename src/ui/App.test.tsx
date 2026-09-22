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

  it("recognizes a captured numeric source tab", () => {
    window.history.replaceState({}, "", "/manager.html?sourceTabId=42");

    render(<App composition={createProductionComposition()} />);

    expect(
      screen.getByText("Extension bootstrap is ready"),
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
