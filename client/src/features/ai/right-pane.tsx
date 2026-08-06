/**
 * The workspace's right pane — where an answer stops being a message and
 * becomes something you can work with.
 *
 * THE PROBLEM IT SOLVES. A chat column is the right shape for a conversation
 * and the wrong shape for its output. Twenty rows of receivables rendered as
 * markdown inside a reading-width column is a table you cannot sort, cannot
 * export and can barely read; a drafted proforma is a document trapped in a
 * transcript. Lifting either into a pane costs nothing — the prose stays in the
 * thread — and gives the output the affordances its own type deserves.
 *
 * FOUR TABS, AND THEY ARE FOUR VIEWS OF ONE ANSWER, not four features:
 *
 *   Canvas   The long-form artefact — a drafted memo, proforma or summary —
 *            with its own title, copy and download.
 *   Table    The same answer's result set, as a real sortable `<Table>`.
 *   Record   The ERP record behind a source chip, previewed without leaving
 *            the conversation.
 *   Sources  Everything the answer stands on, in one list, with the read it
 *            came from.
 *
 * A tab with nothing in it is DISABLED, not hidden. A strip whose tabs appear
 * and disappear as you scroll the thread is a strip nobody learns; one where
 * "Table" is greyed until an answer has a table in it teaches what the pane can
 * do while telling the truth about this answer.
 *
 * WHY A LOCAL TAB STRIP AND NOT `ui/tabs`. `Tabs` is the app's page-level
 * pattern — text labels on a bottom-ruled bar, sized to head a screen. This
 * strip is four icons in 380px inside a pane that is itself a subordinate region
 * of a page. Using the page-level component here would make the pane read as a
 * second page. Radix's roving-tabindex semantics are reproduced by hand below
 * (`role="tablist"` + arrow keys), so nothing is given up for it.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/markdown";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { CheckIcon, DownloadIcon, XIcon } from "@/components/ui/icons";
import { screenByRoute } from "@/app/screen-registry";
import { CopyIcon, DocIcon, LineageIcon, RecordIcon, TableIcon } from "@/components/ai/icons";
import type { AiSource } from "@/components/ai/grounding";
import type { TurnCanvas } from "@/components/ai/turn";

export type PaneTab = "canvas" | "table" | "record" | "sources";

export type PaneState = {
  tab: PaneTab;
  /** The lifted artefact or result set, from the turn the user opened. */
  canvas: TurnCanvas | null;
  /** The source chip being previewed, if any. */
  record: AiSource | null;
  /** Every source across the whole thread, newest answer first. */
  sources: AiSource[];
};

export const EMPTY_PANE: PaneState = { tab: "canvas", canvas: null, record: null, sources: [] };

const TABS: { value: PaneTab; label: string; Icon: (p: { width?: number; height?: number }) => React.JSX.Element }[] = [
  { value: "canvas", label: "Canvas", Icon: DocIcon },
  { value: "table", label: "Table", Icon: TableIcon },
  { value: "record", label: "Record", Icon: RecordIcon },
  { value: "sources", label: "Sources", Icon: LineageIcon },
];

export function AiRightPane({
  state,
  onChange,
  onClose,
}: {
  state: PaneState;
  onChange: (next: PaneState) => void;
  onClose: () => void;
}) {
  const enabled: Record<PaneTab, boolean> = {
    canvas: state.canvas?.kind === "artifact",
    table: state.canvas?.kind === "table",
    record: !!state.record,
    sources: state.sources.length > 0,
  };

  // Keep the strip honest: if the active tab has just emptied (a new answer with
  // no table replaced one that had), fall to the first tab that has something.
  React.useEffect(() => {
    if (enabled[state.tab]) return;
    const next = TABS.find((t) => enabled[t.value])?.value;
    if (next) onChange({ ...state, tab: next });
    // Only when the enablement actually changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled.canvas, enabled.table, enabled.record, enabled.sources]);

  const order = TABS.map((t) => t.value);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div role="tablist" aria-label="Answer views" className="flex min-w-0 flex-1 items-center gap-0.5">
          {TABS.map(({ value, label, Icon }) => {
            const on = state.tab === value;
            const can = enabled[value];
            return (
              <Tooltip key={value} content={can ? label : `${label} — nothing here yet`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={label}
                  disabled={!can}
                  tabIndex={on ? 0 : -1}
                  onClick={() => onChange({ ...state, tab: value })}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    const d = e.key === "ArrowRight" ? 1 : -1;
                    const i = order.indexOf(state.tab);
                    for (let n = 1; n <= order.length; n++) {
                      const cand = order[(i + d * n + order.length * n) % order.length];
                      if (enabled[cand]) return onChange({ ...state, tab: cand });
                    }
                  }}
                  className={cn(
                    "tap-24 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-micro font-medium transition-colors",
                    on
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    !can && "opacity-35 hover:bg-transparent",
                  )}
                >
                  <Icon width={13} height={13} />
                  <span className="max-xl:hidden">{label}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
        <Tooltip content="Close panel">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the answer panel"
            className="tap-24 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon width={14} height={14} />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.tab === "canvas" && <CanvasView canvas={state.canvas} />}
        {state.tab === "table" && <TableView canvas={state.canvas} />}
        {state.tab === "record" && <RecordView source={state.record} />}
        {state.tab === "sources" && (
          <SourcesView
            sources={state.sources}
            onPreview={(s) => onChange({ ...state, tab: "record", record: s })}
          />
        )}
      </div>
    </div>
  );
}

/** Shared empty body, so four tabs cannot invent four ways of being empty. */
function PaneEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-label font-semibold text-foreground">{title}</p>
      <p className="micro mx-auto mt-1 max-w-[24rem] text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * The artefact.
 *
 * Read-only in this pass, and deliberately so. An editable canvas needs a
 * document model, a save target and an answer to "what is this a draft OF" —
 * three questions this product answers per document type, not generically. Copy
 * and download are the two things that make a draft useful today, and neither
 * pretends to be more than it is.
 */
function CanvasView({ canvas }: { canvas: TurnCanvas | null }) {
  const [copied, setCopied] = React.useState(false);
  if (canvas?.kind !== "artifact") {
    return (
      <PaneEmpty
        title="Nothing on the canvas"
        body="When Praxis drafts something long — a proforma, a memo, a summary — open it here for room to read it."
      />
    );
  }

  async function copy() {
    if (canvas?.kind !== "artifact") return;
    try {
      await navigator.clipboard.writeText(canvas.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied; the button simply does not confirm */
    }
  }

  function download() {
    if (canvas?.kind !== "artifact") return;
    const blob = new Blob([canvas.text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${canvas.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate font-display text-label font-semibold">{canvas.title}</h3>
        <Tooltip content={copied ? "Copied" : "Copy"}>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy the draft"
            className="tap-24 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon />}
          </button>
        </Tooltip>
        <Tooltip content="Download as Markdown">
          <button
            type="button"
            onClick={download}
            aria-label="Download the draft"
            className="tap-24 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <DownloadIcon width={14} height={14} />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Markdown text={canvas.text} />
      </div>
    </div>
  );
}

/**
 * The result set, as a table that behaves like one.
 *
 * Sorting is CLIENT-SIDE and numeric-aware: an answer's table is tens of rows,
 * not thousands, so a round trip to sort it would be slower than the sort. The
 * numeric detection is what makes it useful on this product specifically —
 * "1 250 000" and "XAF 1,250,000" both have to sort as a number, or a sort on
 * an amount column is worse than no sort at all.
 */
function TableView({ canvas }: { canvas: TurnCanvas | null }) {
  const [sort, setSort] = React.useState<{ col: number; dir: 1 | -1 } | null>(null);

  const rows = React.useMemo(() => {
    if (canvas?.kind !== "table") return [];
    if (!sort) return canvas.rows;
    const num = (v: string) => {
      const n = Number(v.replace(/[^\d.-]/g, ""));
      return v.trim() && Number.isFinite(n) ? n : null;
    };
    return [...canvas.rows].sort((a, b) => {
      const x = a[sort.col] ?? "";
      const y = b[sort.col] ?? "";
      const nx = num(x);
      const ny = num(y);
      if (nx !== null && ny !== null) return (nx - ny) * sort.dir;
      return x.localeCompare(y, undefined, { numeric: true }) * sort.dir;
    });
  }, [canvas, sort]);

  if (canvas?.kind !== "table") {
    return (
      <PaneEmpty
        title="No result set"
        body="When an answer comes back with rows in it, open them here to sort and export them properly."
      />
    );
  }

  function exportCsv() {
    if (canvas?.kind !== "table") return;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [canvas.header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "praxis-answer.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate font-display text-label font-semibold">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </h3>
        <Tooltip content="Export as CSV">
          <button
            type="button"
            onClick={exportCsv}
            aria-label="Export these rows as CSV"
            className="tap-24 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <DownloadIcon width={14} height={14} />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <TR>
              {canvas.header.map((h, i) => (
                <TH key={i} aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s?.col === i ? { col: i, dir: s.dir === 1 ? -1 : 1 } : { col: i, dir: 1 }))}
                    className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                  >
                    {h}
                    <span aria-hidden className={cn("text-[9px]", sort?.col === i ? "opacity-100" : "opacity-30")}>
                      {sort?.col === i && sort.dir === -1 ? "▼" : "▲"}
                    </span>
                  </button>
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {r.map((c, j) => (
                  <TD key={j} className={j === 0 ? "font-medium text-foreground" : undefined}>
                    {c}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * The record behind a source chip.
 *
 * WHAT THIS IS AND IS NOT, stated plainly because the gap matters. It resolves
 * the reference against the screen registry and shows what the product knows
 * about it — which screen it lives on, what that screen is for, and a way
 * through — so a source chip answers "what am I about to open?" without a
 * navigation you then have to undo.
 *
 * It does NOT render the record's own detail view inline. Doing that needs a
 * registry of preview components keyed by route, one per record type, and
 * inventing that here would be a second rendering path for every detail screen
 * in the product — the exact duplication this codebase keeps having to undo.
 * The pane is built so that adding one later is a swap of this body, not a
 * change to the pane.
 */
function RecordView({ source }: { source: AiSource | null }) {
  if (!source) {
    return (
      <PaneEmpty
        title="No record selected"
        body="Click any source under an answer to preview the record it came from, without losing your place."
      />
    );
  }

  const external = source.kind === "external";
  // Longest registry match, so /finance/invoices/8f2c resolves to Invoices.
  const screen =
    !external
      ? screenByRoute(source.href) ?? screenByRoute(source.href.replace(/\/[^/]+$/, "")) ?? undefined
      : undefined;

  return (
    <div className="px-4 py-4">
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-blue/12 text-brand-blue-ink">
            <RecordIcon width={17} height={17} />
          </span>
          <div className="min-w-0">
            <h3 className="break-words font-display text-title font-semibold leading-tight">{source.label}</h3>
            <p className="micro mt-1 font-mono text-muted-foreground">{source.href}</p>
          </div>
        </div>

        {screen && (
          <dl className="mt-4 space-y-2.5 border-t border-border pt-3">
            <div>
              <dt className="micro text-muted-foreground">Lives on</dt>
              <dd className="text-sm text-foreground">{screen.title}</dd>
            </div>
            {screen.purpose && (
              <div>
                <dt className="micro text-muted-foreground">What that screen is for</dt>
                <dd className="text-sm text-foreground">{screen.purpose}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-4">
          {external ? (
            <a
              href={source.href}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-surface inline-flex h-9 items-center rounded-md px-3 text-[13px] font-medium"
            >
              Open reference
            </a>
          ) : (
            <Link
              to={source.href}
              className="btn-primary inline-flex h-9 items-center rounded-md px-3 text-[13px] font-medium"
            >
              Open {screen?.title ?? "record"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Everything the thread stands on.
 *
 * The per-answer footer says what THIS answer used; this says what the whole
 * conversation has touched, which is the view you want when you are about to
 * act on it. Deduplicated across turns, newest first.
 */
function SourcesView({ sources, onPreview }: { sources: AiSource[]; onPreview: (s: AiSource) => void }) {
  if (!sources.length) {
    return (
      <PaneEmpty
        title="Nothing cited yet"
        body="Records, documents and reports Praxis reads to answer you are collected here as the conversation goes."
      />
    );
  }
  return (
    <div className="px-3 py-3">
      <p className="micro mb-2 px-1 text-muted-foreground">
        {sources.length} reference{sources.length === 1 ? "" : "s"} across this conversation. Everything here was read
        under your own permissions.
      </p>
      <ul className="space-y-0.5">
        {sources.map((s) => (
          <li key={s.href}>
            <button
              type="button"
              onClick={() => onPreview(s)}
              className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded",
                  s.kind === "report" ? "bg-brand-blue/12 text-brand-blue-ink" : "bg-muted text-muted-foreground",
                )}
              >
                <RecordIcon width={11} height={11} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{s.label}</span>
                <span className="micro block truncate font-mono text-muted-foreground">{s.href}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
