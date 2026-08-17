/**
 * Credit notes — the list, against locked final invoices.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7). The write
 * forms live in `./credit-note-forms`.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { dateFmt, money as moneyFmt, enumLabel, smartCell } from "@/lib/format";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import * as fin from "@/lib/finance-api";
import type { CreditNote } from "@/lib/finance-api";
import {
  CreditNoteCreateForm,
  CreditNoteEditForm,
  CreditNotePostForm,
} from "./credit-note-forms";

export function CreditNotesPage() {
  const [rows, setRows] = React.useState<CreditNote[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [postTarget, setPostTarget] = React.useState<CreditNote | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    fin
      .listCreditNotes()
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403)
          setError("You don't have permission to view this.");
        else setError(e instanceof ApiError ? e.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const isDraft = (r: CreditNote) => {
    const s = String(r.status ?? "").toUpperCase();
    return s === "" || s === "DRAFT";
  };

  const list = rows ?? [];
  const columns: Column<CreditNote>[] = [
    {
      key: "ref",
      label: "Number",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {smartCell(r.doc_number ?? "— (draft)")}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const s = String(r.status ?? "");
        return s ? (
          <Pill
            tone={
              /POSTED|LOCKED/i.test(s)
                ? "ok"
                : /DRAFT/i.test(s)
                  ? "mute"
                  : "blue"
            }
          >
            {enumLabel(s)}
          </Pill>
        ) : (
          <Pill tone="mute">{tr("Draft")}</Pill>
        );
      },
    },
    {
      key: "total",
      label: "Total TTC",
      className: "num text-right",
      render: (r) => moneyFmt(r.total_ttc as number | string | null),
    },
    {
      key: "created",
      label: "Created",
      render: (r) => dateFmt(r.created_at as string | null),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end gap-2">
          <DocButton
            docType="CREDIT_NOTE"
            id={String(r.invoice_id ?? r.credit_note_id ?? "")}
            title={r.doc_number ? String(r.doc_number) : "Credit note"}
            label={tr("View")}
          />
          {isDraft(r) && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditId(String(r.credit_note_id))}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPostTarget(r)}
              >
                Post
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title={tr("Credit notes")}
        description="Reverse a finalised invoice — draft, then post the contra entry."
        action={
          <Button onClick={() => setCreateOpen(true)}>New credit note</Button>
        }
      />
      <KpiRow>
        <KpiTile label={tr("Credit notes")} value={String(list.length)} />
        <KpiTile label={tr("Drafts")} value={String(list.filter(isDraft).length)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={list}
        loading={rows === null}
        error={error}
        rowKey={(r) => String(r.credit_note_id)}
        empty={{
          title: "No credit notes yet",
          hint: "Create one to reverse a finalised invoice.",
        }}
      />

      <CreditNoteCreateForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />
      <CreditNoteEditForm
        creditNoteId={editId}
        onClose={() => setEditId(null)}
        onSaved={reload}
      />
      <CreditNotePostForm
        creditNote={postTarget}
        onClose={() => setPostTarget(null)}
        onPosted={reload}
      />
    </section>
  );
}
