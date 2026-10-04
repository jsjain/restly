import { Component, type ReactNode } from "react";
import * as api from "../api";
import { formatReport } from "../errorReport";
import "../errorBoundary.css";

interface Props {
  children: ReactNode;
  // When this changes the error is cleared, so switching tabs leaves a crashed one behind.
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  componentStack?: string;
  copied: boolean;
  logError: string;
}

// Only shows UI: the root's onUncaughtError/onCaughtError in main.tsx do the logging. It
// must not import the store, which may be what broke.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false, logError: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false, logError: "" };
  }

  componentDidCatch(_error: Error, info: { componentStack?: string | null }) {
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = () => this.setState({ error: null, componentStack: undefined, copied: false, logError: "" });

  copy = async () => {
    try {
      await api.ClipboardSetText(formatReport(this.state.error, "error boundary", this.state.componentStack));
      this.setState({ copied: true });
    } catch (err) {
      this.setState({ logError: String(err) });
    }
  };

  showLog = async () => {
    try {
      await api.revealLogFile();
      this.setState({ logError: "" });
    } catch (err) {
      this.setState({ logError: String(err) });
    }
  };

  render() {
    const { error, copied, logError } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h2>Something went wrong</h2>
          <pre className="mono error-boundary-message">{error.message || String(error)}</pre>
          <p>The error was written to the log file. Share that file when you report the problem.</p>
          <div className="error-boundary-actions">
            <button className="primary" onClick={this.reset}>
              Try again
            </button>
            <button onClick={this.copy}>{copied ? "Copied" : "Copy details"}</button>
            <button onClick={this.showLog}>Show log file</button>
            <button onClick={() => location.reload()}>Reload window</button>
          </div>
          {logError ? <div className="error-boundary-error">{logError}</div> : null}
        </div>
      </div>
    );
  }
}
