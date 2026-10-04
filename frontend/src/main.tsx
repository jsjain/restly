import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./sidebar.css";
import "./tabbar.css";
import "./request.css";
import "./modals.css";
import "./websocket.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installErrorReporting, reportError } from "./errorReport";
import { initTheme } from "./theme/theme";

// Applied before the first render, so the saved theme never flashes the default one.
initTheme();
installErrorReporting();

const container = document.getElementById("root");
// The one place render errors are logged. ErrorBoundary only shows the fallback.
const root = createRoot(container!, {
  onUncaughtError: (error, info) => reportError(error, "uncaught render error", info.componentStack),
  onCaughtError: (error, info) => reportError(error, "render error", info.componentStack),
});

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
