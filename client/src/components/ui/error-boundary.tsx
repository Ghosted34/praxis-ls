/**
 * ErrorBoundary — catches a render-time throw and shows a recoverable state.
 *
 * THERE WAS NO ERROR BOUNDARY ANYWHERE in the client (F12). A render throw in
 * any screen blanked the entire SPA: white page, no message, no way back except
 * a manual reload — which in this app also means losing an unsaved form. For a
 * system of record that is a data-loss path, not just a rough edge.
 *
 * It is a class component because that is the only React API that can catch a
 * descendant's render error; there is no hook equivalent. That is the sole
 * reason, and it should not be taken as licence to write new class components.
 *
 * WHAT IT DOES NOT CATCH, so nobody assumes more coverage than exists: errors
 * thrown in event handlers, in `setTimeout`, or inside a rejected promise that
 * nothing awaits. Those never reach React's render path. Async failures should
 * keep going through `errMsg` + an `ErrorState`, which is what the four-states
 * pattern already does.
 *
 * @example  // route level, in app.tsx
 * <ErrorBoundary name="Finance">
 *   <Route … />
 * </ErrorBoundary>
 *
 * @example  // around one risky widget, so the rest of the page survives it
 * <ErrorBoundary name="Route map" fallback={<EmptyState title="Map unavailable" />}>
 *   <WorldMap data={shipments} />
 * </ErrorBoundary>
 *
 * BEST PRACTICE. Wrap at TWO levels: once at the app root so nothing can blank
 * the shell, and again around any widget doing something unusual (a chart, a
 * map, anything parsing a payload it does not control). A boundary around every
 * component is noise; a boundary only at the root means one bad KPI tile still
 * takes the whole dashboard.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: React.ReactNode;
  /** Names the failing area in the message and the console line. */
  name?: string;
  /** Replaces the default panel entirely. */
  fallback?: React.ReactNode;
  /** Hook for error reporting. Called with the error and the component stack. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
};

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Left in deliberately: without a reporting pipeline this console line is
    // the only record that the boundary fired, and a silent boundary is worse
    // than a white screen — the bug simply stops being observed.
    console.error(`[ErrorBoundary${this.props.name ? ` · ${this.props.name}` : ""}]`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="text-title font-semibold text-foreground">
          {this.props.name ? `${this.props.name} couldn't be displayed` : "Something went wrong on this screen"}
        </h2>
        <p className="mt-1 max-w-reading text-sm text-muted-foreground">
          The rest of the app is still working. Try again, and if it keeps happening tell support what you were doing
          — the details have been logged.
        </p>
        {/* The message is shown but not dressed up as guidance: it is for the
            person reporting the bug, not instructions the user can act on. */}
        <p className="mt-3 break-words font-mono text-micro text-muted-foreground">{this.state.error.message}</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={this.reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    );
  }
}
