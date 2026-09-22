import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import { createManagerComposition } from "@manager-composition";
import { App } from "../../src/ui/App";
import "../../src/ui/manager.css";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Manager root element is missing.");
}

const composition = createManagerComposition();

createRoot(rootElement).render(
  <StrictMode>
    <App composition={composition} />
  </StrictMode>,
);
