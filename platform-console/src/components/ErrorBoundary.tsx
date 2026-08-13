/**
 * ErrorBoundary for the platform console.
 *
 * Ported from client/src/components/ui/error-boundary.tsx. Class-component
 * because React has no hook that can catch a descendant's render error —
 * that is the ONLY reason a class component appears here.
 *
 * Does NOT catch: errors in event handlers, in setTimeout, or in unawaited
 * promises. Those never reach React's render path. installGlobalErrorReporting
 * from lib/error-reporting.ts handles both — call it once at boot.
 */
import * as React from "react";
import { reportClientError } from "@/lib/error-reporting";

type Props = {
  children: React.ReactNode;
  name?: string;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
};

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Console line preserved: an ErrorBoundary that fired without leaving a
    // record anywhere is worse than a white screen, because the bug stops
    // being observed. The reporter is the primary channel; this is the
    // fallback when the reporter itself has trouble.
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.name ? ` · ${this.props.name}` : ""}]`,
      error,
      info.componentStack,
    );
    reportClientError({
      kind: "render",
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      fatal: true,
    });
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div role="alert" style={{ padding: 24, border: "1px solid #c33", background: "#2a1010", color: "#f6f6f6", borderRadius: 8, margin: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          {this.props.name ? `${this.props.name} couldn't be displayed` : "Something went wrong on this screen"}
        </h2>
        <p style={{ marginTop: 8, opacity: 0.85, fontSize: 14 }}>
          The rest of the console is still working. Try again, and if it keeps happening tell support what you were doing
          — the details have been reported.
        </p>
        <p style={{ marginTop: 12, fontFamily: "monospace", fontSize: 12, opacity: 0.75, wordBreak: "break-word" }}>
          {this.state.error.message}
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button type="button" onClick={this.reset} style={{ padding: "6px 12px", borderRadius: 4, background: "#2a5", color: "#fff", border: "none", cursor: "pointer" }}>Try again</button>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "6px 12px", borderRadius: 4, background: "transparent", color: "#f6f6f6", border: "1px solid #666", cursor: "pointer" }}>Reload the page</button>
        </div>
      </div>
    );
  }
}
