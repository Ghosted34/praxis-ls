/**
 * Settings — Currencies & FX.
 *
 * A currency command centre modelled on the client / entity 360: a searchable
 * list on the left (base, most-used and active state at a glance), a rich
 * per-currency dossier on the right. Currencies are added from the ISO-4217
 * catalogue (searchable by country too — "Holland" finds EUR), edited,
 * activated/deactivated, deleted (FK-safe), and any one can be made the base.
 * Live rates sync from exchangerate-api.com on demand ("Sync now") and nightly;
 * the API key lives behind a ⚙ Settings modal. Manual overrides stay as-of dated
 * and always win over the feed.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { currencies as ccyLib } from "@shared";
import { flagOf } from "@/components/smart-country-picker";
import { SmartCurrencyPicker } from "@/components/smart-currency-picker";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select, ConfirmDialog } from "@/components/ui/modal";
import { smartCell, num, dateTimeFmt, dateFmt, todayISO } from "@/lib/format";

/* ── Types ────────────────────────────────────────────────────────────────── */

type Currency = {
  code: string;
  name: string;
  symbol: string | null;
  is_base: boolean;
  is_active: boolean;
  decimals: number;
  usage_count?: number;
  most_used?: boolean;
  created_at?: string;
  updated_at?: string;
};
type Rate = {
  base_code?: string;
  quote_code?: string;
  rate: number | string;
  as_of_date: string;
  source: string;
  is_override?: boolean;
  fetched_at?: string;
};
type UsageRow = { table: string; label: string; count: number };
type Dossier = {
  currency: Currency;
  base: string | null;
  is_base: boolean;
  catalogue: { code: string; name: string; symbol: string; decimals: number; numeric: string } | null;
  countries: { code: string; name: string }[];
  rate_history: Rate[];
  latest_rate: Rate | null;
  last_sync: Rate | null;
  overrides: Rate[];
  usage: UsageRow[];
  usage_total: number;
};
type SyncResult = { skipped?: boolean; reason?: string; base?: string; updated?: { quote: string; rate: number }[]; unsupported?: string[]; fetched_at?: string; source?: string };

/* ── Small helpers ────────────────────────────────────────────────────────── */

const SAMPLE = 1234567.89;
const fmtSample = (decimals: number) => SAMPLE.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const rateNum = (r: Rate | null | undefined) => (r == null ? null : Number(r.rate));

/** FX rates span many magnitudes (655.957, 0.00163) — keep the significant
 *  digits `num()`'s 3-decimal default would round away, without trailing zeros. */
function fmtRate(v: number | string) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 }) : "—";
}

/** A partial/array payload (e.g. an unmocked test route) is not a dossier. */
function asDossier(data: unknown): Dossier | null {
  if (!data || Array.isArray(data) || typeof data !== "object") return null;
  return "currency" in (data as Record<string, unknown>) ? (data as Dossier) : null;
}

/** Tiny inline trend line — no chart lib. Green when the latest ≥ the oldest. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 140;
  const h = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Rate trend" className="shrink-0">
      <polyline points={pts} fill="none" stroke={up ? "rgb(var(--ok))" : "rgb(var(--bad))"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SectionCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ── Add currency (from the ISO-4217 catalogue) ───────────────────────────── */

function AddCurrencyModal({ open, onClose, onSaved, existing }: { open: boolean; onClose: () => void; onSaved: (code: string) => void; existing: string[] }) {
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [symbol, setSymbol] = React.useState("");
  const [decimals, setDecimals] = React.useState(2);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setSymbol("");
    setDecimals(2);
    setError(null);
  }, [open]);

  // Prefill the editable fields from the catalogue the moment a currency is picked.
  function pick(c: string) {
    setCode(c);
    const cat = ccyLib.byCode(c);
    if (cat) {
      setName(cat.name);
      setSymbol(cat.symbol || "");
      setDecimals(cat.decimals);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/currencies", { method: "POST", body: { code, name, symbol: symbol || null, decimals: Number(decimals) } });
      onSaved(code);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !!code && !!name.trim() && !busy;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add currency"
      description="Search the ISO-4217 library — by currency or by country ('Holland' finds EUR). Details prefill from the catalogue and stay editable."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>Add currency</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Currency" hint="Type a currency code/name, or a country to look it up." required>
          <SmartCurrencyPicker value={code} onChange={pick} exclude={existing} />
        </Field>
        {code && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Symbol">
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. €" />
            </Field>
            <Field label="Decimals" hint="Minor units (0 for XAF/JPY, 2 for most, 3 for Gulf dinars).">
              <Input type="number" min="0" max="6" className="num" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} />
            </Field>
            <Field label="Preview">
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 num text-sm">
                {symbol ? `${symbol} ` : ""}
                {fmtSample(Number(decimals) || 0)}
              </div>
            </Field>
          </div>
        )}
        {error && <ErrorState message={error} />}
      </div>
    </Modal>
  );
}

/* ── Edit currency ────────────────────────────────────────────────────────── */

function EditCurrencyModal({ row, onClose, onSaved }: { row: Currency | null; onClose: () => void; onSaved: () => void }) {
  const open = !!row;
  const [name, setName] = React.useState("");
  const [symbol, setSymbol] = React.useState("");
  const [decimals, setDecimals] = React.useState(2);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!row) return;
    setName(row.name ?? "");
    setSymbol(row.symbol ?? "");
    setDecimals(row.decimals ?? 2);
    setError(null);
  }, [row]);

  async function submit() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/currencies/${row.code}`, { method: "PATCH", body: { name: name.trim(), symbol: symbol || null, decimals: Number(decimals) } });
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
      title={row ? `Edit ${row.code}` : "Edit currency"}
      description="Change how this currency is named and formatted. The code is fixed."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || busy}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Symbol">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
        <Field label="Decimals">
          <Input type="number" min="0" max="6" className="num" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} />
        </Field>
        <Field label="Preview">
          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 num text-sm">
            {symbol ? `${symbol} ` : ""}
            {fmtSample(Number(decimals) || 0)}
          </div>
        </Field>
        {error && <div className="sm:col-span-2"><ErrorState message={error} /></div>}
      </div>
    </Modal>
  );
}

/* ── Set FX rate (manual override, as-of dated) ───────────────────────────── */

function SetRateForm({ open, onClose, onSaved, codes, initialBase, initialQuote }: { open: boolean; onClose: () => void; onSaved: () => void; codes: string[]; initialBase?: string; initialQuote?: string }) {
  const [base, setBase] = React.useState("");
  const [quote, setQuote] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [asOf, setAsOf] = React.useState(todayISO());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setBase(initialBase ?? "");
    setQuote(initialQuote ?? "");
    setRate("");
    setAsOf(todayISO());
    setError(null);
  }, [open, initialBase, initialQuote]);

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
    <Modal
      open={open}
      onClose={onClose}
      title="Set FX rate"
      description="Record a manual override rate for a currency pair (as-of dated). Overrides always win over the live feed."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>Save rate</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Base" required>
          <Select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">Select…</option>
            {codes.map((c) => (<option key={c} value={c}>{c}</option>))}
          </Select>
        </Field>
        <Field label="Quote" required error={base && quote && base === quote ? "Base and quote must differ" : undefined}>
          <Select value={quote} onChange={(e) => setQuote(e.target.value)}>
            <option value="">Select…</option>
            {codes.map((c) => (<option key={c} value={c}>{c}</option>))}
          </Select>
        </Field>
        <Field label="Rate" hint="1 base = ? quote" required>
          <Input type="number" min="0" step="0.000001" className="num text-right" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="655.957" />
        </Field>
        <Field label="As of" required>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        {error && <div className="sm:col-span-2"><ErrorState message={error} /></div>}
      </div>
    </Modal>
  );
}

/* ── Automatic FX sync key — now behind a ⚙ Settings modal ─────────────────── */

function FxSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { rows, reload } = useList("/settings/integration_secret");
  const fx = (rows || []).find((r) => String(r.key) === "fx_exchangerate");
  const last4 = (fx?.value as { last4?: string } | undefined)?.last4;
  const isSet = !!last4;
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setSecret("");
      setMsg(null);
    }
  }, [open]);

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
      setMsg({ ok: true, text: "Saved." });
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
    <Modal
      open={open}
      onClose={onClose}
      title="Automatic FX sync"
      description="Daily rates from exchangerate-api.com. The key is encrypted — only the last 4 characters are ever shown."
      headerRight={<Pill tone={isSet ? "ok" : "mute"}>{isSet ? `key set · …${last4}` : "no key"}</Pill>}
      footer={
        <>
          <Button variant="outline" loading={testing} onClick={test} disabled={!isSet && !secret}>Test</Button>
          <Button loading={busy} onClick={save} disabled={!secret}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="API key" hint={isSet ? "Leave blank to keep the current key." : "Paste your exchangerate-api.com key."}>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={isSet ? "•••••• (unchanged)" : "paste key…"} />
        </Field>
        {msg && <div className={`text-sm ${msg.ok ? "text-ok" : "text-destructive"}`}>{msg.text}</div>}
        <p className="text-xs text-muted-foreground">Rates sync every night; use “Sync now” on the page to pull immediately. The base currency is quoted against every active currency.</p>
      </div>
    </Modal>
  );
}

/* ── Currency 360 dossier ─────────────────────────────────────────────────── */

function CurrencyDossier({ code, onChanged, onEdit, onSetRate, allCodes }: { code: string; onChanged: () => void; onEdit: (c: Currency) => void; onSetRate: (base: string, quote: string) => void; allCodes: string[] }) {
  const res = useResource<Dossier | null>(() => tenant<Dossier>(`/currencies/${code}/360`), [code]);
  const d = asDossier(res.data);
  const [confirm, setConfirm] = React.useState<null | "base" | "deactivate" | "activate" | "delete">(null);
  const [busy, setBusy] = React.useState(false);
  const [actionErr, setActionErr] = React.useState<string | null>(null);

  const reloadAll = () => {
    res.reload();
    onChanged();
  };

  async function run(kind: "base" | "deactivate" | "activate" | "delete") {
    setBusy(true);
    setActionErr(null);
    try {
      if (kind === "base") await tenant("/currencies/base", { method: "POST", body: { code } });
      else if (kind === "delete") await tenant(`/currencies/${code}`, { method: "DELETE" });
      else await tenant(`/currencies/${code}`, { method: "PATCH", body: { is_active: kind === "activate" } });
      setConfirm(null);
      reloadAll();
    } catch (e) {
      setActionErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (res.error) return <ErrorState message={res.error} />;
  if (!d) return <div className="rounded-2xl border bg-card p-8"><LoadingRow label="Loading currency…" /></div>;

  const c = d.currency;
  const cat = d.catalogue;
  const decimals = c.decimals ?? cat?.decimals ?? 2;
  const symbol = c.symbol || cat?.symbol || "";
  const flag = flagOf(ccyLib.representativeCountry(code));
  const history = d.rate_history || [];
  const values = history.map(rateNum).filter((v): v is number => v != null).reverse();
  const latest = d.latest_rate;

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-2xl">{flag}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="num text-lg font-semibold">{c.code}</span>
                {c.is_base && <Pill tone="blue">Base</Pill>}
                <Pill tone={c.is_active ? "ok" : "mute"}>{c.is_active ? "Active" : "Off"}</Pill>
                {c.most_used && <Pill tone="orange">Most used</Pill>}
              </div>
              <p className="text-sm text-muted-foreground">{c.name}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!c.is_base && <Button size="sm" variant="outline" onClick={() => setConfirm("base")}>Set as base</Button>}
            <Button size="sm" variant="outline" onClick={() => onEdit(c)}>Edit</Button>
            {!c.is_base && (c.is_active
              ? <Button size="sm" variant="outline" onClick={() => setConfirm("deactivate")}>Deactivate</Button>
              : <Button size="sm" variant="outline" onClick={() => setConfirm("activate")}>Activate</Button>)}
            {!c.is_base && <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>Delete</Button>}
          </div>
        </div>
        {actionErr && <div className="mt-3"><ErrorState message={actionErr} /></div>}
      </div>

      {/* Overview & format */}
      <SectionCard title="Overview & format">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Symbol" value={symbol || "—"} />
          <Stat label="Decimals" value={String(decimals)} />
          <Stat label="ISO numeric" value={cat?.numeric ?? "—"} />
          <Stat label="Amount preview" value={`${symbol ? symbol + " " : ""}${fmtSample(decimals)}`} mono />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stat label="Added" value={c.created_at ? dateFmt(c.created_at) : "—"} />
          <Stat label="Last changed" value={c.updated_at ? dateTimeFmt(c.updated_at) : "—"} />
        </div>
        {d.countries.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs text-muted-foreground">Used in {d.countries.length} {d.countries.length === 1 ? "country" : "countries"}</div>
            <div className="flex flex-wrap gap-1.5">
              {d.countries.slice(0, 14).map((co) => (
                <span key={co.code} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                  <span aria-hidden>{flagOf(co.code)}</span>
                  {co.name}
                </span>
              ))}
              {d.countries.length > 14 && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">+{d.countries.length - 14} more</span>}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Rate history & trend */}
      <SectionCard
        title={`Rate history vs ${d.base ?? "base"}`}
        right={values.length >= 2 ? <Sparkline values={values} /> : undefined}
      >
        {c.is_base ? (
          <p className="text-sm text-muted-foreground">This is the base currency — every amount is expressed relative to it (1:1 with itself).</p>
        ) : !d.base ? (
          <p className="text-sm text-muted-foreground">No base currency is set yet.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <div className="text-xs text-muted-foreground">Latest rate</div>
                <div className="num text-lg font-semibold">
                  {latest ? `1 ${d.base} = ${fmtRate(latest.rate)} ${code}` : "—"}
                </div>
              </div>
              {latest && (
                <div className="text-xs text-muted-foreground">
                  {smartCell(latest.source)} · {latest.as_of_date}
                  {latest.fetched_at ? ` · fetched ${dateTimeFmt(latest.fetched_at)}` : ""}
                </div>
              )}
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={() => onSetRate(d.base as string, code)}>Set rate</Button>
              </div>
            </div>
            {history.length === 0 ? (
              <EmptyState title="No rates yet" hint="Use “Sync now” or set a manual rate." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR><TH>As of</TH><TH className="text-right">Rate</TH><TH>Source</TH><TH>Override</TH><TH>Fetched</TH></TR>
                  </THead>
                  <TBody>
                    {history.map((r, i) => (
                      <TR key={i}>
                        <TD className="text-sm">{r.as_of_date}</TD>
                        <TD className="num text-right text-sm">{fmtRate(r.rate)}</TD>
                        <TD className="text-sm">{smartCell(r.source)}</TD>
                        <TD className="text-sm">{r.is_override ? <Pill tone="warn">manual</Pill> : "—"}</TD>
                        <TD className="text-sm text-muted-foreground">{r.fetched_at ? dateTimeFmt(r.fetched_at) : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Usage across the system */}
      <SectionCard title="Usage across the system" right={<Pill tone={d.usage_total > 0 ? "blue" : "mute"}>{num(d.usage_total)} records</Pill>}>
        {d.usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not referenced by any records yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {d.usage.map((u) => (
              <div key={u.table} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>{u.label}</span>
                <span className="num font-medium">{num(u.count)}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Sync & audit */}
      <SectionCard title="Sync & audit">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Last live sync</div>
            {d.last_sync ? (
              <div className="text-sm">
                <span className="num font-medium">{fmtRate(d.last_sync.rate)}</span> · {smartCell(d.last_sync.source)}
                <div className="text-xs text-muted-foreground">{d.last_sync.fetched_at ? dateTimeFmt(d.last_sync.fetched_at) : d.last_sync.as_of_date}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{c.is_base ? "Base currency — nothing to sync." : "Never synced."}</div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Manual overrides</div>
            {(!d.overrides || d.overrides.length === 0) ? (
              <div className="text-sm text-muted-foreground">No manual overrides.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.overrides.slice(0, 6).map((o, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="num">{fmtRate(o.rate)}</span>
                    <span className="text-xs text-muted-foreground">{o.as_of_date}{o.fetched_at ? ` · ${dateTimeFmt(o.fetched_at)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirm === "base"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("base")}
        busy={busy}
        title={`Make ${code} the base currency?`}
        body={<>New transactions and FX rates will be quoted against <b>{code}</b>. Existing rates and history are kept exactly as they are — nothing is recalculated.</>}
        confirmLabel="Set as base"
      />
      <ConfirmDialog
        open={confirm === "deactivate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("deactivate")}
        busy={busy}
        title={`Deactivate ${code}?`}
        body={<>It will be hidden from new transactions and pickers. Existing records keep it, and you can reactivate it anytime.</>}
        confirmLabel="Deactivate"
      />
      <ConfirmDialog
        open={confirm === "activate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("activate")}
        busy={busy}
        title={`Activate ${code}?`}
        body={<>It will be available again for new transactions and in currency pickers.</>}
        confirmLabel="Activate"
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("delete")}
        busy={busy}
        destructive
        title={`Delete ${code}?`}
        body={<>This removes the currency entirely. If it is used by any record, deletion is blocked — deactivate it instead to keep the history. {allCodes.length <= 1 && "This is the only currency."}</>}
        confirmLabel="Delete"
      />
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${mono ? "num" : ""}`}>{value}</div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function CurrenciesPage() {
  const cur = useList<Currency>("/currencies?all=1&usage=1");
  const rates = useList<Rate>("/currencies/rates");
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Currency | null>(null);
  const [rateForm, setRateForm] = React.useState<{ base?: string; quote?: string } | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const rows = React.useMemo(() => {
    const list = cur.rows || [];
    // Base first, then most-used (usage desc), then code — so "which is used
    // most" reads straight off the top of the list.
    return [...list].sort((a, b) => Number(b.is_base) - Number(a.is_base) || (b.usage_count ?? 0) - (a.usage_count ?? 0) || String(a.code).localeCompare(String(b.code)));
  }, [cur.rows]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) => String(c.code).toLowerCase().includes(needle) || String(c.name).toLowerCase().includes(needle));
  }, [rows, q]);

  const codes = rows.map((c) => String(c.code)).filter(Boolean);
  const activeCodes = rows.filter((c) => c.is_active).map((c) => String(c.code));

  React.useEffect(() => {
    if (!selId && rows.length) setSelId(rows[0].code);
    if (selId && rows.length && !rows.some((r) => r.code === selId)) setSelId(rows[0]?.code ?? null);
  }, [rows, selId]);

  function reloadAll() {
    cur.reload();
    rates.reload();
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await tenant<SyncResult>("/currencies/sync", { method: "POST" });
      // Strict `=== true`: the server's `skipped` is a sentinel boolean, not
      // the per-quote list. Loose truthiness once mis-read a successful run's
      // (unrelated) empty-array field as a skip and permanently rendered
      // "Sync skipped — no API key configured." over green syncs.
      if (r.skipped === true) setSyncMsg({ ok: false, text: r.reason || "Sync skipped — no API key configured." });
      else {
        const n = r.updated?.length ?? 0;
        const missing = r.unsupported?.length ?? 0;
        const tail = missing ? ` (no rate from provider for ${r.unsupported!.join(", ")})` : "";
        setSyncMsg({ ok: true, text: `Synced ${n} ${n === 1 ? "rate" : "rates"} for ${r.base} from ${r.source ?? "exchangerate-api"}${r.fetched_at ? ` at ${dateTimeFmt(r.fetched_at)}` : ""}${tail}.` });
      }
      reloadAll();
    } catch (e) {
      setSyncMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Currencies & FX"
        description="Add currencies from the world library, set your base, sync live rates, and open a 360 on any one. Manual overrides are as-of dated."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>⚙ Settings</Button>
            <Button variant="outline" size="sm" loading={syncing} onClick={syncNow} disabled={activeCodes.length < 2}>Sync now</Button>
            <Button onClick={() => setAddOpen(true)}>Add currency</Button>
          </div>
        }
      />
      <HubTabs />

      {syncMsg && (
        <Callout tone={syncMsg.ok ? "ok" : "bad"} className="mb-3" action={<button type="button" className="text-sm underline" onClick={() => setSyncMsg(null)}>Dismiss</button>}>
          {syncMsg.text}
        </Callout>
      )}

      {cur.error ? (
        <ErrorState message={cur.error} />
      ) : cur.rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No currencies yet" hint="Add your first currency from the world library." />
      ) : (
        <SplitPane storageKey="settings.currencies" label="Currency list width" defaultSize={300} min={240} max={520}>
          <div className="space-y-2">
            <Input placeholder="Search currency…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-[72vh] space-y-1 overflow-auto rounded-lg border p-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">No match.</div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => setSelId(c.code)}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${c.code === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                  >
                    <span aria-hidden className="w-5 text-center">{flagOf(ccyLib.representativeCountry(c.code))}</span>
                    <span className="num w-10 font-medium">{c.code}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.name}</span>
                    {c.is_base && <Pill tone="blue">Base</Pill>}
                    {c.most_used && !c.is_base && <Pill tone="orange">Top</Pill>}
                    {!c.is_active && <Pill tone="mute">Off</Pill>}
                  </button>
                ))
              )}
            </div>
          </div>
          {selId ? (
            <CurrencyDossier
              code={selId}
              allCodes={codes}
              onChanged={reloadAll}
              onEdit={(c) => setEditing(c)}
              onSetRate={(base, quote) => setRateForm({ base, quote })}
            />
          ) : (
            <EmptyState title="No currency selected" hint="Choose a currency from the list." />
          )}
        </SplitPane>
      )}

      <AddCurrencyModal open={addOpen} onClose={() => setAddOpen(false)} existing={codes} onSaved={(code) => { setSelId(code); reloadAll(); }} />
      <EditCurrencyModal row={editing} onClose={() => setEditing(null)} onSaved={reloadAll} />
      <FxSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SetRateForm
        open={!!rateForm}
        onClose={() => setRateForm(null)}
        onSaved={reloadAll}
        codes={codes}
        initialBase={rateForm?.base}
        initialQuote={rateForm?.quote}
      />
    </section>
  );
}
