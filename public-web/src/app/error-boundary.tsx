import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { p } from "@/lib/base-path";

/**
 * The crash boundary.
 *
 * ── WHY THIS EXISTS IN A PUBLIC APP MORE THAN IN THE ERP ───────────────────
 *
 * In the staff app a throw is an inconvenience to somebody who can refresh, file
 * a ticket and carry on with the other forty things on their screen. Here the
 * reader is a stranger holding a link the sales team sent: a white page after
 * their name is typed into a quote form is not a bug report, it is a lost
 * shipment enquiry, and there is no one in front of them to ask.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * No auto-reload. A boundary that reloads on mount turns a render throw into a
 * loop that hammers the origin, and on a metered connection that loop costs the
 * visitor money while it fixes nothing. The one action offered is a reload the
 * reader chooses, which also clears a stale chunk after a deploy.
 *
 * No error text on screen. `info.componentStack` names internal modules; the
 * reader cannot use it and it is not theirs to see. It goes to the console, where
 * whoever is debugging this will look.
 */
type State = { error: Error | null };

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[public-web] render throw", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return <CrashScreen />;
  }
}

/** Kept out of the class on purpose: the sentence is dictionary copy, and a class
 *  component cannot reach `useTranslation`. This page is also the one place in the
 *  app that must render without the branding provider, the router or the
 *  tenant's fetch — all three of which are above the boundary or beside it — so it
 *  uses `t()` but no `Link`, no image and no `useBranding`. */
function CrashScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background px-gutter py-16">
      <div className="mx-auto max-w-prose">
        <h1 className="text-h2 font-semibold tracking-tight">
          {t("site.crash.title")}
        </h1>
        <p className="mt-3 text-muted-foreground">{t("site.crash.hint")}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button size="lg" onClick={() => window.location.reload()}>
            {t("site.crash.reload")}
          </Button>
          {/* A plain anchor: `react-router`'s `<Link>` needs the very context that
              may have thrown, and leaving the app entirely is the safe exit. */}
          <a
            href={p()}
            className="btn-surface inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold"
          >
            {t("site.crash.home")}
          </a>
        </div>
      </div>
    </div>
  );
}
