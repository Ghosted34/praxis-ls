/**
 * ScreenScaffold — a finished-looking skeleton for screens whose backend
 * integration is still pending. Renders the real intended structure (header +
 * primary actions, tabs, the planned table columns, and the AI actions that
 * apply on this screen) so the IA is reviewable end-to-end (and design-ready for
 * Pixie inspo) before any data is wired. Replaces the old generic ComingSoon.
 *
 * The screen catalogue lives in ./screen-specs.ts; <Planned/> resolves the spec
 * for the current route so app.tsx can point every un-built route at one wrapper.
 * Full map + AI-integration table: doc/FE_IA_BUILD_MAP.md.
 */
import * as React from "react";
import { useLocation, Link } from "react-router-dom";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { SPECS_BY_PATH, type ScreenSpec, type BeStatus, type AiKind } from "./screen-specs";

const BE_LABEL: Record<BeStatus, string> = {
  ready: "Backend ready — needs FE wiring",
  partial: "Backend partial — some endpoints",
  readonly: "Backend read-only",
  none: "No backend endpoint yet",
};
const BE_CLASS: Record<BeStatus, string> = {
  ready: "st-ok",
  partial: "st-warn",
  readonly: "st-info",
  none: "st-bad",
};

const AI_LABEL: Record<AiKind, string> = { read: "read", write: "action", assist: "AI-assist" };
const AI_CLASS: Record<AiKind, string> = {
  read: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  write: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  assist: "bg-primary/10 text-primary",
};

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

export function ScreenScaffold({ spec }: { spec: ScreenSpec }) {
  const [tab, setTab] = React.useState(0);
  const columns = spec.tabs && spec.tabs[tab]?.columns ? spec.tabs[tab].columns : spec.columns || [];
  const tabActions = spec.tabs && spec.tabs[tab]?.actions;
  const actions = tabActions || spec.actions || [];

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {spec.area && <p className="micro mb-1">{spec.area}</p>}
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl tracking-tight">{spec.title}</h1>
            <span className={`status ${BE_CLASS[spec.status]}`}>{spec.module ? `${spec.module} · ` : ""}{BE_LABEL[spec.status]}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{spec.purpose}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a} disabled title="Available once the backend is wired">
              {a}
            </Button>
          ))}
        </div>
      </header>

      {spec.tabs && spec.tabs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1 border-b">
          {spec.tabs.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTab(i)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                i === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="lux-card overflow-hidden">
        <Table>
          <THead>
            <TR>
              {(columns.length ? columns : ["—"]).map((c) => (
                <TH key={c}>{c}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD colSpan={Math.max(1, columns.length)}>
                <div className="flex flex-col items-center justify-center gap-1 py-14 text-center">
                  <span className={`status ${BE_CLASS[spec.status]} mb-1`}>Awaiting backend integration</span>
                  <p className="text-sm font-medium text-foreground">{spec.title} data will render here</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    Columns, filters and actions above are the planned structure. {spec.module ? `Source module ${spec.module}. ` : ""}
                    See <code className="text-[11px]">doc/FE_IA_BUILD_MAP.md</code>.
                  </p>
                </div>
              </TD>
            </TR>
          </TBody>
        </Table>
      </div>

      {spec.ai && spec.ai.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-primary">
              <SparkIcon />
            </span>
            <h2 className="text-sm font-semibold text-foreground">AI actions on this screen</h2>
            <span className="text-xs text-muted-foreground">— callable via the assistant (⌘K → Ask) with human confirm on writes</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {spec.ai.map((a) => (
              <div key={a.label} className="lux-card flex items-start gap-3 p-3">
                <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${AI_CLASS[a.kind]}`}>{AI_LABEL[a.kind]}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.label}</p>
                  <p className="text-xs text-muted-foreground">{a.describe}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-sm">
        <Link to="/" className="text-primary underline-offset-4 hover:underline">
          &larr; Back to Control Tower
        </Link>
      </p>
    </section>
  );
}

/** Derive a minimal spec from the path when a route has no catalogue entry. */
function fallbackSpec(pathname: string): ScreenSpec {
  const parts = pathname.split("/").filter(Boolean);
  const seg = parts[parts.length - 1] || "home";
  const title = seg.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return {
    path: parts.join("/"),
    area: parts.length > 1 ? parts[0].replace(/^\w/, (c) => c.toUpperCase()) : "",
    title,
    purpose: "This screen is on the IA roadmap. Structure is pending definition.",
    status: "none",
    columns: [],
  };
}

/** Route target for every un-built screen — resolves its spec from the path. */
export function Planned() {
  const { pathname } = useLocation();
  const key = pathname.replace(/^\//, "");
  const spec = SPECS_BY_PATH[key] || fallbackSpec(pathname);
  return <ScreenScaffold spec={spec} />;
}

export default Planned;
