/**
 * Proforma advances — record a customer advance against a client or dossier.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Link } from "react-router-dom";
import { tenant, ApiError } from "@/lib/api-client";
import { dateFmt, money as moneyFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import { useOptions, optionLabel } from "./shared";

function AdvancePaymentForm({
  open,
  onClose,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { opts: entities } = useOptions(fin.loadEntities, open);
  const { opts: clients } = useOptions(fin.loadClients, open);
  const { opts: accounts } = useOptions(fin.loadPostableAccounts, open);
  const { opts: dossiers } = useOptions(fin.loadDossiers, open);

  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [dossierId, setDossierId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [treasuryCoa, setTreasuryCoa] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(fin.today());
  const [sourceRef, setSourceRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setClientId("");
    setDossierId("");
    setAmount("");
    setTreasuryCoa("");
    setEntryDate(fin.today());
    setSourceRef("");
    setError(null);
  }, [open]);

  const amt = amount.trim() === "" ? 0 : Number(amount);
  const canSubmit =
    !!entityId && amt > 0 && !!entryDate && !!sourceRef && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fin.payAdvance({
        entity_id: entityId,
        client_id: clientId || undefined,
        dossier_id: dossierId || undefined,
        amount: amt,
        treasury_coa: treasuryCoa || undefined,
        entry_date: entryDate,
        source_doc_ref: sourceRef,
      });
      onPaid();
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
      title="Record customer advance"
      description="Posts the advance to 4191 (customer advances), not revenue."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">Select entity…</option>
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <Select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Select client…</option>
              {clients.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Dossier"
            hint="Links this to an operation file — sets service type and matches advances."
          >
            <Select
              value={dossierId}
              onChange={(e) => setDossierId(e.target.value)}
            >
              <option value="">No dossier</option>
              {dossiers.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" required>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field
            label="Treasury account"
            hint="Bank / cash / mobile-money account that received the funds."
          >
            <Select
              value={treasuryCoa}
              onChange={(e) => setTreasuryCoa(e.target.value)}
            >
              <option value="">Default treasury account</option>
              {accounts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entry date" required>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </Field>
          <Field label="Source document ref" required>
            <Input
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="ADV-2026-0001"
            />
          </Field>
        </div>

        {error && <ErrorState message={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Record advance
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export const ProformasPage = () => {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  // id → name maps so the table shows people-readable values, not UUIDs (§5)
  const [clientName, setClientName] = React.useState<Record<string, string>>(
    {},
  );
  const [dossierRef, setDossierRef] = React.useState<Record<string, string>>(
    {},
  );

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>("/proformas/advances")
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
  React.useEffect(() => {
    fin
      .loadClients()
      .then((o) =>
        setClientName(Object.fromEntries(o.map((x) => [x.id, x.label]))),
      )
      .catch(() => {});
    fin
      .loadDossiers()
      .then((o) =>
        setDossierRef(Object.fromEntries(o.map((x) => [x.id, x.label]))),
      )
      .catch(() => {});
  }, []);

  const str = (r: Record<string, unknown>, k: string) =>
    r[k] == null ? "" : String(r[k]);
  const list = rows ?? [];
  const totalOpen = list.reduce(
    (s, r) =>
      s + Math.max(0, Number(r.amount ?? 0) - Number(r.applied_amount ?? 0)),
    0,
  );
  const columns: Column<Record<string, unknown>>[] = [
    {
      key: "received",
      label: "Received",
      render: (r) =>
        dateFmt(str(r, "received_on") || str(r, "created_at") || null),
    },
    {
      key: "client",
      label: "Client",
      render: (r) => (
        <span className="font-medium text-foreground">
          {clientName[str(r, "client_id")] || "—"}
        </span>
      ),
    },
    {
      key: "dossier",
      label: "Dossier",
      render: (r) => (
        <span className="num text-muted-foreground">
          {dossierRef[str(r, "dossier_id")] ||
            (r.dossier_id ? str(r, "dossier_id").slice(0, 8) : "—")}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      className: "num text-right",
      render: (r) => moneyFmt(Number(r.amount ?? 0)),
    },
    {
      key: "applied",
      label: "Applied",
      className: "num text-right",
      render: (r) => moneyFmt(Number(r.applied_amount ?? 0)),
    },
    {
      key: "open",
      label: "Open",
      className: "num text-right",
      render: (r) => (
        <span className="font-medium">
          {moneyFmt(
            Math.max(0, Number(r.amount ?? 0) - Number(r.applied_amount ?? 0)),
          )}
        </span>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <DocButton
            docType="PROFORMA_ADVANCE"
            id={str(r, "advance_id")}
            title={`Proforma ${clientName[str(r, "client_id")] || ""}`.trim()}
            label="View"
          />
        </div>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title="Proforma & advances"
        description="Advance payments received against a proforma — posts to 4191 (customer advances), not revenue. Priced offers with line items live in Quotations."
        action={
          <div className="flex items-center gap-3">
            <Link
              to="/commercial/quotations"
              className="text-sm text-muted-foreground transition-colors hover:text-primary-ink"
            >
              View quotations →
            </Link>
            <Button onClick={() => setOpen(true)}>Record advance</Button>
          </div>
        }
      />
      <KpiRow>
        <KpiTile label="Advances" value={String(list.length)} />
        <KpiTile label="Open (unapplied)" value={moneyFmt(totalOpen)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={list}
        loading={rows === null}
        error={error}
        rowKey={(r, i) => str(r, "advance_id") || String(i)}
        empty={{
          title: "No advances yet",
          hint: "Record a customer advance to get started.",
        }}
      />

      <AdvancePaymentForm
        open={open}
        onClose={() => setOpen(false)}
        onPaid={reload}
      />
    </section>
  );
};
