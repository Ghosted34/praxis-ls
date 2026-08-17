/**
 * Procurement — purchase requests: the internal ask, before a supplier exists.
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
import { DictionaryItemSelect } from "@/components/catalogue-select";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import {
  DepartmentSelect,
  type DepartmentValue,
} from "@/components/department-select";
import { RowActions } from "@/components/ui/row-actions";
import { num } from "@/lib/format";
import * as api from "@/lib/procurement-api";
import { shell, tone } from "./shared";

/* ═══════════════════ Purchase requests ═══════════════════ */

type PrLine = {
  dictionary_item_id: string;
  label: string;
  qty: string;
  unit_price: string;
};
const blankPrLine = (): PrLine => ({
  dictionary_item_id: "",
  label: "",
  qty: "1",
  unit_price: "",
});

function PrForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  // Department is a scope (0490) — carries both the reference and the display
  // snapshot the API stores beside it.
  const [dept, setDept] = React.useState<DepartmentValue>({
    scope_id: null,
    department: null,
  });
  const [justification, setJustification] = React.useState("");
  const [lines, setLines] = React.useState<PrLine[]>([blankPrLine()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setLine = (i: number, patch: Partial<PrLine>) =>
    setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cleaned = lines
        .filter((l) => l.dictionary_item_id)
        .map((l) => ({
          dictionary_item_id: l.dictionary_item_id,
          label: l.label,
          qty: Number(l.qty) || 1,
          unit_price: Number(l.unit_price) || 0,
        }));
      await api.createPurchaseRequest({
        scope_id: dept.scope_id || undefined,
        department: dept.department || undefined,
        justification: justification || undefined,
        lines: cleaned.length ? cleaned : undefined,
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
      title="New purchase request"
      description="Ask for a purchase to be raised."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label={tr("Department")}
          hint={tr("From your organigramme — Security › Scopes.")}
        >
          <DepartmentSelect value={dept} onChange={setDept} />
        </Field>
        <Field label="Justification">
          <Input
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Why this is needed"
          />
        </Field>
        <div className="space-y-2">
          <div className="micro">Items</div>
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_70px_110px_auto] items-center gap-2"
            >
              <DictionaryItemSelect
                value={l.dictionary_item_id}
                valueLabel={l.label}
                onPick={(id, label) =>
                  setLine(i, { dictionary_item_id: id, label })
                }
              />
              <Input
                type="number"
                min="0"
                step="any"
                className="num text-right"
                value={l.qty}
                onChange={(e) => setLine(i, { qty: e.target.value })}
                placeholder={tr("Qty")}
              />
              <Input
                type="number"
                min="0"
                step="any"
                className="num text-right"
                value={l.unit_price}
                onChange={(e) => setLine(i, { unit_price: e.target.value })}
                placeholder="Unit (XAF)"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLines((s) =>
                    s.length > 1 ? s.filter((_, idx) => idx !== i) : s,
                  )
                }
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((s) => [...s, blankPrLine()])}
          >
            Add item
          </Button>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={busy}
          onCancel={onClose}
          saveLabel="Create request"
        />
      </form>
    </Modal>
  );
}

export function PurchaseRequestsPage() {
  const { rows, error, loading, reload } =
    useList<api.PurchaseRequest>("/purchase-requests");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const list = rows || [];
  // try/finally with no catch swallowed every failure — the button span, then
  // nothing, and the row unchanged. That is exactly how the milestone-advance
  // bug hid a 422 for weeks (session 17). Surface it.
  const [actionError, setActionError] = React.useState<string | null>(null);
  async function submitPr(p: api.PurchaseRequest) {
    setBusyId(p.pr_id);
    setActionError(null);
    try {
      await api.transitionPR(p.pr_id, "SUBMITTED");
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }
  const columns: Column<api.PurchaseRequest>[] = [
    {
      key: "ref",
      label: "Ref",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.ref || r.pr_id.slice(0, 8)}
        </span>
      ),
    },
    { key: "department", label: "Department" },
    { key: "justification", label: "Justification" },
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
            docType="PURCHASE_REQUEST"
            id={r.pr_id}
            title={r.ref || `Request ${r.pr_id.slice(0, 8)}`}
            label={tr("View")}
          />
          {(r.status === "DRAFT" || !r.status) && (
            <Button
              size="sm"
              variant="outline"
              loading={busyId === r.pr_id}
              onClick={() => submitPr(r)}
            >
              Submit
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
        title="Purchase requests"
        description="Requests to buy, before a PO is raised."
        action={<Button onClick={() => setOpen(true)}>{tr("New request")}</Button>}
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Requests" value={num(list.length)} />
        <KpiTile
          label={tr("Approved")}
          value={num(list.filter((p) => p.status === "APPROVED").length)}
        />
        <KpiTile
          label="Submitted"
          value={num(list.filter((p) => p.status === "SUBMITTED").length)}
        />
      </KpiRow>
      {actionError && <ErrorState message={actionError} />}
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.pr_id}
        empty={{
          title: "No purchase requests",
          hint: "Raise a request to start procurement.",
        }}
      />
      {open && <PrForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="procurement/purchase-requests" />
    </section>
  );
}

/* ═══════════════════ Purchase orders ═══════════════════ */
