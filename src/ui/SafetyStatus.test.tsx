import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafetyStatus } from "./SafetyStatus";

describe("SafetyStatus", () => {
  it("marks read compatibility OK while inventory is still loading", () => {
    render(
      <SafetyStatus
        status="loading"
        blockedReason={undefined}
        loadingStage="inventory"
      />,
    );

    expect(screen.getByTestId("safety-read-compatibility")).toHaveTextContent(
      "OK",
    );
    expect(screen.getByTestId("safety-project-protection")).toHaveTextContent(
      "NOT CHECKED",
    );
    expect(screen.getByTestId("safety-deletion")).toHaveTextContent("BLOCKED");
  });

  it("keeps deletion blocked while complete Project protection is loading", () => {
    render(
      <SafetyStatus
        status="loading"
        blockedReason={undefined}
        loadingStage="projects"
      />,
    );

    expect(screen.getByTestId("safety-project-protection")).toHaveTextContent(
      "CHECKING",
    );
    expect(screen.getByTestId("safety-deletion")).toHaveTextContent("BLOCKED");
  });

  it("keeps validated standalone compatibility OK when Project protection fails", () => {
    render(
      <SafetyStatus
        status="blocked"
        blockedReason="compatibility"
        readCompatibilityConfirmed
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
    render(<SafetyStatus status="blocked" blockedReason="authentication" />);

    expect(screen.getByTestId("safety-source-tab")).toHaveTextContent("OK");
    expect(screen.getByText("Authentication unavailable")).toBeInTheDocument();
  });

  it("reports a genuine source-tab failure separately", () => {
    render(
      <SafetyStatus status="blocked" blockedReason="source-unavailable" />,
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
        status="blocked"
        blockedReason="compatibility"
        diagnostic={{
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
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Project discovery (/backend-api/gizmos/snorlax/sidebar), page 1: missing required field id; HTTP 200, JSON parsed: yes",
    );
  });
});
