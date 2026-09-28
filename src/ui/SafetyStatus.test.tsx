import { fireEvent, render, screen } from "@testing-library/react";
import { safetyBlockReasons } from "../application/SafetyBlockReason";
import { describe, expect, it } from "vitest";
import { SafetyStatus, safetyBlockReasonLabel } from "./SafetyStatus";

describe("SafetyStatus", () => {
  it("has a safe user-facing label for every safety block reason", () => {
    for (const reason of safetyBlockReasons) {
      expect(safetyBlockReasonLabel(reason).trim()).not.toBe("");
    }
  });

  it("exposes lock help from the combined label without including its status", async () => {
    render(<SafetyStatus state={{ kind: "ready" }} />);

    const lockStatus = screen.getByTestId("safety-run-lock");
    const lockHelpTrigger = screen.getByLabelText("About Run lock");

    expect(lockStatus).toHaveTextContent("NOT CHECKED");
    expect(screen.getByTestId("safety-deletion")).toHaveTextContent("READY");
    expect(lockHelpTrigger).toHaveTextContent("Run lock");
    expect(lockHelpTrigger).not.toContainElement(lockStatus);

    fireEvent.focus(lockHelpTrigger);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "NOT CHECKED before starting is normal",
    );
  });

  it("provides keyboard-accessible help for every safety check", async () => {
    render(<SafetyStatus state={{ kind: "ready" }} />);

    const helpLabels = [
      "ChatGPT connection",
      "Source tab access",
      "Read API compatibility",
      "Project protection",
      "Run lock",
      "Deletion safety",
    ];

    for (const label of helpLabels) {
      expect(screen.getByLabelText(`About ${label}`)).toHaveAttribute(
        "tabindex",
        "0",
      );
    }

    fireEvent.focus(screen.getByLabelText("About ChatGPT connection"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Requires an active ChatGPT session",
    );
  });

  it("marks read compatibility OK while inventory is still loading", () => {
    render(<SafetyStatus state={{ kind: "loading", stage: "inventory" }} />);

    expect(screen.getByTestId("safety-read-compatibility")).toHaveTextContent(
      "OK",
    );
    expect(screen.getByTestId("safety-project-protection")).toHaveTextContent(
      "NOT CHECKED",
    );
    expect(screen.getByTestId("safety-deletion")).toHaveTextContent("BLOCKED");
  });

  it("keeps deletion blocked while complete Project protection is loading", () => {
    render(<SafetyStatus state={{ kind: "loading", stage: "projects" }} />);

    expect(screen.getByTestId("safety-project-protection")).toHaveTextContent(
      "CHECKING",
    );
    expect(screen.getByTestId("safety-deletion")).toHaveTextContent("BLOCKED");
  });

  it("keeps validated standalone compatibility OK when Project protection fails", () => {
    render(
      <SafetyStatus
        state={{
          kind: "blocked",
          reason: "compatibility",
          readCompatibilityConfirmed: true,
        }}
      />,
    );

    expect(screen.getByTestId("safety-read-compatibility")).toHaveTextContent(
      "OK",
    );
    expect(screen.getByTestId("safety-project-protection")).toHaveTextContent(
      "BLOCKED",
    );
    expect(screen.getByTestId("safety-deletion")).toHaveTextContent("BLOCKED");
  });

  it("does not misreport a validated source tab as blocked after auth failure", () => {
    render(
      <SafetyStatus
        state={{
          kind: "blocked",
          reason: "authentication",
          readCompatibilityConfirmed: false,
        }}
      />,
    );

    expect(screen.getByTestId("safety-source-tab")).toHaveTextContent("OK");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Authentication unavailable",
    );
  });

  it("reports a genuine source-tab failure separately", () => {
    render(
      <SafetyStatus
        state={{
          kind: "blocked",
          reason: "source-unavailable",
          readCompatibilityConfirmed: false,
        }}
      />,
    );

    expect(screen.getByTestId("safety-source-tab")).toHaveTextContent(
      "BLOCKED",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Source tab unavailable",
    );
  });

  it("shows structural diagnostics without scalar response values", () => {
    render(
      <SafetyStatus
        state={{
          kind: "blocked",
          reason: "compatibility",
          readCompatibilityConfirmed: false,
          diagnostic: {
            operation: "projects",
            endpointFamily: "/backend-api/gizmos/snorlax/sidebar",
            category: "response-contract",
            paginationStep: 1,
            httpStatus: 200,
            jsonParsed: true,
            fieldPath: "items[0].gizmo.gizmo.id",
            expectedType: "string",
            actualType: "absent",
            missingRequiredField: "id",
          },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Project discovery (/backend-api/gizmos/snorlax/sidebar), page 1: missing required field id; HTTP 200, JSON parsed: yes",
    );
  });
});
