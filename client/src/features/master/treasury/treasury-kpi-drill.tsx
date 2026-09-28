/**
 * Treasury account 360 → the movement tiles open the ledger lines behind them.
 *
 * "Debits (posted) 48,300,000 XAF" is a sum, and the reader's next question is
 * always which postings made it. Debits, Credits, This month and This year now
 * open the shared drill-in dialog (`components/kpi-details-modal`) listing
 * those lines — read from GET /treasury-accounts/:id/lines with the SAME filter
 * the tile's sum uses (validated entries on this account's GL leaf, the same
 * month / year start), a page at a time, so "of 212" is the number of lines
 * that figure was added up from.
 *
 * WHAT STAYS INERT. Balance and Opening are not sums of a list — opening is a
 * figure someone typed, and the balance is that plus every movement since.
 *
 * A LINE HAS NO PAGE OF ITS OWN, so a row is a fact, not a link; the way out is
 * the Journals screen, where postings are searched and reversed.
 */
import * as React from "react";
import { useListPaged } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import * as api from "@/lib/treasury-api";
import {
  KpiDetailsModal,
  KPI_PAGE_SIZE,
  type KpiDetailRow,
} from "@/components/kpi-details-modal";

export type TreasuryKpiKind = "debits" | "credits" | "mtd" | "ytd";

const JOURNALS_ROUTE = "/finance/journals";

const SPEC: Record<
  TreasuryKpiKind,
  {
    title: string;
    description: string;
    side?: api.TreasuryLineSide;
    period: api.TreasuryLinePeriod;
    empty: string;
  }
> = {
  debits: {
    title: "Debits (posted)",
    side: "debit",
    period: "all",
    description:
      "Every validated posting that debited this account, newest first.",
    empty: "Nothing has been debited to this account yet.",
  },
  credits: {
    title: "Credits (posted)",
    side: "credit",
    period: "all",
    description:
      "Every validated posting that credited this account, newest first.",
    empty: "Nothing has been credited to this account yet.",
  },
  mtd: {
    title: "This month",
    period: "mtd",
    description:
      "Validated postings on this account since the 1st of the month, both sides.",
    empty: "Nothing has been posted to this account this month.",
  },
  ytd: {
    title: "This year",
    period: "ytd",
    description:
      "Validated postings on this account since 1 January, both sides.",
    empty: "Nothing has been posted to this account this year.",
  },
};

/** A zero side is blank rather than "0.00" — the column that moved is the one to read. */
const side = (v: string | number, currency: string) =>
  Number(v) > 0 ? (
    <span className="num whitespace-nowrap">{money(v, currency)}</span>
  ) : (
    ""
  );

export function TreasuryKpiDrill({
  kind,
  accountId,
  accountLabel,
  onClose,
}: {
  kind: TreasuryKpiKind;
  accountId: string;
  accountLabel: string;
  onClose: () => void;
}) {
  const spec = SPEC[kind];
  const [page, setPage] = React.useState(0);
  const list = useListPaged<api.TreasuryLine>(
    api.treasuryLinesPath(accountId),
    {
      page,
      pageSize: KPI_PAGE_SIZE,
      side: spec.side,
      period: spec.period,
    },
  );
  const rows: KpiDetailRow[] = (list.rows || []).map((l) => ({
    id: l.line_id,
    cells: [
      <span key="d" className="whitespace-nowrap">
        {dateFmt(l.entry_date)}
      </span>,
      <span key="j" className="num whitespace-nowrap">
        {l.journal_code} · {l.entry_no}
      </span>,
      <span key="desc">
        {cell(l.description)}
        {l.source_doc_ref ? (
          <span className="block text-xs text-muted-foreground">
            {l.source_doc_ref}
          </span>
        ) : null}
      </span>,
      <span key="f" className="num whitespace-nowrap">
        {l.dossier_ref || "—"}
      </span>,
      side(l.debit, l.currency),
      side(l.credit, l.currency),
    ],
  }));
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`${spec.title} · ${accountLabel}`}
      description={spec.description}
      headers={[
        { label: "Date" },
        { label: "Journal · No" },
        { label: "Description" },
        { label: "File" },
        { label: "Debit", right: true },
        { label: "Credit", right: true },
      ]}
      rows={rows}
      emptyLabel={spec.empty}
      loading={list.loading}
      error={list.error}
      paging={{
        page,
        pageSize: KPI_PAGE_SIZE,
        total: list.total,
        onPageChange: setPage,
      }}
      viewAll={{ label: "View more in Journals", href: JOURNALS_ROUTE }}
      size="wide"
    />
  );
}
