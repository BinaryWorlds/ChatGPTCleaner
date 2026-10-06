import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import { createManagerComposition } from "@manager-composition";
import App from "../../src/ui/App";
import ManagerErrorBoundary from "../../src/ui/ManagerErrorBoundary";
import { installGlobalErrorHandlers } from "../../src/infrastructure/observability/globalErrors";
import {
  logger,
  summarizeUnknownError,
} from "../../src/infrastructure/observability/logger";
import "../../src/ui/manager.css";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Manager root element is missing.");
}

const composition = createManagerComposition();
installGlobalErrorHandlers(window, logger, "manager");
logger.info("app.manager.started", { mode: import.meta.env.MODE });

createRoot(rootElement).render(
  <StrictMode>
    <ManagerErrorBoundary
      onError={(error) => {
        logger.error("ui.unhandledError", summarizeUnknownError(error), {
          scope: "manager",
          source: "reactErrorBoundary",
        });
      }}
    >
      <App composition={composition} />
    </ManagerErrorBoundary>
  </StrictMode>,
);
