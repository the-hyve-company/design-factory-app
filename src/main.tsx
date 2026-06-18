import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installDiagnostics } from "@/lib/diagnostics";
import "@/styles/global.css";

// Install diagnostics BEFORE React mounts so the boundary + console wrappers
// capture everything from boot onwards.
installDiagnostics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
