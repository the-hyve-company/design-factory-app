import { Component, type ErrorInfo, type ReactNode } from "react";
import { pushDiag, copySnapshotToClipboard } from "@/lib/diagnostics";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

// App-level error boundary. Renders a clean fallback instead of a blank
// screen + surfaces the traceback with a "copy diagnostics" action so the
// user can paste a snapshot into a bug report.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    pushDiag("error", "react", `${error.name}: ${error.message}`, {
      componentStack: info.componentStack,
      stack: error.stack,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleCopy = async () => {
    await copySnapshotToClipboard();
  };

  handleHome = () => {
    window.location.hash = "#/";
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "var(--df-sp-5)",
          background: "var(--df-bg-base)",
          color: "var(--df-text-primary)",
          fontFamily: "var(--df-font-sans)",
        }}
      >
        <div
          style={{
            maxWidth: 640,
            width: "100%",
            padding: "var(--df-sp-6)",
            background: "var(--df-bg-section)",
            border: "1px solid var(--df-border-subtle)",
            borderRadius: "var(--df-r-xl)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--df-sp-3)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-2xs)",
              color: "var(--df-accent-danger)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            render error
          </div>
          <h1
            style={{
              fontSize: "var(--df-text-xl)",
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: "var(--df-text-primary)",
              margin: 0,
            }}
          >
            Something broke while rendering
          </h1>
          <p
            style={{
              fontSize: "var(--df-text-sm)",
              color: "var(--df-text-secondary)",
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            <code
              style={{
                fontFamily: "var(--df-font-mono)",
                background: "var(--df-surface-raised)",
                padding: "1px 6px",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: 3,
              }}
            >
              {this.state.error.name}
            </code>
            : {this.state.error.message}
          </p>
          {this.state.error.stack && (
            <pre
              style={{
                fontFamily: "var(--df-font-mono)",
                fontSize: "var(--df-text-2xs)",
                color: "var(--df-text-muted)",
                background: "var(--df-bg-sunken)",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: "var(--df-r-sm)",
                padding: "var(--df-sp-3)",
                overflow: "auto",
                maxHeight: 240,
                margin: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {this.state.error.stack}
            </pre>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: "var(--df-sp-2)", flexWrap: "wrap" }}>
            <button className="df-btn df-btn--primary" onClick={this.handleReload}>
              Reload app
            </button>
            <button className="df-btn df-btn--secondary" onClick={this.handleHome}>
              Back to home
            </button>
            <button className="df-btn df-btn--ghost" onClick={this.handleCopy}>
              Copy diagnostics
            </button>
          </div>
        </div>
      </div>
    );
  }
}
