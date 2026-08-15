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
import { Markdown, renderInline } from "@/components/markdown";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { CheckIcon, DownloadIcon, XIcon } from "@/components/ui/icons";
import { screenByRoute } from "@/app/screen-registry";
import {
  CopyIcon,
  DocIcon,
  LineageIcon,
  RecordIcon,
  TableIcon,
} from "@/components/ai/icons";
import type { AiSource, AiTable } from "@/components/ai/grounding";
import { downloadAiTables } from "@/lib/ai-api";
import { errMsg } from "@/lib/use-resource";
import type { TurnOutput } from "@/components/ai/turn";

export type PaneTab = "canvas" | "table" | "record" | "sources";

export type PaneState = {
  tab: PaneTab;
  /** Everything the latest answer produced — its tables and, separately, its
   *  document. Both, because an answer can be both. */
  output: TurnOutput;
  /** The source chip being previewed, if any. */
  record: AiSource | null;
  /** Every source across the whole thread, newest answer first. */
  sources: AiSource[];
};

export const EMPTY_PANE: PaneState = {
  tab: "table",
  output: { tables: [], artifact: null },
  record: null,
  sources: [],
};

const TABS: {
  value: PaneTab;
  label: string;
  Icon: (p: { width?: number; height?: number }) => React.JSX.Element;
}[] = [
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
    canvas: !!state.output.artifact,
    table: state.output.tables.length > 0,
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
        <div
          role="tablist"
          aria-label="Answer views"
          className="flex min-w-0 flex-1 items-center gap-0.5"
        >
          {TABS.map(({ value, label, Icon }) => {
            const on = state.tab === value;
            const can = enabled[value];
            return (
              <Tooltip
                key={value}
                content={can ? label : `${label} — nothing here yet`}
              >
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
                      const cand =
                        order[(i + d * n + order.length * n) % order.length];
                      if (enabled[cand])
                        return onChange({ ...state, tab: cand });
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
        {state.tab === "canvas" && (
          <CanvasView artifact={state.output.artifact} />
        )}
        {state.tab === "table" && <TableView tables={state.output.tables} />}
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
      <p className="micro mx-auto mt-1 max-w-[24rem] text-muted-foreground">
        {body}
      </p>
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
function CanvasView({
  artifact,
}: {
  artifact: { title: string; text: string } | null;
}) {
  const [copied, setCopied] = React.useState(false);
  if (!artifact) {
    return (
      <PaneEmpty
        title="Nothing on the canvas"
        body="When Praxis drafts something long — a proforma, a memo, a summary — it opens here for room to read it."
      />
    );
  }

  async function copy() {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied; the button simply does not confirm */
    }
  }

  function download() {
    if (!artifact) return;
    const blob = new Blob([artifact.text], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(artifact.title) || "draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate font-display text-label font-semibold">
          {artifact.title}
        </h3>
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
        <Markdown text={artifact.text} />
      </div>
    </div>
  );
}

/** Filename-safe slug for a heading. */
function slug(s: string): string {
  return s
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
}

/**
 * Every table the CONVERSATION has produced, stacked, newest answer first.
 *
 * STACKED, NOT BEHIND A SELECTOR. A five-month projection arrives as Scenario A
 * / B / C, and those three only mean anything COMPARED — a picker that shows one
 * at a time hides two thirds of the point. Stacking also means the labels stay
 * visible, which is what turns seven grids of numbers back into an argument.
 *
 * ACROSS ANSWERS, NOT JUST THE LATEST ONE. The same argument, one level up: a
 * pane holding only the newest answer's tables destroyed the comparison you were
 * making the moment you asked the follow-up that continued it. "What would 25%
 * margin look like" replaced the 20% table with the 25% one, which is precisely
 * the pair you asked in order to see side by side. The thread accumulates them
 * (`workspace.tsx`); this just draws what it is given.
 *
 * Each table sorts independently and exports on its own; the header exports all
 * of them as one workbook, one sheet each.
 */
function TableView({ tables }: { tables: AiTable[] }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (!tables.length) {
    return (
      <PaneEmpty
        title="No tables in this answer"
        body="When an answer comes back with rows in it, they open here — sortable, and exportable to Excel."
      />
    );
  }

  /**
   * All tables as one workbook, one sheet each.
   *
   * SERVER-SIDE, because the platform already owns an ExcelJS toolkit
   * (`src/services/excel/workbook.js`) with the house header style, frozen rows,
   * zebra striping and autofilter — and because the alternative is shipping a
   * spreadsheet writer to every browser that loads the app, for one button, into
   * a bundle this repo actively polices (`check:bundle`).
   */
  async function exportWorkbook() {
    setBusy(true);
    setErr(null);
    try {
      await downloadAiTables(tables);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate font-display text-label font-semibold">
          {tables.length} table{tables.length === 1 ? "" : "s"}
        </h3>
        <Tooltip
          content={
            tables.length === 1
              ? "Export to Excel"
              : `Export all ${tables.length} as one workbook`
          }
        >
          <button
            type="button"
            onClick={exportWorkbook}
            disabled={busy}
            aria-label="Export every table to Excel"
            className="tap-24 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-micro font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <DownloadIcon width={13} height={13} />
            {busy ? "Building…" : "Excel"}
          </button>
        </Tooltip>
      </div>

      {err && (
        <p
          className="border-b border-bad/30 bg-bad-fill/8 px-4 py-2 text-micro text-bad"
          role="alert"
        >
          {err}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tables.map((t, i) => (
          <OneTable key={`${t.title}-${i}`} table={t} index={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * One lifted table.
 *
 * Sorting is CLIENT-SIDE and numeric-aware: an answer's table is tens of rows,
 * not thousands, so a round trip to sort it would be slower than the sort. The
 * numeric detection is what makes it useful on this product specifically —
 * "1 250 000" and "XAF 1,250,000" both have to sort as numbers, or a sort on an
 * amount column is worse than no sort at all.
 *
 * Cells render through the app's inline markdown renderer, because models bold
 * their total rows. Rendered as plain strings, the one row that most needed to
 * read as a total printed `**Total revenue (HT)**` with its asterisks showing.
 */
function OneTable({ table, index }: { table: AiTable; index: number }) {
  const [sort, setSort] = React.useState<{ col: number; dir: 1 | -1 } | null>(
    null,
  );

  const rows = React.useMemo(() => {
    if (!sort) return table.rows;
    const num = (v: string) => {
      const n = Number(v.replace(/[^\d.-]/g, ""));
      return v.trim() && Number.isFinite(n) ? n : null;
    };
    return [...table.rows].sort((a, b) => {
      const x = a[sort.col] ?? "";
      const y = b[sort.col] ?? "";
      const nx = num(x);
      const ny = num(y);
      if (nx !== null && ny !== null) return (nx - ny) * sort.dir;
      return x.localeCompare(y, undefined, { numeric: true }) * sort.dir;
    });
  }, [table.rows, sort]);

  function exportCsv() {
    const esc = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [table.header, ...rows]
      .map((r) => r.map(esc).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(table.title) || `table-${index + 1}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="border-b border-border last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <h4 className="min-w-0 flex-1 truncate text-label font-semibold text-foreground">
          {table.title}
        </h4>
        <span className="micro shrink-0 text-muted-foreground">
          {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
        </span>
        <Tooltip content="Export this table as CSV">
          <button
            type="button"
            onClick={exportCsv}
            aria-label={`Export ${table.title} as CSV`}
            className="tap-24 grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <DownloadIcon width={12} height={12} />
          </button>
        </Tooltip>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              {table.header.map((h, i) => (
                <TH
                  key={i}
                  aria-sort={
                    sort?.col === i
                      ? sort.dir === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) =>
                        s?.col === i
                          ? { col: i, dir: s.dir === 1 ? -1 : 1 }
                          : { col: i, dir: 1 },
                      )
                    }
                    className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                  >
                    {renderInline(h, `h${i}`)}
                    <span
                      aria-hidden
                      className={cn(
                        "text-[9px]",
                        sort?.col === i ? "opacity-100" : "opacity-30",
                      )}
                    >
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
                  <TD
                    key={j}
                    className={
                      j === 0 ? "font-medium text-foreground" : undefined
                    }
                  >
                    {renderInline(c, `c${i}-${j}`)}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </section>
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
 * It does NOT render the record's own detail view inline, and after looking at
 * what that would take, it should not — the blocker is not the registry, it is
 * ADDRESSABILITY.
 *
 * This product is hub-routed. `app.tsx` declares `/finance/:section`,
 * `/fleet/:section`, `/master/:section` and so on; the only record-addressable
 * routes in the whole app are `/master/corporate-entities/:entityId` and
 * `/documents/:docType/:id`. Record detail is rendered INSIDE a hub section, in
 * that section's own component and its own local state, so there is no
 * `<InvoiceDetail id>` to mount here — a preview registry would mean AUTHORING
 * one per record type, which is precisely the second rendering path for every
 * detail screen that this comment was already warning about, ~70 times over.
 *
 * The upstream consequence is sharper: because no record route exists, a
 * citation's href is the SCREEN a record lives on and its identity is carried by
 * the label (see `src/services/ai/answer-sources.js`). So for most sources there
 * is no record id to preview even in principle. The prerequisite for an inline
 * preview is deep-linkable records — once a list screen honours a record
 * deep-link, both this body and `hrefFor` on the server become worth changing,
 * and in that order. Until then this shows what the product actually knows.
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
  const screen = !external
    ? (screenByRoute(source.href) ??
      screenByRoute(source.href.replace(/\/[^/]+$/, "")) ??
      undefined)
    : undefined;

  return (
    <div className="px-4 py-4">
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-blue/12 text-brand-blue-ink"
          >
            <RecordIcon width={17} height={17} />
          </span>
          <div className="min-w-0">
            <h3 className="break-words font-display text-title font-semibold leading-tight">
              {source.label}
            </h3>
            <p className="micro mt-1 font-mono text-muted-foreground">
              {source.href}
            </p>
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
                <dt className="micro text-muted-foreground">
                  What that screen is for
                </dt>
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
function SourcesView({
  sources,
  onPreview,
}: {
  sources: AiSource[];
  onPreview: (s: AiSource) => void;
}) {
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
        {sources.length} reference{sources.length === 1 ? "" : "s"} across this
        conversation. Everything here was read under your own permissions.
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
                  s.kind === "report"
                    ? "bg-brand-blue/12 text-brand-blue-ink"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <RecordIcon width={11} height={11} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">
                  {s.label}
                </span>
                <span className="micro block truncate font-mono text-muted-foreground">
                  {s.href}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
