/**
 * Master data — suppliers, and how they get paid.
 *
 * Split out of `features/master/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { ActivePill } from "@/components/ui/pill";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { EntitySelect } from "./shared";

const SUPPLIER_AI: AiAction[] = [
  {
    label: "Find duplicate suppliers",
    kind: "assist",
    describe: "Scan the supplier master for likely duplicates by name / NIU.",
  },
  {
    label: "Summarise supplier",
    kind: "read",
    describe:
      "Summarise a supplier's payment method, rating and recent activity.",
  },
];

const PAYMENT_METHODS = ["", "BANK", "CASH", "MOBILE_MONEY", "CHEQUE"];

function SupplierForm({
  open,
  editing,
  entities,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  entities: Row[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entityId, setEntityId] = React.useState("");
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState("");
  const [niu, setNiu] = React.useState("");
  const [rccm, setRccm] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [momoNetwork, setMomoNetwork] = React.useState("");
  const [momoNumber, setMomoNumber] = React.useState("");
  const [nonResident, setNonResident] = React.useState(false);
  const [rating, setRating] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId(editing?.entity_id ? String(editing.entity_id) : "");
    setName(editing?.name ? String(editing.name) : "");
    setType(editing?.supplier_type ? String(editing.supplier_type) : "");
    setNiu(editing?.niu ? String(editing.niu) : "");
    setRccm(editing?.rccm ? String(editing.rccm) : "");
    setMethod(editing?.payment_method ? String(editing.payment_method) : "");
    setMomoNetwork(editing?.momo_network ? String(editing.momo_network) : "");
    setMomoNumber(editing?.momo_number ? String(editing.momo_number) : "");
    setNonResident(editing?.is_non_resident === true);
    setRating(editing?.rating != null ? String(editing.rating) : "");
    setActive(editing?.is_active !== false);
    setError(null);
  }, [open, editing]);

  const isMomo = method === "MOBILE_MONEY";
  const canSubmit = !!name.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      entity_id: entityId || undefined,
      supplier_type: type.trim() || undefined,
      niu: niu.trim() || undefined,
      rccm: rccm.trim() || undefined,
      payment_method: method || undefined,
      momo_network: isMomo ? momoNetwork.trim() || undefined : undefined,
      momo_number: isMomo ? momoNumber.trim() || undefined : undefined,
      is_non_resident: nonResident,
      rating: rating === "" ? undefined : Number(rating),
    };
    if (editing) body.is_active = active;
    try {
      if (editing)
        await tenant(`/suppliers/${String(editing.supplier_id)}`, {
          method: "PATCH",
          body,
        });
      else await tenant("/suppliers", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit supplier" : "New supplier"}
      description="Vendor registry entry — referenced across procurement and payables."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sonara Fuels SA"
            />
          </Field>
          <Field
            label="Corporate entity"
            hint="Which of your legal entities pays this vendor"
            className="sm:col-span-2"
          >
            <EntitySelect
              entities={entities}
              value={entityId}
              onChange={setEntityId}
            />
          </Field>
          <Field label="Category" hint="e.g. Freight, Customs, Fuel">
            <Input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Freight"
            />
          </Field>
          <Field label="Rating (1–5)">
            <Input
              type="number"
              min="1"
              max="5"
              step="1"
              className="num text-right"
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              placeholder="4"
            />
          </Field>
          <Field label="NIU">
            <Input
              value={niu}
              onChange={(e) => setNiu(e.target.value)}
              placeholder="M0987654321B"
            />
          </Field>
          <Field label="RCCM">
            <Input
              value={rccm}
              onChange={(e) => setRccm(e.target.value)}
              placeholder="RC/DLA/2019/B/5678"
            />
          </Field>
          <Field label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m || "none"} value={m}>
                  {m ? m.replace("_", " ") : "— select —"}
                </option>
              ))}
            </Select>
          </Field>
          {isMomo && (
            <>
              <Field label="Mobile-money network">
                <Input
                  value={momoNetwork}
                  onChange={(e) => setMomoNetwork(e.target.value)}
                  placeholder="MTN / Orange"
                />
              </Field>
              <Field label="Mobile-money number">
                <Input
                  value={momoNumber}
                  onChange={(e) => setMomoNumber(e.target.value)}
                  placeholder="6XXXXXXXX"
                />
              </Field>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={nonResident}
            onChange={(e) => setNonResident(e.target.checked)}
          />
          Non-resident (foreign supplier — affects withholding)
        </label>
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save changes" : "Create supplier"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SuppliersPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/suppliers");
  const { rows: entities } = useList("/entities");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setFormOpen(true);
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Suppliers"
        description="Vendor registry referenced across procurement and payables."
        action={<Button onClick={openNew}>New supplier</Button>}
      />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          hint="Create the first supplier to reference it in purchase orders and supplier invoices."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>NIU</TH>
              <TH>Payment</TH>
              <TH>Rating</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.supplier_id)}>
                <TD className="text-sm font-medium">{cell(r.name)}</TD>
                <TD className="text-sm">{cell(r.supplier_type)}</TD>
                <TD className="text-sm">{cell(r.niu)}</TD>
                <TD className="text-sm">
                  {r.payment_method
                    ? cell(r.payment_method).replace("_", " ")
                    : "—"}
                </TD>
                <TD className="num text-sm">
                  {r.rating != null ? `${cell(r.rating)}/5` : "—"}
                </TD>
                <TD className="text-sm">
                  <ActivePill active={r.is_active !== false} />
                </TD>
                <TD>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(r)}
                  >
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <AiActions actions={SUPPLIER_AI} />

      <SupplierForm
        open={formOpen}
        editing={editing}
        entities={entities}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
    </section>
  );
}

/* ──────────────────────────── Corporate entities ──────────────────────────── */
