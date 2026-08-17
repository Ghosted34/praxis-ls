/**
 * Procurement — supplier invoices, and the three-way match they settle into.
 *
 * Split out of `features/procurement/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { useFocusRow } from "@/lib/use-focus-row";
import { RowActions } from "@/components/ui/row-actions";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import type { Entity, Supplier } from "@/lib/masterdata-api";
import * as api from "@/lib/procurement-api";
import { map, shell, tone } from "./shared";

function SupplierInvoiceForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const usableSuppliers = (suppliers || []).filter(
    (s) => s.registration_status === "ACTIVE"
      && s.verification_status === "VERIFIED"
      && s.avl_status === "APPROVED",
  );
  const [f, setF] = React.useState({
    entity_id: "",
    supplier_id: "",
    supplier_ref: "",
    due_on: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [lines, setLines] = React.useState<api.SupplierInvoiceLine[]>([
    { label: "", unit_price: 0, expense_account: "" },
  ]);
  const setLine = (i: number, p: Partial<api.SupplierInvoiceLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const valid = lines.filter(
      (l) => l.expense_account && Number(l.unit_price) >= 0,
    );
    if (valid.length === 0) {
      setError("Add at least one line with an expense account.");
      setBusy(false);
      return;
    }
    try {
      await api.createSupplierInvoice({
        entity_id: f.entity_id,
        supplier_id: f.supplier_id || undefined,
        supplier_ref: f.supplier_ref || undefined,
        due_on: f.due_on || undefined,
        lines: valid.map((l) => ({
          label: l.label,
          qty: l.qty ? Number(l.qty) : undefined,
          unit_price: Number(l.unit_price),
          expense_account: l.expense_account,
        })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New supplier invoice"
      description="Capture a vendor invoice for matching and posting."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Entity")} required>
            <Select
              value={f.entity_id}
              onChange={(e) => set("entity_id", e.target.value)}
            >
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Supplier")}>
            <Select
              value={f.supplier_id}
              onChange={(e) => set("supplier_id", e.target.value)}
            >
              <option value="">—</option>
              {usableSuppliers.map((s) => (
                <option key={s.supplier_id} value={s.supplier_id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier ref">
            <Input
              value={f.supplier_ref}
              onChange={(e) => set("supplier_ref", e.target.value)}
            />
          </Field>
          <Field label={tr("Due on")}>
            <Input
              type="date"
              value={f.due_on}
              onChange={(e) => set("due_on", e.target.value)}
            />
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">{tr("Lines")}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setLines((l) => [
                  ...l,
                  { label: "", unit_price: 0, expense_account: "" },
                ])
              }
            >
              + Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_110px_120px_auto] items-end gap-2"
              >
                <Field label={tr("Label")}>
                  <Input
                    value={l.label ?? ""}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                  />
                </Field>
                <Field label={tr("Unit price")}>
                  <Input
                    type="number"
                    className="num text-right"
                    value={String(l.unit_price ?? "")}
                    onChange={(e) =>
                      setLine(i, { unit_price: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Expense acct">
                  <Input
                    className="num"
                    value={l.expense_account ?? ""}
                    onChange={(e) =>
                      setLine(i, { expense_account: e.target.value })
                    }
                    placeholder="6…"
                  />
                </Field>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!f.entity_id || busy}
          onCancel={onClose}
          saveLabel="Create invoice"
        />
      </form>
    </Modal>
  );
}

export function SupplierInvoicesPage() {
  const { rows, error, loading, reload } =
    useList<api.SupplierInvoice>("/supplier-invoices");
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const sname = map(suppliers, "supplier_id", "name");
  const list = rows || [];
  // `?focus=<supplier_invoice_id>` from the supplier 360's payables drill-ins.
  const { focusId } = useFocusRow(rows);

  async function post(inv: api.SupplierInvoice) {
    setBusyId(inv.supplier_invoice_id);
    try {
      await api.postSupplierInvoice(inv.supplier_invoice_id, {
        entry_date: todayISO(),
      });
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<api.SupplierInvoice>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.ref || r.supplier_invoice_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "supplier_id",
      label: "Supplier",
      render: (r) => (r.supplier_id ? sname[r.supplier_id] || "—" : "—"),
    },
    {
      key: "amount_ttc",
      label: "Amount",
      className: "num text-right",
      render: (r) => money(r.amount_ttc),
    },
    { key: "due_on", label: "Due", render: (r) => dateFmt(r.due_on) },
    {
      key: "status",
      label: "Status",
      render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <RowActions>
          <DocButton
            docType="SUPPLIER_INVOICE"
            id={r.supplier_invoice_id}
            title={r.ref || `Invoice ${r.supplier_invoice_id.slice(0, 8)}`}
            label={tr("View")}
          />
          {!String(r.status).includes("POSTED") && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.supplier_invoice_id}
              onClick={() => post(r)}
            >
              Post
            </Button>
          )}
        </RowActions>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Procurement" to="/procurement" />}
        title="Supplier invoices"
        description="Vendor invoices — capture, match, post to the GL."
        action={<Button onClick={() => setOpen(true)}>New invoice</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label={tr("Invoices")} value={num(list.length)} />
        <KpiTile
          label={tr("Posted")}
          value={num(
            list.filter((i) => String(i.status).includes("POSTED")).length,
          )}
        />
        <KpiTile
          label="Payable"
          value={money(
            list
              .filter((i) => !String(i.status).includes("POSTED"))
              .reduce((s, r) => s + (Number(r.amount_ttc) || 0), 0),
          )}
        />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.supplier_invoice_id}
        highlightRowKey={focusId}
        empty={{
          title: "No supplier invoices",
          hint: "Capture a vendor invoice to pay.",
        }}
      />
      {open && (
        <SupplierInvoiceForm onClose={() => setOpen(false)} onSaved={reload} />
      )}
      <ScreenAi path="procurement/supplier-invoices" />
    </section>
  );
}
