import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/calistoga/latin-400.css";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/ui.css";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
