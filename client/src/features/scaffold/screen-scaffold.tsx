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
import { AiActions } from "@/components/ai-actions";
import { SPECS_BY_PATH, type ScreenSpec, type BeStatus } from "./screen-specs";

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

      <AiActions actions={spec.ai} />

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
