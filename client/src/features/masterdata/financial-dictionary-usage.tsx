/**
 * Financial dictionary 360 — the usage drill-ins.
 *
 * The five tiles under a line's header (Costings, Cash requests, Invoices,
 * Purchase orders, Rates) said "14" and stopped there, which left the reader to
 * go and find those fourteen somewhere else — and the question they were asking
 * was always "which ones": which costings, for which client, on which file.
 * Each tile now opens the same drill-in dialog the party and entity 360s use
 * (`components/kpi-details-modal`), listing the rows it counts.
 *
 * THE LIST IS THE COUNT. The server reads the same table with the same filter
 * as the tile (GET /financial-dictionary/:id/usage/:kind — see the repo), and
 * pages it: a core charge sits on thousands of costing lines, so the dialog
 * fetches twenty at a time and says "Showing 1–20 of 3,412" under a tile that
 * says 3,412. A capped prefix would have said "of 200".
 *
 * ONE ROW PER LINE, not per document, for the same reason: a costing that
 * carries this charge twice (once per container type) is counted twice, so it
 * is listed twice — with each line's label under the document number so the
 * two rows are told apart.
 *
 * WHERE A ROW GOES. Costing sheets and cash requests have their own 360 route,
 * so a row opens the record. Invoices and purchase orders open their module's
 * list focused on the row (`?focus=`, `lib/use-focus-row.ts`). A proforma or a
 * credit note opens its own list: neither screen lists invoice rows to focus.
 * Rates have no page of their own — every rate row opens this line on Expense
 * rates, which is where a rate is changed.
 *
 * AND THE WAY OUT. "View more in Costing" (and its siblings) under the table is
 * the module that owns the rows, for when twenty-at-a-time is not the job.
 */
import * as React from "react";
import { Pill } from "@/components/ui/pill";
import { tr, tv } from "@/lib/i18n";
import { useListPaged } from "@/lib/use-resource";
import { dateFmt, enumLabel, money, num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import {
  KpiDetailsModal,
  KPI_PAGE_SIZE,
  type KpiDetailHeader,
  type KpiDetailRow,
} from "@/components/kpi-details-modal";

type Tone = React.ComponentProps<typeof Pill>["tone"];

/**
 * Where a document row lands. Shared with the Spend tab's "Underlying
 * documents", so a costing opens the same way from both.
 */
export const COSTING_ROUTE = "/costing/costing";
export const CASH_REQUEST_ROUTE = "/costing/cash-requests";
export const PURCHASE_ORDER_ROUTE = "/procurement/purchase-orders";
const INVOICE_ROUTE = "/finance/invoices";
const EXPENSE_RATES_ROUTE = "/master/expense-rates";

const recordHref = (base: string, id: string) =>
  `${base}/${encodeURIComponent(id)}`;
const focusHref = (base: string, id: string) =>
  `${base}?focus=${encodeURIComponent(id)}`;

/** A proforma and a credit note each have their own list; neither lists invoice
 *  rows to focus, so they open the list. A `Map` so a type the server adds later
 *  falls through to the invoices list instead of to `undefined`. */
const INVOICE_TYPE_ROUTE = new Map<string, string>([
  ["PROFORMA", "/finance/proformas"],
  ["CREDIT_NOTE", "/finance/credit-notes"],
]);
const invoiceHref = (r: api.DictUsageDoc) =>
  INVOICE_TYPE_ROUTE.get(String(r.doc_type)) ??
  focusHref(INVOICE_ROUTE, r.doc_id);

/** Status → pill tone. The status vocabularies differ per module, so this
 *  reads the word rather than listing every module's states. */
function statusTone(s?: string | null): Tone {
  const t = String(s || "").toUpperCase();
  if (!t) return "mute";
  if (/CANCEL|REJECT|REVERS/.test(t)) return "bad";
  if (/SUBMITTED|REQUESTED|PENDING/.test(t)) return "warn";
  if (t === "DRAFT") return "mute";
  return "ok";
}

type DocSpec = {
  /** Plural noun for the title — the tile's own label. */
  title: string;
  /** The first column's header: what one document is called. */
  docHeader: string;
  /** Client, or Supplier on a purchase order. */
  partyHeader: string;
  href: (r: api.DictUsageDoc) => string;
  viewAll: { label: string; href: string };
  empty: string;
  opens: string;
};

const DOC_SPECS: Record<Exclude<api.DictUsageKind, "rates">, DocSpec> = {
  costings: {
    title: "Costings",
    docHeader: "Costing",
    partyHeader: "Client",
    href: (r) => recordHref(COSTING_ROUTE, r.doc_id),
    viewAll: { label: "View more in Costing", href: COSTING_ROUTE },
    empty: "No costing sheet uses this line yet.",
    opens: "Click a row to open the costing sheet.",
  },
  cash_requests: {
    title: "Cash requests",
    docHeader: "Request",
    partyHeader: "Client",
    href: (r) => recordHref(CASH_REQUEST_ROUTE, r.doc_id),
    viewAll: { label: "View more in Cash requests", href: CASH_REQUEST_ROUTE },
    empty: "No cash request uses this line yet.",
    opens: "Click a row to open the cash request.",
  },
  invoices: {
    title: "Invoices",
    docHeader: "Invoice",
    partyHeader: "Client",
    href: invoiceHref,
    viewAll: { label: "View more in Invoices", href: INVOICE_ROUTE },
    empty: "No invoice uses this line yet.",
    opens: "Click a row to open it in Invoices.",
  },
  purchase_orders: {
    title: "Purchase orders",
    docHeader: "PO",
    partyHeader: "Supplier",
    href: (r) => focusHref(PURCHASE_ORDER_ROUTE, r.doc_id),
    viewAll: {
      label: "View more in Purchase orders",
      href: PURCHASE_ORDER_ROUTE,
    },
    empty: "No purchase order uses this line yet.",
    opens: "Click a row to open it in Purchase orders.",
  },
};

/**
 * The muted second line under a row's first cell. The first cell is the row's
 * link, and an underline propagates into every in-flow descendant whatever the
 * descendant says — so this is an INLINE-BLOCK after a break: an atomic box is
 * the one thing a parent's text decoration does not reach, and the line reads
 * as a caption rather than as more of the link.
 */
function SubLine({ children }: { children: React.ReactNode }) {
  return (
    <>
      <br />
      <span className="inline-block text-xs font-normal text-muted-foreground">
        {children}
      </span>
    </>
  );
}

/**
 * A reference, a date or an amount — the cells that must never break. In the
 * desktop table the columns share the dialog's width, and without this the
 * browser takes it from whichever cell breaks most easily: "CST-2026-" over
 * "0199", "255,000.00" over "XAF". The client name is the one cell allowed to
 * wrap, which is where the width should come from.
 */
function OneLine({
  children,
  num,
}: {
  children: React.ReactNode;
  num?: boolean;
}) {
  return (
    <span className={num ? "num whitespace-nowrap" : "whitespace-nowrap"}>
      {children}
    </span>
  );
}

/** The document number, or — for a draft that has not been numbered yet — the
 *  word Draft and enough of the id to tell two drafts apart. */
const docName = (r: api.DictUsageDoc) =>
  r.doc_number || `${tr("Draft")} ${r.doc_id.slice(0, 8)}`;

function docRow(r: api.DictUsageDoc, spec: DocSpec): KpiDetailRow {
  // The type rides on the second line for invoices ("Proforma · Transport"),
  // where the number alone does not say which kind of document it is.
  const sub = [r.doc_type ? enumLabel(r.doc_type) : null, r.label]
    .filter(Boolean)
    .join(" · ");
  return {
    id: r.row_id,
    href: spec.href(r),
    cells: [
      <span key="doc">
        <span className="num whitespace-nowrap font-medium">{docName(r)}</span>
        {sub ? <SubLine>{sub}</SubLine> : null}
      </span>,
      <OneLine key="file" num>
        {r.dossier_ref || "—"}
      </OneLine>,
      r.party_name || "—",
      <Pill key="status" tone={statusTone(r.status)}>
        {enumLabel(r.status)}
      </Pill>,
      <OneLine key="date">{dateFmt(r.doc_date)}</OneLine>,
      <OneLine key="amount" num>
        {money(r.amount, r.currency)}
      </OneLine>,
    ],
  };
}

function rateRow(r: api.DictUsageRate, itemId: string): KpiDetailRow {
  const equipment = r.container_type_name || r.container_type_code;
  return {
    id: r.row_id,
    href: focusHref(EXPENSE_RATES_ROUTE, itemId),
    cells: [
      <span key="who">
        <span className="font-medium">
          {r.provider_name || tr("Standard rate")}
        </span>
        {equipment ? <SubLine>{equipment}</SubLine> : null}
      </span>,
      <OneLine key="rate" num>
        {money(r.rate, r.currency)}
      </OneLine>,
      <OneLine key="from">{dateFmt(r.effective_from)}</OneLine>,
      <OneLine key="to">
        {r.effective_to ? dateFmt(r.effective_to) : "—"}
      </OneLine>,
      r.in_force ? (
        <Pill key="state" tone="ok">
          {tr("In force")}
        </Pill>
      ) : r.superseded ? (
        <Pill key="state" tone="mute">
          {tr("Superseded")}
        </Pill>
      ) : (
        <Pill key="state" tone="blue">
          {tr("Scheduled")}
        </Pill>
      ),
    ],
  };
}

/**
 * The drill-in for one tile. Mounted only while open, so no tile fetches a
 * list nobody asked for.
 */
export function DictUsageDrill({
  item,
  kind,
  count,
  onClose,
}: {
  item: Pick<
    api.DictFull,
    "dictionary_item_id" | "code" | "label_en" | "label_fr"
  >;
  kind: api.DictUsageKind;
  /** The tile's figure — what the dialog's total is expected to match. */
  count: number;
  onClose: () => void;
}) {
  const itemId = item.dictionary_item_id;
  const [page, setPage] = React.useState(0);
  const list = useListPaged<api.DictUsageDoc | api.DictUsageRate>(
    api.dictUsagePath(itemId, kind),
    { page, pageSize: KPI_PAGE_SIZE },
  );
  const name = item.label_en || item.label_fr || item.code;
  const paging = {
    page,
    pageSize: KPI_PAGE_SIZE,
    total: list.total,
    onPageChange: setPage,
  };

  if (kind === "rates") {
    const rows = ((list.rows || []) as api.DictUsageRate[]).map((r) =>
      rateRow(r, itemId),
    );
    const headers: KpiDetailHeader[] = [
      { label: tr("Carrier / authority") },
      { label: tr("Rate"), right: true },
      { label: tr("From") },
      { label: tr("To") },
      { label: tr("State") },
    ];
    return (
      <KpiDetailsModal
        open
        onClose={onClose}
        title={`${tr("Rates")} · ${item.code}`}
        description={tv(
          "Every rate recorded for {{name}}, the ones in force first. Click a row to change it in Expense rates.",
          { name },
        )}
        headers={headers}
        rows={rows}
        emptyLabel={tr(
          "This line has no rate yet. Set its standard rate from the Overview tab or in Expense rates.",
        )}
        loading={list.loading}
        error={list.error}
        paging={paging}
        viewAll={{
          label: tr("View more in Expense rates"),
          href: focusHref(EXPENSE_RATES_ROUTE, itemId),
        }}
      />
    );
  }

  const spec = DOC_SPECS[kind];
  const rows = ((list.rows || []) as api.DictUsageDoc[]).map((r) =>
    docRow(r, spec),
  );
  const headers: KpiDetailHeader[] = [
    { label: tr(spec.docHeader) },
    { label: tr("File") },
    { label: tr(spec.partyHeader) },
    { label: tr("Status") },
    { label: tr("Date") },
    { label: tr("Amount"), right: true },
  ];
  // Invoices are narrowed to the types the viewer may open (finals and credit
  // notes are one grant, proformas another), so their total can fall short of
  // the tile. Say so, rather than leave two numbers that disagree unexplained.
  const hidden =
    kind === "invoices" && !list.loading && !list.error
      ? count - list.total
      : 0;
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`${tr(spec.title)} · ${item.code}`}
      description={`${tv("Lines that use {{name}}, newest first.", { name })} ${tr(spec.opens)}`}
      headers={headers}
      rows={rows}
      emptyLabel={tr(spec.empty)}
      moreHint={
        hidden > 0
          ? tv(
              "{{count}} more are on invoice types you do not have access to.",
              { count: num(hidden) },
            )
          : undefined
      }
      loading={list.loading}
      error={list.error}
      paging={paging}
      viewAll={{ label: tr(spec.viewAll.label), href: spec.viewAll.href }}
      size="wide"
    />
  );
}
