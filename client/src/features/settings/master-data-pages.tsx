/** Master-data settings screens wired to live endpoints:
 *  - CurrenciesPage       → MOD-08 /currencies (+ /currencies/rates, POST rate)
 *  - TaxJurisdictionsPage → MOD-07 /tax-jurisdictions (+ /:id/codes)
 *  Same primitives + patterns as features/finance/pages.tsx. */
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";

type Row = Record<string, unknown>;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    return e.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Load a resource into state, keyed on a reload nonce. */
function useList(path: string, nonce: number) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Row[]>(path)
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [path, nonce]);
  return { rows, error };
}

/* ─────────────────────────── Currencies (MOD-08) ─────────────────────────── */

function SetRateForm({ open, onClose, onSaved, codes }: { open: boolean; onClose: () => void; onSaved: () => void; codes: string[] }) {
  const [base, setBase] = React.useState("");
  const [quote, setQuote] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [asOf, setAsOf] = React.useState(today());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setBase("");
    setQuote("");
    setRate("");
    setAsOf(today());
    setError(null);
  }, [open]);

  const canSubmit = !!base && !!quote && base !== quote && Number(rate) > 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/currencies/rates", { method: "POST", body: { base, quote, rate: Number(rate), as_of_date: asOf } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Set FX rate" description="Record a manual override rate for a currency pair (as-of dated).">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Base" required>
            <Select value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Select…</option>
              {codes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quote" required error={base && quote && base === quote ? "Base and quote must differ" : undefined}>
            <Select value={quote} onChange={(e) => setQuote(e.target.value)}>
              <option value="">Select…</option>
              {codes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate" hint="1 base = ? quote" required>
            <Input type="number" min="0" step="0.000001" className="num text-right" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="655.957" />
          </Field>
          <Field label="As of" required>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Save rate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CurrenciesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows: currencies, error: curErr } = useList("/currencies", nonce);
  const { rows: rates, error: rateErr } = useList("/currencies/rates", nonce);
  const [rateOpen, setRateOpen] = React.useState(false);

  const codes = (currencies || []).map((c) => String(c.code ?? "")).filter(Boolean);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Currencies & FX</h1>
          <p className="mt-1 text-sm text-muted-foreground">Active currencies and exchange rates. Manual overrides are as-of dated (MOD-08).</p>
        </div>
        <Button onClick={() => setRateOpen(true)} disabled={codes.length < 2}>
          Set rate
        </Button>
      </header>

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Currencies</h2>
      {curErr ? (
        <ErrorState message={curErr} />
      ) : currencies === null ? (
        <LoadingRow />
      ) : currencies.length === 0 ? (
        <EmptyState title="No currencies" hint="Currencies are seeded per tenant." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Symbol</TH>
              <TH>Base</TH>
            </TR>
          </THead>
          <TBody>
            {currencies.map((c, i) => (
              <TR key={i}>
                <TD className="text-sm font-medium">{cell(c.code)}</TD>
                <TD className="text-sm">{cell(c.name)}</TD>
                <TD className="text-sm">{cell(c.symbol)}</TD>
                <TD className="text-sm">{c.is_base ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">base</span> : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold text-muted-foreground">Exchange rates</h2>
      {rateErr ? (
        <ErrorState message={rateErr} />
      ) : rates === null ? (
        <LoadingRow />
      ) : rates.length === 0 ? (
        <EmptyState title="No rates yet" hint="Set a rate or wait for the daily FX sync." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Pair</TH>
              <TH>Rate</TH>
              <TH>As of</TH>
              <TH>Source</TH>
              <TH>Override</TH>
            </TR>
          </THead>
          <TBody>
            {rates.map((r, i) => (
              <TR key={i}>
                <TD className="text-sm font-medium">
                  {cell(r.base_code)} → {cell(r.quote_code)}
                </TD>
                <TD className="num text-sm">{cell(r.rate)}</TD>
                <TD className="text-sm">{cell(r.as_of_date)}</TD>
                <TD className="text-sm">{cell(r.source)}</TD>
                <TD className="text-sm">{r.is_override ? "yes" : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <SetRateForm open={rateOpen} onClose={() => setRateOpen(false)} onSaved={reload} codes={codes} />
    </section>
  );
}

/* ───────────────────── Tax jurisdictions + codes (MOD-07) ───────────────────── */

function NewJurisdictionForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [country, setCountry] = React.useState("CM");
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCountry("CM");
    setName("");
    setCurrency("XAF");
    setError(null);
  }, [open]);

  const canSubmit = !!name.trim() && !!country.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/tax-jurisdictions", { method: "POST", body: { country_code: country.trim().toUpperCase(), name: name.trim(), currency: currency.trim().toUpperCase() } });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New tax jurisdiction" description="A jurisdiction groups the effective-dated tax codes (TVA, WHT, IS…) that account determination reads.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Country" hint="ISO code" required>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="CM" />
          </Field>
          <Field label="Name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cameroon (CEMAC)" />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="XAF" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const TAX_CODE_KINDS = ["TVA", "WHT", "IS", "MIN_TAX", "PATENTE", "OTHER"];

function AddCodeForm({ jurisdictionId, onClose, onAdded }: { jurisdictionId: string | null; onClose: () => void; onAdded: () => void }) {
  const open = !!jurisdictionId;
  const [code, setCode] = React.useState("");
  const [kind, setKind] = React.useState("TVA");
  const [ratePercent, setRatePercent] = React.useState("");
  const [appliesTo, setAppliesTo] = React.useState("");
  const [recoverable, setRecoverable] = React.useState(false);
  const [effectiveFrom, setEffectiveFrom] = React.useState(today());
  const [effectiveTo, setEffectiveTo] = React.useState("");
  const [legalRef, setLegalRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setKind("TVA");
    setRatePercent("");
    setAppliesTo("");
    setRecoverable(false);
    setEffectiveFrom(today());
    setEffectiveTo("");
    setLegalRef("");
    setError(null);
  }, [open]);

  const canSubmit = !!code.trim() && Number(ratePercent) >= 0 && ratePercent !== "" && !busy;

  async function submit() {
    if (!jurisdictionId) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/tax-jurisdictions/${jurisdictionId}/codes`, {
        method: "POST",
        body: {
          code: code.trim().toUpperCase(),
          kind,
          rate_percent: Number(ratePercent),
          applies_to: appliesTo || undefined,
          recoverable,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || undefined,
          legal_reference: legalRef || undefined,
        },
      });
      onAdded();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add tax code" description="Effective-dated rate card. To change a rate later, add a new code that supersedes it — history is never edited." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TVA-19.25" />
          </Field>
          <Field label="Kind" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {TAX_CODE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate %" required>
            <Input type="number" min="0" step="0.01" className="num text-right" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} placeholder="19.25" />
          </Field>
          <Field label="Applies to" hint="e.g. SALES, PURCHASES">
            <Input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="SALES" />
          </Field>
          <Field label="Effective from" required>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Effective to" hint="Blank = open-ended">
            <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
          </Field>
          <Field label="Legal reference" className="sm:col-span-2">
            <Input value={legalRef} onChange={(e) => setLegalRef(e.target.value)} placeholder="CGI art. 149" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={recoverable} onChange={(e) => setRecoverable(e.target.checked)} />
          Recoverable (input VAT credit)
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Add code
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CodesPanel({ jurisdictionId, nonce, onAddCode }: { jurisdictionId: string; nonce: number; onAddCode: () => void }) {
  const { rows: codes, error } = useList(`/tax-jurisdictions/${jurisdictionId}/codes`, nonce);
  return (
    <div className="mt-2 rounded-lg border bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Tax codes</span>
        <Button size="sm" variant="outline" onClick={onAddCode}>
          + Add code
        </Button>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : codes === null ? (
        <LoadingRow label="Loading codes…" />
      ) : codes.length === 0 ? (
        <EmptyState title="No tax codes" hint="Add a rate card to this jurisdiction." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Kind</TH>
              <TH>Rate %</TH>
              <TH>Applies to</TH>
              <TH>From</TH>
              <TH>To</TH>
            </TR>
          </THead>
          <TBody>
            {codes.map((c, i) => (
              <TR key={i}>
                <TD className="text-sm font-medium">{cell(c.code)}</TD>
                <TD className="text-sm">{cell(c.kind)}</TD>
                <TD className="num text-sm">{cell(c.rate_percent)}</TD>
                <TD className="text-sm">{cell(c.applies_to)}</TD>
                <TD className="text-sm">{cell(c.effective_from)}</TD>
                <TD className="text-sm">{cell(c.effective_to)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function TaxJurisdictionsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/tax-jurisdictions", nonce);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [addCodeFor, setAddCodeFor] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function setActive(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/tax-jurisdictions/${id}/active`, { method: "POST", body: { active } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tax rates & jurisdictions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Jurisdictions and their effective-dated tax codes (TVA/WHT/IS…) read by account determination (MOD-07).</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New jurisdiction</Button>
      </header>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="No jurisdictions yet" hint="Create one to start adding tax codes." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Country</TH>
              <TH>Name</TH>
              <TH>Currency</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.jurisdiction_id);
              const active = r.is_active !== false;
              const isOpen = expandedId === id;
              return (
                <React.Fragment key={id}>
                  <TR>
                    <TD className="text-sm font-medium">{cell(r.country_code)}</TD>
                    <TD className="text-sm">{cell(r.name)}</TD>
                    <TD className="text-sm">{cell(r.currency)}</TD>
                    <TD className="text-sm">
                      {active ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">active</span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">inactive</span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setExpandedId(isOpen ? null : id)}>
                          {isOpen ? "Hide codes" : "Codes"}
                        </Button>
                        <Button size="sm" variant={active ? "outline" : "default"} loading={rowBusy === id} onClick={() => setActive(id, !active)}>
                          {active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                  {isOpen && (
                    <TR>
                      <TD colSpan={5}>
                        <CodesPanel jurisdictionId={id} nonce={nonce} onAddCode={() => setAddCodeFor(id)} />
                      </TD>
                    </TR>
                  )}
                </React.Fragment>
              );
            })}
          </TBody>
        </Table>
      )}

      <NewJurisdictionForm open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
      <AddCodeForm jurisdictionId={addCodeFor} onClose={() => setAddCodeFor(null)} onAdded={reload} />
    </section>
  );
}
