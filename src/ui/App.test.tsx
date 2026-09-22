import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("instructs the user to launch from ChatGPT without a source tab", () => {
    render(<App />);

    expect(
      screen.getByText(
        "Open ChatGPT in a tab and launch ChatGPTCleaner from that tab.",
      ),
    ).toBeInTheDocument();
  });

  it("recognizes a captured numeric source tab", () => {
    window.history.replaceState({}, "", "/manager.html?sourceTabId=42");

    render(<App />);

    expect(
      screen.getByText("Extension bootstrap is ready"),
    ).toBeInTheDocument();
  });

  it("shows demo mode without requiring a source tab", () => {
    render(<App mode="demo" />);

    expect(screen.getByText("Demo mode")).toBeInTheDocument();
    expect(
      screen.getByText(/Demo mode cannot access ChatGPT/),
    ).toBeInTheDocument();
  });
});
