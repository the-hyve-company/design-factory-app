// origins.mjs — default CORS/WS origin allowlist for the daemon.
//
// The default is deliberately NARROW: only the app's own dev/preview
// origin (Vite on 1420) plus the port the dev launcher actually resolved
// (DF_VITE_PORT, set by scripts/dev-web.mjs when 1420 is busy).
//
// Generic dev-port guesses (:3000, :5173) used to be included as a
// convenience, but they meant ANY local app running on those common ports
// could drive the daemon (origin confusion). Removed 2026-07: if you serve
// the UI from a non-default port, either let the launcher set DF_VITE_PORT
// or list the origin explicitly via DF_BRIDGE_ORIGIN (CSV).

export function computeDefaultAllowedOrigins(env = process.env) {
  const origins = ["http://localhost:1420", "http://127.0.0.1:1420"];
  const vitePort = typeof env.DF_VITE_PORT === "string" ? env.DF_VITE_PORT.trim() : "";
  if (vitePort) {
    origins.push(`http://localhost:${vitePort}`, `http://127.0.0.1:${vitePort}`);
  }
  return origins;
}
