/**
 * Settings — currencies and FX rates, plus the automatic-sync card.
 *
 * Split out of `features/settings/master-data-pages.tsx` (565 lines) in Phase 4,
 * audit F7.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { smartCell, todayISO } from "@/lib/format";

function SetRateForm({ open, onClose, onSaved, codes }: { open: boolean; onClose: () => void; onSaved: () => void; codes: string[] }) {
  const [base, setBase] = React.useState("");
  const [quote, setQuote] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [asOf, setAsOf] = React.useState(todayISO());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setBase("");
    setQuote("");
    setRate("");
    setAsOf(todayISO());
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

/* Automatic FX sync key — the exchangerate-api.com key the daily FX cron uses.
 * Encrypted + write-only (only last4 shown), with a live connection test. Lives
 * here, in Currencies & FX, next to the rates it populates. */
function FxSyncCard() {
  const { rows, reload } = useList("/settings/integration_secret");
  const fx = (rows || []).find((r) => String(r.key) === "fx_exchangerate");
  const last4 = (fx?.value as { last4?: string } | undefined)?.last4;
  const isSet = !!last4;
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await tenant("/settings/integration_secret/fx_exchangerate", {
        method: "PUT",
        body: { value: { provider: "exchangerate-api", key_name: "EXCHANGERATE_API_KEY", secret } },
      });
      setSecret("");
      reload();
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await tenant<{ ok?: boolean; error?: string }>("/settings/integration_secret/fx_exchangerate/test", { method: "POST" });
      setMsg({ ok: r.ok === true, text: r.ok ? "Connected." : r.error || "Test failed." });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Automatic FX sync</h3>
          <p className="text-xs text-muted-foreground">Daily rates from exchangerate-api.com. The key is encrypted — only the last 4 characters are shown.</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isSet ? "bg-ok-fill/15 text-ok" : "bg-muted text-muted-foreground"}`}>
          {isSet ? `key set · …${last4}` : "no key"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="API key" hint={isSet ? "Leave blank to keep the current key." : "exchangerate-api.com key."}>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={isSet ? "•••••• (unchanged)" : "paste key…"} />
        </Field>
      </div>
      {msg && <div className={`mt-2 text-sm ${msg.ok ? "text-ok" : "text-destructive"}`}>{msg.text}</div>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" loading={testing} onClick={test} disabled={!isSet && !secret}>Test</Button>
        <Button size="sm" loading={busy} onClick={save} disabled={!secret}>Save</Button>
      </div>
    </div>
  );
}

export function CurrenciesPage() {
  const reload = useRefresh();
  const { rows: currencies, error: curErr } = useList("/currencies");
  const { rows: rates, error: rateErr } = useList("/currencies/rates");
  const [rateOpen, setRateOpen] = React.useState(false);

  const codes = (currencies || []).map((c) => String(c.code ?? "")).filter(Boolean);

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Currencies & FX" description="Active currencies and exchange rates. Manual overrides are as-of dated." action={<Button onClick={() => setRateOpen(true)} disabled={codes.length < 2}>Set rate</Button>} />
      <HubTabs />

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Currencies</h2>
      {curErr ? (
        <ErrorState message={curErr} />
      ) : currencies === null ? (
        <SkeletonTable />
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
                <TD className="text-sm font-medium">{smartCell(c.code)}</TD>
                <TD className="text-sm">{smartCell(c.name)}</TD>
                <TD className="text-sm">{smartCell(c.symbol)}</TD>
                <TD className="text-sm">{c.is_base ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">base</span> : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold text-muted-foreground">Exchange rates</h2>
      <div className="mb-4">
        <FxSyncCard />
      </div>
      {rateErr ? (
        <ErrorState message={rateErr} />
      ) : rates === null ? (
        <SkeletonTable />
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
                  {smartCell(r.base_code)} → {smartCell(r.quote_code)}
                </TD>
                <TD className="num text-sm">{smartCell(r.rate)}</TD>
                <TD className="text-sm">{smartCell(r.as_of_date)}</TD>
                <TD className="text-sm">{smartCell(r.source)}</TD>
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

/* ───────────────────── Tax jurisdictions + codes ───────────────────── */
