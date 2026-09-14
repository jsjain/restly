import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { initTheme } from "./theme/theme";

// Applied before the first render, so the saved theme never flashes the default one.
initTheme();

const container = document.getElementById("root");
const root = createRoot(container!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
