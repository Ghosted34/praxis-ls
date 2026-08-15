/**
 * Final invoices — the list, its KPI band and the lifecycle actions.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { tenant, ApiError } from "@/lib/api-client";
import { useFocusRow } from "@/lib/use-focus-row";
import { dateFmt, money as moneyFmt, enumLabel, smartCell } from "@/lib/format";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import * as fin from "@/lib/finance-api";
import {
  InvoiceDraftForm,
  InvoiceSubmitForm,
  InvoiceEditForm,
} from "./invoice-forms";

function invField(r: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k];
  return null;
}

export function InvoicesPage() {
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [submitTarget, setSubmitTarget] = React.useState<Record<
    string,
    unknown
  > | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [clientName, setClientName] = React.useState<Record<string, string>>(
    {},
  );
  const navigate = useNavigate();
  const reload = () => setNonce((n) => n + 1);
  // `?focus=<invoice_id>` from the client 360's KPI drill-in — surface the row
  // (ring + scroll) so the user can act on it from the list.
  const { focusId } = useFocusRow(rows);

  React.useEffect(() => {
    fin
      .loadClients()
      .then((opts) =>
        setClientName(Object.fromEntries(opts.map((o) => [o.id, o.label]))),
      )
      .catch(() => {}); // name resolution is best-effort — the table still renders
  }, []);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>("/final-invoices")
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

  const isDraft = (r: Record<string, unknown>) => {
    const s = String(invField(r, ["status", "state"]) ?? "").toUpperCase();
    return s === "" || s === "DRAFT";
  };

  const list = rows ?? [];
  const money0 = (v: unknown) => moneyFmt(v as number | string | null);
  const totalTtc = list.reduce(
    (s, r) =>
      s + (Number(invField(r, ["total_ttc", "total", "amount_ttc"]) ?? 0) || 0),
    0,
  );
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: "ref",
      label: "Number",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {smartCell(invField(r, ["doc_number", "ref"]) ?? "— (draft)")}
        </span>
      ),
    },
    {
      key: "client",
      label: "Client",
      render: (r) =>
        clientName[String(invField(r, ["client_id"]) ?? "")] || "—",
    },
    {
      key: "type",
      label: "Type",
      render: (r) => (
        <span className="text-muted-foreground">
          {smartCell(invField(r, ["type"]))}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const s = String(invField(r, ["status", "state"]) ?? "");
        return s ? (
          <Pill
            tone={
              /PAID|LOCKED|ISSUED/i.test(s)
                ? "ok"
                : /DRAFT/i.test(s)
                  ? "mute"
                  : "blue"
            }
          >
            {enumLabel(s)}
          </Pill>
        ) : (
          <Pill tone="mute">Draft</Pill>
        );
      },
    },
    {
      key: "total",
      label: "Total TTC",
      className: "num text-right",
      render: (r) => money0(invField(r, ["total_ttc", "total", "amount_ttc"])),
    },
    {
      key: "created",
      label: "Created",
      render: (r) =>
        dateFmt(invField(r, ["created_at", "issued_on"]) as string | null),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          {isDraft(r) && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEditId(String(invField(r, ["invoice_id", "id"]) ?? ""))
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSubmitTarget(r)}
              >
                Submit
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigate(
                `/documents/FINAL_INVOICE/${String(invField(r, ["invoice_id", "id"]) ?? "")}?title=${encodeURIComponent(String(invField(r, ["doc_number", "ref"]) ?? "Invoice"))}`,
              )
            }
          >
            View
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title="Invoices"
        description="Final invoices — revenue recognition, clears advance + débours."
        action={<Button onClick={() => setDraftOpen(true)}>New draft</Button>}
      />
      <KpiRow>
        <KpiTile label="Invoices" value={String(list.length)} />
        <KpiTile label="Drafts" value={String(list.filter(isDraft).length)} />
        <KpiTile label="Billed (TTC)" value={money0(totalTtc)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={list}
        loading={rows === null}
        error={error}
        rowKey={(r, i) => String(invField(r, ["invoice_id", "id"]) ?? i)}
        highlightRowKey={focusId}
        empty={{
          title: "No invoices yet",
          hint: "Create a draft to get started.",
        }}
      />

      <InvoiceDraftForm
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        onCreated={reload}
      />
      <InvoiceSubmitForm
        invoice={submitTarget}
        onClose={() => setSubmitTarget(null)}
        onSubmitted={reload}
      />
      <InvoiceEditForm
        invoiceId={editId}
        onClose={() => setEditId(null)}
        onSaved={reload}
      />
    </section>
  );
}
