/**
 * Procurement — purchase orders: the committed order to a supplier.
 *
 * Split out of `features/procurement/pages.tsx` in Phase 4 (audit F7).
 * 10720/10721: the form carries the legacy Finance & Treasury header (currency,
 * delivery, payment terms, bank/MoMo, WHT, advance), drafts are editable, POs
 * can be paid directly (legacy po_mark_paid) and unlocked back to DRAFT
 * (mirroring the costing unlock loop).
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { DocButton } from "@/components/doc-button";
import { DictionaryItemSelect } from "@/components/catalogue-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { useFocusRow } from "@/lib/use-focus-row";
import { RowActions } from "@/components/ui/row-actions";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import type { Entity, Supplier } from "@/lib/masterdata-api";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/procurement-api";
import { map, shell, tone } from "./shared";

const EMPTY_FORM = {
  supplier_id: "",
  dossier_id: "",
  expense_category: "OPERATIONS",
  currency: "XAF",
  delivery_on: "",
  delivery_location: "",
  payment_means: "BANK" as api.PurchaseOrderInput["payment_means"],
  pay_days: "",
  bank: "",
  account_number: "",
  account_name: "",
  momo_network: "",
  momo_number: "",
  air_rate: "",
  adv_paid: "",
  terms: "",
  remarks: "",
};

function PoForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: api.PurchaseOrder | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const usableSuppliers = (suppliers || []).filter(
    (s) => s.registration_status === "ACTIVE"
      && s.verification_status === "VERIFIED"
      && s.avl_status === "APPROVED",
  );
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [f, setF] = React.useState(() => ({
    ...EMPTY_FORM,
    supplier_id: initial?.supplier_id || "",
    dossier_id: initial?.dossier_id || "",
    expense_category: initial?.expense_category || "OPERATIONS",
    currency: initial?.currency || "XAF",
    delivery_on: initial?.delivery_on || "",
    delivery_location: initial?.delivery_location || "",
    payment_means: (initial?.payment_means as api.PurchaseOrderInput["payment_means"]) || "BANK",
    pay_days: initial?.pay_days != null ? String(initial.pay_days) : "",
    bank: initial?.bank_block?.bank || "",
    account_number: initial?.bank_block?.account_number || "",
    account_name: initial?.bank_block?.account_name || "",
    momo_network: initial?.bank_block?.momo_network || "",
    momo_number: initial?.bank_block?.momo_number || "",
    air_rate: initial?.air_rate != null ? String(initial.air_rate) : "",
    adv_paid: initial?.adv_paid != null ? String(initial.adv_paid) : "",
    terms: initial?.terms || "",
    remarks: initial?.remarks || "",
  }));
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [items, setItems] = React.useState<api.PoItem[]>(
    initial?.items?.length
      ? initial.items.map((it) => ({ ...it }))
      : [{ label: "", qty: 1, unit_price: 0 }],
  );
  const setItem = (i: number, p: Partial<api.PoItem>) =>
    setItems((its) => its.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const payload = (): api.PurchaseOrderInput => {
    const bankBlock: api.BankBlock | undefined =
      f.payment_means === "BANK" && (f.bank || f.account_number || f.account_name)
        ? { bank: f.bank, account_number: f.account_number, account_name: f.account_name }
        : f.payment_means === "MOBILE_MONEY" && (f.momo_network || f.momo_number)
          ? { momo_network: f.momo_network, momo_number: f.momo_number }
          : undefined;
    return {
      supplier_id: f.supplier_id || undefined,
      dossier_id: f.dossier_id || undefined,
      expense_category: f.expense_category as api.PurchaseOrderInput["expense_category"],
      currency: f.currency || undefined,
      delivery_on: f.delivery_on || undefined,
      delivery_location: f.delivery_location || undefined,
      payment_means: f.payment_means || undefined,
      pay_days: f.pay_days === "" ? undefined : Number(f.pay_days),
      bank_block: bankBlock,
      air_rate: f.air_rate === "" ? undefined : Number(f.air_rate),
      adv_paid: f.adv_paid === "" ? undefined : Number(f.adv_paid),
      terms: f.terms || undefined,
      remarks: f.remarks || undefined,
      items: items
        .filter((it) => it.dictionary_item_id)
        .map((it) => ({
          dictionary_item_id: it.dictionary_item_id,
          label: it.label,
          qty: Number(it.qty) || 1,
          unit_price: Number(it.unit_price) || 0,
        })),
    };
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        await api.updatePurchaseOrder(initial.po_id, payload());
      } else {
        await api.createPurchaseOrder(payload());
      }
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
      title={initial ? "Edit purchase order" : "New purchase order"}
      description="Order goods/services from a supplier."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-3">
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
          <Field label={tr("Dossier")}>
            <Select
              value={f.dossier_id}
              onChange={(e) => set("dossier_id", e.target.value)}
            >
              <option value="">—</option>
              {(dossiers || []).map((d) => (
                <option key={d.dossier_id} value={d.dossier_id}>
                  {d.ref}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Category")}>
            <Select
              value={f.expense_category}
              onChange={(e) => set("expense_category", e.target.value)}
            >
              <option value="OPERATIONS">{tr("Operations")}</option>
              <option value="OVERHEAD">{tr("Overhead")}</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Currency")}>
            <Select value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              <option value="XAF">XAF</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
          <Field label={tr("Delivery date")}>
            <Input type="date" value={f.delivery_on} onChange={(e) => set("delivery_on", e.target.value)} />
          </Field>
          <Field label={tr("Delivery location")}>
            <Input value={f.delivery_location} onChange={(e) => set("delivery_location", e.target.value)} placeholder="Douala HQ" />
          </Field>
          <Field label={tr("Payment means")}>
            <Select
              value={f.payment_means ?? ""}
              onChange={(e) => set("payment_means", e.target.value)}
            >
              <option value="BANK">Bank</option>
              <option value="CASH">Cash</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
          </Field>
          <Field label={tr("Payment days")}>
            <Input type="number" min={0} className="num" value={f.pay_days} onChange={(e) => set("pay_days", e.target.value)} placeholder="0" />
          </Field>
          <Field label="WHT % (air)">
            <Input type="number" min={0} step="0.01" className="num" value={f.air_rate} onChange={(e) => set("air_rate", e.target.value)} placeholder="5" />
          </Field>
        </div>
        {(f.payment_means === "BANK" || f.payment_means === "MOBILE_MONEY") && (
          <div className="grid gap-4 sm:grid-cols-3">
            {f.payment_means === "BANK" ? (
              <>
                <Field label="Bank">
                  <Input value={f.bank} onChange={(e) => set("bank", e.target.value)} />
                </Field>
                <Field label="Account number">
                  <Input className="num" value={f.account_number} onChange={(e) => set("account_number", e.target.value)} />
                </Field>
                <Field label="Account name">
                  <Input value={f.account_name} onChange={(e) => set("account_name", e.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Network">
                  <Select value={f.momo_network} onChange={(e) => set("momo_network", e.target.value)}>
                    <option value="">—</option>
                    <option value="MTN">MTN</option>
                    <option value="ORANGE">Orange</option>
                  </Select>
                </Field>
                <Field label="MoMo number">
                  <Input className="num" value={f.momo_number} onChange={(e) => set("momo_number", e.target.value)} />
                </Field>
              </>
            )}
            <Field label={tr("Advance paid")}>
              <Input type="number" min={0} className="num" value={f.adv_paid} onChange={(e) => set("adv_paid", e.target.value)} placeholder="0" />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Terms")}>
            <Input value={f.terms} onChange={(e) => set("terms", e.target.value)} />
          </Field>
          <Field label={tr("Remarks")}>
            <Input value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Items</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setItems((i) => [...i, { label: "", qty: 1, unit_price: 0 }])
              }
            >
              + Add item
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_80px_120px_auto] items-end gap-2"
              >
                <Field label={tr("Item")}>
                  <DictionaryItemSelect
                    value={it.dictionary_item_id}
                    valueLabel={it.label}
                    onPick={(id, label) =>
                      setItem(i, { dictionary_item_id: id, label })
                    }
                  />
                </Field>
                <Field label={tr("Qty")}>
                  <Input
                    type="number"
                    className="num text-right"
                    value={String(it.qty ?? "")}
                    onChange={(e) =>
                      setItem(i, { qty: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label={tr("Unit price")}>
                  <Input
                    type="number"
                    className="num text-right"
                    value={String(it.unit_price ?? "")}
                    onChange={(e) =>
                      setItem(i, { unit_price: Number(e.target.value) })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems((its) => its.filter((_, j) => j !== i))
                  }
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
          disabled={busy}
          onCancel={onClose}
          saveLabel={initial ? "Save changes" : "Create PO"}
        />
      </form>
    </Modal>
  );
}

/** Pay a PO directly (legacy po_mark_paid) — no GL post; that's the supplier
 *  invoice's job when one exists. */
function PayForm({
  po,
  onClose,
  onSaved,
}: {
  po: api.PurchaseOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const requested = Number(po.net_payable ?? po.total_ttc ?? 0);
  const paid = Number(po.amount_paid || 0);
  const outstanding = Math.round((requested - paid) * 100) / 100;
  const [f, setF] = React.useState({
    amount: outstanding > 0 ? String(outstanding) : "",
    paid_on: todayISO(),
    note: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.payPurchaseOrder(po.po_id, {
        amount: f.amount.trim() === "" ? undefined : Number(f.amount),
        paid_on: f.paid_on || undefined,
        note: f.note || undefined,
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
      title="Record payment"
      description={`Pay ${po.ref || po.po_id.slice(0, 8)} directly — tracked on the PO; a supplier invoice is the accounting path.`}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Amount")}>
            <Input
              type="number"
              min={0}
              step="0.01"
              className="num"
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          <Field label={tr("Paid on")}>
            <Input
              type="date"
              value={f.paid_on}
              onChange={(e) => set("paid_on", e.target.value)}
            />
          </Field>
          <Field label={tr("Note")} className="sm:col-span-2">
            <Input value={f.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="muted">Outstanding</span>
          <span className="num font-semibold">{money(outstanding)}</span>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy}
          onCancel={onClose}
          saveLabel="Record payment"
        />
      </form>
    </Modal>
  );
}

/** REQUEST_UNLOCK with the reason — the audit trail for reopening (10721). */
function UnlockRequestForm({
  po,
  onClose,
  onSaved,
}: {
  po: api.PurchaseOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.unlockPurchaseOrder(po.po_id, { action: "REQUEST_UNLOCK", reason });
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
      title={tr("Request unlock")}
      description="Asks an approver to reopen this PO for correction. It returns to DRAFT only once the request is granted."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label={tr("Reason")}
          required
          hint="Kept on the PO as the audit trail, whether or not the request is granted."
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy || reason.trim() === ""}
          onCancel={onClose}
          saveLabel={tr("Request unlock")}
        />
      </form>
    </Modal>
  );
}

export function PurchaseOrdersPage() {
  const { rows, error, loading, reload } =
    useList<api.PurchaseOrder>("/purchase-orders");
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const { rows: entities } = useList<Entity>("/entities");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<api.PurchaseOrder | null>(null);
  const [paying, setPaying] = React.useState<api.PurchaseOrder | null>(null);
  const [unlocking, setUnlocking] = React.useState<api.PurchaseOrder | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const sname = map(suppliers, "supplier_id", "name");
  const list = rows || [];
  // `?focus=<po_id>` from the supplier 360's "Open POs" drill-in.
  const { focusId } = useFocusRow(rows);

  async function move(
    p: api.PurchaseOrder,
    to: "ISSUED_LOCKED" | "APPROVED_LOCKED",
  ) {
    setBusyId(p.po_id);
    setActionError(null);
    try {
      const extra =
        to === "ISSUED_LOCKED"
          ? { entity_id: (entities || [])[0]?.entity_id, date: todayISO() }
          : {};
      await api.transitionPO(p.po_id, to, extra);
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  async function unlock(p: api.PurchaseOrder, action: "UNLOCK" | "DENY_UNLOCK") {
    setBusyId(p.po_id);
    setActionError(null);
    try {
      await api.unlockPurchaseOrder(p.po_id, { action });
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<api.PurchaseOrder>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.ref || r.po_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "supplier_id",
      label: "Supplier",
      render: (r) => (r.supplier_id ? sname[r.supplier_id] || "—" : "—"),
    },
    {
      key: "expense_category",
      label: "Category",
      render: (r) =>
        r.expense_category ? (
          <Pill tone="mute">{r.expense_category}</Pill>
        ) : (
          "—"
        ),
    },
    {
      key: "total_ttc",
      label: "Total",
      className: "num text-right",
      render: (r) => money(r.total_ttc),
    },
    {
      key: "net_payable",
      label: "Net payable",
      className: "num text-right",
      render: (r) => (r.net_payable !== null && r.net_payable !== undefined ? money(r.net_payable) : "—"),
    },
    {
      key: "amount_paid",
      label: "Paid",
      className: "num text-right",
      render: (r) =>
        r.amount_paid !== null && r.amount_paid !== undefined && Number(r.amount_paid) > 0
          ? money(r.amount_paid)
          : "—",
    },
    { key: "due_on", label: "Due", render: (r) => (r.due_on ? dateFmt(r.due_on) : "—") },
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
            docType="PURCHASE_ORDER"
            id={r.po_id}
            title={r.ref || `PO ${r.po_id.slice(0, 8)}`}
            label={tr("View")}
          />
          {r.status === "DRAFT" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(r)}
            >
              {tr("Edit")}
            </Button>
          )}
          {(r.status === "DRAFT" || !r.status) && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.po_id}
              onClick={() => move(r, "ISSUED_LOCKED")}
            >
              Issue
            </Button>
          )}
          {r.status === "ISSUED_LOCKED" && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.po_id}
              onClick={() => move(r, "APPROVED_LOCKED")}
            >
              Approve
            </Button>
          )}
          {r.status === "APPROVED_LOCKED" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPaying(r)}
              >
                Record payment
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setUnlocking(r)}
              >
                Request unlock
              </Button>
            </>
          )}
          {["PARTIAL", "RECEIVED"].includes(r.status) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPaying(r)}
            >
              Record payment
            </Button>
          )}
          {r.status === "UNLOCK_REQUESTED" && (
            <>
              <Button
                size="sm"
                variant="outline"
                loading={busyId === r.po_id}
                onClick={() => unlock(r, "UNLOCK")}
                title={r.unlock_reason || undefined}
              >
                Unlock
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={busyId === r.po_id}
                onClick={() => unlock(r, "DENY_UNLOCK")}
              >
                Deny
              </Button>
            </>
          )}
        </RowActions>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Procurement" to="/procurement" />}
        title={tr("Purchase orders")}
        description="Orders raised to suppliers."
        action={<Button onClick={() => setOpen(true)}>New PO</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="POs" value={num(list.length)} />
        <KpiTile
          label={tr("Approved")}
          value={num(
            list.filter((p) => String(p.status).includes("APPROVED")).length,
          )}
        />
        <KpiTile
          label="Spend"
          value={money(
            list.reduce((s, r) => s + (Number(r.total_ttc) || 0), 0),
          )}
        />
        <KpiTile
          label="Unlock requests"
          value={num(list.filter((p) => p.status === "UNLOCK_REQUESTED").length)}
        />
      </KpiRow>
      {actionError && <ErrorState message={actionError} />}
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.po_id}
        highlightRowKey={focusId}
        empty={{
          title: "No purchase orders",
          hint: "Raise a PO to a supplier.",
        }}
      />
      {open && <PoForm onClose={() => setOpen(false)} onSaved={reload} />}
      {editing && (
        <PoForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {paying && (
        <PayForm po={paying} onClose={() => setPaying(null)} onSaved={reload} />
      )}
      {unlocking && (
        <UnlockRequestForm
          po={unlocking}
          onClose={() => setUnlocking(null)}
          onSaved={reload}
        />
      )}
      <ScreenAi path="procurement/purchase-orders" />
    </section>
  );
}
