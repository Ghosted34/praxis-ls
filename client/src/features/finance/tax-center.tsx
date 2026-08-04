/**
 * Tax centre — computed returns, and the file → approve → submit workflow.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7).
 */
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { dateFmt, money as moneyFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Modal, Field, Select } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import type { TaxKind, TaxDeclaration } from "@/lib/finance-api";
import { useOptions, optionLabel } from "./shared";
import { ReportTabs } from "./report-view";

function DeclStatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "FILED"
      ? "bg-primary/10 text-primary"
      : s === "APPROVED"
        ? "bg-[rgb(var(--ok)/0.15)] text-[rgb(var(--ok))]"
        : s === "COMPUTED"
          ? "bg-[rgb(var(--warn)/0.15)] text-[rgb(var(--warn))]"
          : "bg-muted text-muted-foreground";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{s || "DRAFT"}</span>;
}

function FileDeclarationForm({ open, onClose, onFiled }: { open: boolean; onClose: () => void; onFiled: () => void }) {
  const { opts: entities } = useOptions(fin.loadEntities, open);
  const [entityId, setEntityId] = React.useState("");
  const [kind, setKind] = React.useState<TaxKind>("TVA");
  const [periodCode, setPeriodCode] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [dueOn, setDueOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setKind("TVA");
    setPeriodCode("");
    setFrom("");
    setTo("");
    setDueOn("");
    setError(null);
  }, [open]);

  const validPeriod = /^\d{4}(-\d{2})?$/.test(periodCode);
  const canSubmit = validPeriod && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fin.fileDeclaration({
        entity_id: entityId || undefined,
        kind,
        period_code: periodCode,
        from: from || undefined,
        to: to || undefined,
        due_on: dueOn || undefined,
      });
      onFiled();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="File a return" description="Persists the GL-computed return as a declaration (DRAFT/COMPUTED), then approve and submit." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" hint="Leave blank for all entities">
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">All entities</option>
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Return type" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as TaxKind)}>
              {fin.TAX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period code" hint="YYYY or YYYY-MM" required error={periodCode && !validPeriod ? "Use YYYY or YYYY-MM" : undefined}>
            <Input value={periodCode} onChange={(e) => setPeriodCode(e.target.value)} placeholder="2026-06" />
          </Field>
          <Field label="Due on">
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            File return
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SubmitDeclarationForm({ declaration, onClose, onSubmitted }: { declaration: TaxDeclaration | null; onClose: () => void; onSubmitted: () => void }) {
  const [filedRef, setFiledRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!declaration) return;
    setFiledRef(String(declaration.filed_ref ?? ""));
    setError(null);
  }, [declaration]);

  async function submit() {
    if (!declaration) return;
    setBusy(true);
    setError(null);
    try {
      await fin.submitDeclaration(String(declaration.declaration_id), { filed_ref: filedRef || undefined });
      onSubmitted();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!declaration} onClose={onClose} title="Submit declaration" description="Marks the return FILED with the tax authority's acknowledgement reference.">
      <div className="space-y-4">
        <Field label="Filed reference" hint="Receipt / acknowledgement number from the tax portal">
          <Input value={filedRef} onChange={(e) => setFiledRef(e.target.value)} placeholder="DGI-2026-…" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy}>
            Mark filed
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeclarationsPanel() {
  const [rows, setRows] = React.useState<TaxDeclaration[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [fileOpen, setFileOpen] = React.useState(false);
  const [submitTarget, setSubmitTarget] = React.useState<TaxDeclaration | null>(null);
  const [approvingId, setApprovingId] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    fin.listDeclarations()
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setError("You don't have permission to view declarations.");
        else setError(e instanceof ApiError ? e.message : "Failed to load declarations.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  async function approve(id: string) {
    setApprovingId(id);
    setRowError(null);
    try {
      await fin.approveDeclaration(id);
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setFileOpen(true)}>File a return</Button>
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No declarations yet" hint="File a computed return to start the filing workflow." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Type</TH>
              <TH>Period</TH>
              <TH>Amount</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const s = String(r.status ?? "").toUpperCase();
              const id = String(r.declaration_id);
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{String(r.kind ?? "—")}</TD>
                  <TD className="text-sm">{String(r.period_code ?? "—")}</TD>
                  <TD className="num text-sm">{moneyFmt(r.amount as number | string | null)}</TD>
                  <TD className="text-sm">{dateFmt(r.due_on as string | null)}</TD>
                  <TD>
                    <DeclStatusPill status={s} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      {(s === "COMPUTED" || s === "DRAFT") && (
                        <Button size="sm" variant="outline" loading={approvingId === id} onClick={() => approve(id)}>
                          Approve
                        </Button>
                      )}
                      {s === "APPROVED" && (
                        <Button size="sm" onClick={() => setSubmitTarget(r)}>
                          Submit
                        </Button>
                      )}
                      {s === "FILED" && (
                        <span className="text-xs text-muted-foreground">{r.filed_ref ? `filed · ${r.filed_ref}` : "filed"}</span>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <FileDeclarationForm open={fileOpen} onClose={() => setFileOpen(false)} onFiled={reload} />
      <SubmitDeclarationForm declaration={submitTarget} onClose={() => setSubmitTarget(null)} onSubmitted={reload} />
    </div>
  );
}

export const TaxCenterPage = () => (
  <ReportTabs
    title="Tax center"
    description="OHADA/Cameroon tax outputs."
    tabs={[
      { key: "vat", label: "TVA return", path: "/tax/vat-return" },
      { key: "is", label: "Corporate tax", path: "/tax/corporate-tax" },
      { key: "declarations", label: "Declarations / filing", render: () => <DeclarationsPanel /> },
    ]}
  />
);
