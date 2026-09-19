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
import { IndexRow } from "@/components/ui/index-row";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { errMsg, useList, useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { currencies as ccyLib } from "@shared";
import { flagOf } from "@/components/smart-country-picker";
import { SmartCurrencyPicker } from "@/components/smart-currency-picker";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DateField } from "@/components/ui/date-field";
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
  set_by_user_id?: string | null;
  set_by_name?: string | null;
};
type UsageRow = { table: string; label: string; count: number };
type Dossier = {
  currency: Currency;
  base: string | null;
  is_base: boolean;
  catalogue: {
    code: string;
    name: string;
    symbol: string;
    decimals: number;
    numeric: string;
  } | null;
  countries: { code: string; name: string }[];
  rate_history: Rate[];
  rate_history_total?: number;
  rate_history_page_size?: number;
  rate_history_has_more?: boolean;
  latest_rate: Rate | null;
  last_sync: Rate | null;
  overrides: Rate[];
  usage: UsageRow[];
  usage_total: number;
};
type SyncResult = {
  skipped?: boolean;
  reason?: string;
  base?: string;
  updated?: { quote: string; rate: number }[];
  unsupported?: string[];
  fetched_at?: string;
  source?: string;
};
type SyncRun = {
  base_code: string | null;
  trigger: "manual" | "cron";
  status: "ok" | "skipped" | "partial" | "error";
  updated_count: number;
  unsupported: string[];
  reason: string | null;
  started_at: string;
  finished_at: string | null;
};
type SyncStatus = {
  key_configured: boolean;
  scheduler_enabled: boolean;
  base: string | null;
  last_run: SyncRun | null;
};
type RateHistoryPage = {
  data: Rate[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

/* ── Small helpers ────────────────────────────────────────────────────────── */

const SAMPLE = 1234567.89;
const fmtSample = (decimals: number) =>
  SAMPLE.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
const rateNum = (r: Rate | null | undefined) =>
  r == null ? null : Number(r.rate);

/** FX rates span many magnitudes (655.957, 0.00163) — keep the significant
 *  digits `num()`'s 3-decimal default would round away, without trailing zeros. */
function fmtRate(v: number | string) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      })
    : "—";
}

/** A partial/array payload (e.g. an unmocked test route) is not a dossier. */
function asDossier(data: unknown): Dossier | null {
  if (!data || Array.isArray(data) || typeof data !== "object") return null;
  return "currency" in (data as Record<string, unknown>)
    ? (data as Dossier)
    : null;
}

/**
 * Interactive trend chart — no chart lib (audit #4). Each point carries its
 * date and exact rate, so a viewer can hover OR keyboard-focus any point to see
 * "date · exact rate" in a tooltip, instead of a decorative line with no dates.
 * Points are oldest→newest left-to-right. Green when the latest ≥ the oldest.
 * `onPick(index)` drills through to the matching history row.
 *
 * Hover stability (production feedback): pointer events are owned by the SVG
 * SURFACE, not by the dots — the pointer position is mapped to the NEAREST
 * point. Per-dot hit areas (a 4px circle) were near-impossible to land on and
 * flickered between neighbours; growing the hovered dot also changed the hit
 * geometry under the cursor, which read as the chart "moving". The dots stay a
 * constant size and the active point gets a pointer-transparent halo instead.
 */
type SparkPoint = { date: string; value: number; source?: string; override?: boolean };
function Sparkline({
  points,
  quote,
  base,
  onPick,
}: {
  points: SparkPoint[];
  quote: string;
  base: string;
  onPick?: (index: number) => void;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  if (points.length < 2) return null;
  const w = 220;
  const h = 44;
  const pad = 5;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xy = (i: number, v: number) => ({
    x: pad + (i / (points.length - 1)) * (w - 2 * pad),
    y: h - pad - ((v - min) / span) * (h - 2 * pad),
  });
  const line = points.map((p, i) => {
    const { x, y } = xy(i, p.value);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = values[values.length - 1] >= values[0];
  const cur = active != null ? points[active] : null;
  const first = points[0];
  const last = points[points.length - 1];

  /** Map a pointer event on the SVG to the nearest point index (viewBox units). */
  const nearest = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const t = (x - pad) / (w - 2 * pad);
    const i = Math.round(t * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };

  return (
    <div className="shrink-0">
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Rate trend for ${base}→${quote}, ${points.length} points from ${first.date} to ${last.date}`}
        className="overflow-visible"
        onMouseMove={(e) => setActive(nearest(e))}
        onMouseLeave={() => setActive(null)}
        onClick={(e) => {
          // Surface clicks pick the nearest point; clicks that landed on a dot
          // are handled by the dot itself (and would bubble here too).
          if (e.target !== e.currentTarget) return;
          const i = nearest(e);
          if (i != null) onPick?.(i);
        }}
      >
        <polyline
          points={line.join(" ")}
          fill="none"
          stroke={up ? "rgb(var(--ok))" : "rgb(var(--bad))"}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ pointerEvents: "none" }}
        />
        {active != null && (
          <circle
            cx={xy(active, points[active].value).x}
            cy={xy(active, points[active].value).y}
            r={4.5}
            fill="none"
            stroke="rgb(var(--primary))"
            strokeWidth={1.5}
            style={{ pointerEvents: "none" }}
          />
        )}
        {points.map((p, i) => {
          const { x, y } = xy(i, p.value);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={2}
              tabIndex={0}
              role="button"
              aria-label={`${p.date}: 1 ${base} = ${fmtRate(p.value)} ${quote}${p.override ? " (manual override)" : ""}`}
              className="cursor-pointer fill-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              onClick={() => onPick?.(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick?.(i);
                }
              }}
            />
          );
        })}
      </svg>
      {/* Endpoint date labels so the axis is readable without hovering. */}
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{first.date}</span>
        <span>{last.date}</span>
      </div>
      {/* Live tooltip: exact date + rate for the focused/hovered point.
          Single line, clipped — a wrapping tooltip used to reflow the panel. */}
      <div
        aria-live="polite"
        className="mt-0.5 h-4 overflow-hidden text-[11px] text-muted-foreground"
      >
        {cur ? (
          <span className="num whitespace-nowrap">
            {cur.date}: 1 {base} = {fmtRate(cur.value)} {quote}
            {cur.override ? " · manual" : cur.source ? ` · ${cur.source}` : ""}
          </span>
        ) : (
          <span className="whitespace-nowrap">
            Hover or focus a point for its date and exact rate.
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Country list (audit #1 — every "more" is reachable) ──────────────────── */

const COUNTRY_PREVIEW = 14;

/**
 * The countries that trade in a currency. Shows a preview row of chips, then an
 * accessible "Show all / N more" TOGGLE (not a dead-end label) that expands the
 * full, searchable set. Keyboard reachable, announces the hidden count, and
 * never truncates the backend array — the whole point of audit #1.
 */
function CountryChips({
  countries,
}: {
  countries: { code: string; name: string }[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [q, setQ] = React.useState("");
  const total = countries.length;
  const hidden = Math.max(0, total - COUNTRY_PREVIEW);

  const shown = React.useMemo(() => {
    if (!expanded) return countries.slice(0, COUNTRY_PREVIEW);
    const needle = q.trim().toLowerCase();
    if (!needle) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.code.toLowerCase().includes(needle),
    );
  }, [countries, expanded, q]);

  const Chip = (co: { code: string; name: string }) => (
    <span
      key={co.code}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
    >
      <span aria-hidden>{flagOf(co.code)}</span>
      {co.name}
    </span>
  );

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Used in {total} {total === 1 ? "country" : "countries"}
        </div>
        {hidden > 0 && (
          <button
            type="button"
            className="text-xs font-medium text-primary-ink underline"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((v) => !v);
              setQ("");
            }}
          >
            {expanded ? "Show fewer" : `Show all ${total}`}
          </button>
        )}
      </div>
      {expanded && hidden > 0 && (
        <Input
          className="mb-2"
          placeholder="Search countries…"
          aria-label="Search countries"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div
        className={
          expanded
            ? "flex max-h-56 flex-wrap gap-1.5 overflow-auto rounded-lg border p-2"
            : "flex flex-wrap gap-1.5"
        }
      >
        {shown.length === 0 ? (
          <span className="px-1 py-0.5 text-xs text-muted-foreground">
            No country matches “{q}”.
          </span>
        ) : (
          shown.map(Chip)
        )}
        {!expanded && hidden > 0 && (
          <button
            type="button"
            className="rounded-full border px-2 py-0.5 text-xs text-primary-ink underline"
            aria-expanded={false}
            onClick={() => setExpanded(true)}
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
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

function AddCurrencyModal({
  open,
  onClose,
  onSaved,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (code: string) => void;
  existing: string[];
}) {
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
      await tenant("/currencies", {
        method: "POST",
        body: {
          code,
          name,
          symbol: symbol || null,
          decimals: Number(decimals),
        },
      });
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Add currency
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={tr("Currency")}
          hint="Type a currency code/name, or a country to look it up."
          required
        >
          <SmartCurrencyPicker
            value={code}
            onChange={pick}
            exclude={existing}
          />
        </Field>
        {code && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Name")} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={tr("Symbol")}>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. €"
              />
            </Field>
            <Field
              label={tr("Decimals")}
              hint="Minor units (0 for XAF/JPY, 2 for most, 3 for Gulf dinars)."
            >
              <Input
                type="number"
                min="0"
                max="6"
                className="num"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
              />
            </Field>
            <Field label={tr("Preview")}>
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

function EditCurrencyModal({
  row,
  onClose,
  onSaved,
}: {
  row: Currency | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      await tenant(`/currencies/${row.code}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          symbol: symbol || null,
          decimals: Number(decimals),
        },
      });
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!name.trim() || busy}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Name")} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tr("Symbol")}>
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
        <Field label={tr("Decimals")}>
          <Input
            type="number"
            min="0"
            max="6"
            className="num"
            value={decimals}
            onChange={(e) => setDecimals(Number(e.target.value))}
          />
        </Field>
        <Field label={tr("Preview")}>
          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 num text-sm">
            {symbol ? `${symbol} ` : ""}
            {fmtSample(Number(decimals) || 0)}
          </div>
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <ErrorState message={error} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Set FX rate (manual override, as-of dated) ───────────────────────────── */

function SetRateForm({
  open,
  onClose,
  onSaved,
  codes,
  initialBase,
  initialQuote,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  codes: string[];
  initialBase?: string;
  initialQuote?: string;
}) {
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

  const canSubmit =
    !!base && !!quote && base !== quote && Number(rate) > 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/currencies/rates", {
        method: "POST",
        body: { base, quote, rate: Number(rate), as_of_date: asOf },
      });
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Save rate
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Base")} required>
          <Select value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">{tr("Select…")}</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Quote"
          required
          error={
            base && quote && base === quote
              ? "Base and quote must differ"
              : undefined
          }
        >
          <Select value={quote} onChange={(e) => setQuote(e.target.value)}>
            <option value="">{tr("Select…")}</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Rate")} hint="1 base = ? quote" required>
          <Input
            type="number"
            min="0"
            step="0.000001"
            className="num text-right"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="655.957"
          />
        </Field>
        <Field label={tr("As of")} required>
          <DateField
            value={asOf}
            onChange={setAsOf}
          />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <ErrorState message={error} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Automatic FX sync key — now behind a ⚙ Settings modal ─────────────────── */

function FxSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { rows, reload } = useList("/settings/integration_secret");
  const fx = (rows || []).find((r) => String(r.key) === "fx_exchangerate");
  const last4 = (fx?.value as { last4?: string } | undefined)?.last4;
  const isSet = !!last4;
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(
    null,
  );

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
        body: {
          value: {
            provider: "exchangerate-api",
            key_name: "EXCHANGERATE_API_KEY",
            secret,
          },
        },
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
      const r = await tenant<{ ok?: boolean; error?: string }>(
        "/settings/integration_secret/fx_exchangerate/test",
        { method: "POST" },
      );
      setMsg({
        ok: r.ok === true,
        text: r.ok ? "Connected." : r.error || "Test failed.",
      });
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
      headerRight={
        <Pill tone={isSet ? "ok" : "mute"}>
          {isSet ? `key set · …${last4}` : "no key"}
        </Pill>
      }
      footer={
        <>
          <Button
            variant="outline"
            loading={testing}
            onClick={test}
            disabled={!isSet && !secret}
          >
            Test
          </Button>
          <Button loading={busy} onClick={save} disabled={!secret}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={tr("API key")}
          hint={
            isSet
              ? "Leave blank to keep the current key."
              : "Paste your exchangerate-api.com key."
          }
        >
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={isSet ? "•••••• (unchanged)" : "paste key…"}
          />
        </Field>
        {msg && (
          <div className={`text-sm ${msg.ok ? "text-ok" : "text-destructive"}`}>
            {msg.text}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Rates sync every night; use “Sync now” on the page to pull
          immediately. The base currency is quoted against every active
          currency.
        </p>
      </div>
    </Modal>
  );
}

/* ── Currency 360 dossier ─────────────────────────────────────────────────── */

function CurrencyDossier({
  code,
  onChanged,
  onEdit,
  onSetRate,
  allCodes,
}: {
  code: string;
  onChanged: () => void;
  onEdit: (c: Currency) => void;
  onSetRate: (base: string, quote: string) => void;
  allCodes: string[];
}) {
  const res = useResource<Dossier | null>(
    () => tenant<Dossier>(`/currencies/${code}/360`),
    [code],
  );
  const d = asDossier(res.data);
  const [confirm, setConfirm] = React.useState<
    null | "base" | "deactivate" | "activate" | "delete"
  >(null);
  const [busy, setBusy] = React.useState(false);
  const [actionErr, setActionErr] = React.useState<string | null>(null);
  const [actionNote, setActionNote] = React.useState<string | null>(null);
  // Rate-history "load more" appends pages fetched under the Gate-0 contract on
  // top of the first page the dossier already embedded. Reset when the currency
  // changes, or a stale page from the previous currency would show.
  const [moreHistory, setMoreHistory] = React.useState<Rate[]>([]);
  const [loadingMore, setLoadingMore] = React.useState(false);
  // Chart drill-down: which history row to flash/scroll to when a point is picked.
  const [highlightIdx, setHighlightIdx] = React.useState<number | null>(null);
  const historyRef = React.useRef<HTMLTableSectionElement>(null);
  React.useEffect(() => {
    setMoreHistory([]);
    setHighlightIdx(null);
  }, [code]);

  const reloadAll = () => {
    res.reload();
    setMoreHistory([]);
    onChanged();
  };

  async function run(kind: "base" | "deactivate" | "activate" | "delete") {
    setBusy(true);
    setActionErr(null);
    setActionNote(null);
    try {
      if (kind === "base") {
        const r = await tenant<{
          base?: string;
          previous_base?: string | null;
          rebased?: { quote: string; rate: number }[];
        }>("/currencies/base", { method: "POST", body: { code } });
        const n = r.rebased?.length ?? 0;
        if (n > 0)
          setActionNote(
            `${code} is now the base. ${n} ${n === 1 ? "rate was" : "rates were"} rebased from ${r.previous_base ?? "the old base"} — dated history is unchanged.`,
          );
      } else if (kind === "delete")
        await tenant(`/currencies/${code}`, { method: "DELETE" });
      else
        await tenant(`/currencies/${code}`, {
          method: "PATCH",
          body: { is_active: kind === "activate" },
        });
      setConfirm(null);
      reloadAll();
    } catch (e) {
      setActionErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreHistory(base: string) {
    setLoadingMore(true);
    try {
      const offset =
        (d?.rate_history?.length ?? 0) + moreHistory.length;
      const page = await tenant<RateHistoryPage>(
        `/currencies/rate-history?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(code)}&offset=${offset}`,
      );
      setMoreHistory((prev) => [...prev, ...(page.data || [])]);
    } catch (e) {
      setActionErr(errMsg(e));
    } finally {
      setLoadingMore(false);
    }
  }

  if (res.error) return <ErrorState message={res.error} />;
  if (!d)
    return (
      <div className="rounded-2xl border bg-card p-8">
        <LoadingRow label="Loading currency…" />
      </div>
    );

  const c = d.currency;
  const cat = d.catalogue;
  const decimals = c.decimals ?? cat?.decimals ?? 2;
  const symbol = c.symbol || cat?.symbol || "";
  const flag = flagOf(ccyLib.representativeCountry(code));
  const history = [...(d.rate_history || []), ...moreHistory];
  const historyTotal = d.rate_history_total ?? history.length;
  const hasMoreHistory = history.length < historyTotal;
  // Chart points oldest→newest, carrying date/source for tooltips + drill-down.
  // `histIndex` maps a chart point back to its row in the (newest-first) table.
  const points: (SparkPoint & { histIndex: number })[] = [];
  history.forEach((r, i) => {
    const value = rateNum(r);
    if (value == null) return;
    points.push({
      date: r.as_of_date,
      value,
      source: r.source,
      override: r.is_override === true,
      histIndex: i,
    });
  });
  points.reverse();
  const latest = d.latest_rate;

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-2xl">
              {flag}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="num text-lg font-semibold">{c.code}</span>
                {c.is_base && <Pill tone="blue">{tr("Base")}</Pill>}
                <Pill tone={c.is_active ? "ok" : "mute"}>
                  {c.is_active ? "Active" : "Off"}
                </Pill>
                {c.most_used && <Pill tone="orange">Most used</Pill>}
              </div>
              <p className="text-sm text-muted-foreground">{c.name}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!c.is_base && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirm("base")}
              >
                Set as base
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onEdit(c)}>
              Edit
            </Button>
            {!c.is_base &&
              (c.is_active ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirm("deactivate")}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirm("activate")}
                >
                  Activate
                </Button>
              ))}
            {!c.is_base && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm("delete")}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        {actionErr && (
          <div className="mt-3">
            <ErrorState message={actionErr} />
          </div>
        )}
        {actionNote && (
          <Callout
            tone="ok"
            className="mt-3"
            action={
              <button
                type="button"
                className="text-sm underline"
                onClick={() => setActionNote(null)}
              >
                Dismiss
              </button>
            }
          >
            {actionNote}
          </Callout>
        )}
      </div>

      {/* Overview & format */}
      <SectionCard title="Overview & format">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={tr("Symbol")} value={symbol || "—"} />
          <Stat label={tr("Decimals")} value={String(decimals)} />
          <Stat label="ISO numeric" value={cat?.numeric ?? "—"} />
          <Stat
            label="Amount preview"
            value={`${symbol ? symbol + " " : ""}${fmtSample(decimals)}`}
            mono
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stat
            label={tr("Added")}
            value={c.created_at ? dateFmt(c.created_at) : "—"}
          />
          <Stat
            label="Last changed"
            value={c.updated_at ? dateTimeFmt(c.updated_at) : "—"}
          />
        </div>
        {d.countries.length > 0 && <CountryChips countries={d.countries} />}
      </SectionCard>

      {/* Rate history & trend */}
      <SectionCard
        title={`Rate history vs ${d.base ?? "base"}`}
        right={
          points.length >= 2 && d.base ? (
            <Sparkline
              points={points}
              base={d.base}
              quote={code}
              onPick={(i) => {
                const idx = points[i]?.histIndex ?? null;
                setHighlightIdx(idx);
                historyRef.current
                  ?.querySelector(`[data-hist-row="${idx}"]`)
                  ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
            />
          ) : undefined
        }
      >
        {c.is_base ? (
          <p className="text-sm text-muted-foreground">
            This is the base currency — every amount is expressed relative to it
            (1:1 with itself).
          </p>
        ) : !d.base ? (
          <p className="text-sm text-muted-foreground">
            No base currency is set yet.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <div className="text-xs text-muted-foreground">Latest rate</div>
                <div className="num text-lg font-semibold">
                  {latest
                    ? `1 ${d.base} = ${fmtRate(latest.rate)} ${code}`
                    : "—"}
                </div>
              </div>
              {latest && (
                <div className="text-xs text-muted-foreground">
                  {smartCell(latest.source)} · {latest.as_of_date}
                  {latest.fetched_at
                    ? ` · fetched ${dateTimeFmt(latest.fetched_at)}`
                    : ""}
                </div>
              )}
              <div className="ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSetRate(d.base as string, code)}
                >
                  Set rate
                </Button>
              </div>
            </div>
            {history.length === 0 ? (
              <EmptyState
                title="No rates yet"
                hint="Use “Sync now” or set a manual rate."
              />
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>{tr("As of")}</TH>
                        <TH className="text-right">{tr("Rate")}</TH>
                        <TH>{tr("Source")}</TH>
                        <TH>Override</TH>
                        <TH>Set by</TH>
                        <TH>Fetched</TH>
                      </TR>
                    </THead>
                    <TBody ref={historyRef}>
                      {history.map((r, i) => (
                        <TR
                          key={i}
                          data-hist-row={i}
                          className={
                            highlightIdx === i
                              ? "bg-primary/10 transition-colors"
                              : undefined
                          }
                        >
                          <TD className="text-sm">{r.as_of_date}</TD>
                          <TD className="num text-right text-sm">
                            {fmtRate(r.rate)}
                          </TD>
                          <TD className="text-sm">{smartCell(r.source)}</TD>
                          <TD className="text-sm">
                            {r.is_override ? (
                              <Pill tone="warn">manual</Pill>
                            ) : (
                              "—"
                            )}
                          </TD>
                          <TD className="text-sm text-muted-foreground">
                            {r.is_override
                              ? r.set_by_name || "Unknown"
                              : "—"}
                          </TD>
                          <TD className="text-sm text-muted-foreground">
                            {r.fetched_at ? dateTimeFmt(r.fetched_at) : "—"}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {history.length} of {historyTotal}
                  </span>
                  {hasMoreHistory && d.base && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={loadingMore}
                      onClick={() => loadMoreHistory(d.base as string)}
                    >
                      Load more
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Usage across the system */}
      <SectionCard
        title="Usage across the system"
        right={
          <Pill tone={d.usage_total > 0 ? "blue" : "mute"}>
            {num(d.usage_total)} records
          </Pill>
        }
      >
        {d.usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not referenced by any records yet.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {d.usage.map((u) => (
              <div
                key={u.table}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
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
                <span className="num font-medium">
                  {fmtRate(d.last_sync.rate)}
                </span>{" "}
                · {smartCell(d.last_sync.source)}
                <div className="text-xs text-muted-foreground">
                  {d.last_sync.fetched_at
                    ? dateTimeFmt(d.last_sync.fetched_at)
                    : d.last_sync.as_of_date}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {c.is_base
                  ? "Base currency — nothing to sync."
                  : "Never synced."}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Manual overrides
            </div>
            {!d.overrides || d.overrides.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No manual overrides.
              </div>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.overrides.slice(0, 6).map((o, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="num">{fmtRate(o.rate)}</span>
                    <span className="text-xs text-muted-foreground">
                      {o.as_of_date}
                      {o.set_by_name ? ` · ${o.set_by_name}` : ""}
                      {o.fetched_at ? ` · ${dateTimeFmt(o.fetched_at)}` : ""}
                    </span>
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
        body={
          <>
            New transactions and FX rates will be quoted against <b>{code}</b>.
            The current working rates are <b>rebased</b> onto {code} in one step
            (each pair is converted through the existing{" "}
            {d.base ?? "base"}→{code} rate), so quotes stay correct immediately.
            Dated rate history is preserved as-is and posted transactions keep
            the rate they were stamped with — nothing historical is
            reinterpreted. This needs a current {d.base ?? "base"}→{code} rate;
            if none exists, sync or set it first.
          </>
        }
        confirmLabel="Set as base"
      />
      <ConfirmDialog
        open={confirm === "deactivate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("deactivate")}
        busy={busy}
        title={`Deactivate ${code}?`}
        body={
          <>
            It will be hidden from new transactions and pickers. Existing
            records keep it, and you can reactivate it anytime.
          </>
        }
        confirmLabel="Deactivate"
      />
      <ConfirmDialog
        open={confirm === "activate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("activate")}
        busy={busy}
        title={`Activate ${code}?`}
        body={
          <>
            It will be available again for new transactions and in currency
            pickers.
          </>
        }
        confirmLabel="Activate"
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run("delete")}
        busy={busy}
        destructive
        title={`Delete ${code}?`}
        body={
          <>
            This removes the currency entirely. If it is used by any record,
            deletion is blocked — deactivate it instead to keep the history.{" "}
            {allCodes.length <= 1 && "This is the only currency."}
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${mono ? "num" : ""}`}>{value}</div>
    </div>
  );
}

/* ── Sync freshness banner (audit #6) ─────────────────────────────────────── */

/** Rates older than this (no successful run since) read as "stale". */
const STALE_HOURS = 36;

function SyncStatusBanner({ status }: { status: SyncStatus | null }) {
  if (!status) return null;
  const run = status.last_run;
  const lastAt = run?.finished_at || run?.started_at || null;
  const ageMs = lastAt ? Date.now() - new Date(lastAt).getTime() : null;
  const stale = ageMs != null && ageMs > STALE_HOURS * 3600_000;

  // No key configured — the sync cannot run at all. Most actionable state first.
  if (!status.key_configured) {
    return (
      <Callout tone="warn" className="mb-3">
        Automatic FX sync is off — no provider key is configured. Add one under ⚙
        Settings, or keep setting rates manually.
      </Callout>
    );
  }

  const okRun = run && (run.status === "ok" || run.status === "partial");
  const tone = run && run.status === "error" ? "bad" : stale || !status.scheduler_enabled ? "warn" : "ok";
  const bits: string[] = [];
  if (!status.scheduler_enabled)
    bits.push("Nightly sync is disabled (FX_SYNC_CRON empty) — use “Sync now”.");
  if (run) {
    if (run.status === "error")
      bits.push(`Last sync failed${lastAt ? ` ${dateTimeFmt(lastAt)}` : ""}${run.reason ? `: ${run.reason}` : "."}`);
    else if (run.status === "skipped")
      bits.push(`Last run was skipped${run.reason ? `: ${run.reason}` : "."}`);
    else if (okRun)
      bits.push(
        `Last synced ${lastAt ? dateTimeFmt(lastAt) : "recently"} (${run.updated_count} ${run.updated_count === 1 ? "rate" : "rates"}${run.trigger === "cron" ? ", nightly" : ""})${run.unsupported?.length ? ` · no rate for ${run.unsupported.join(", ")}` : ""}.`,
      );
    if (stale && okRun) bits.push("Rates may be stale.");
  } else {
    bits.push("No sync has run yet — use “Sync now” to pull live rates.");
  }
  if (bits.length === 0) return null;
  return (
    <Callout tone={tone} className="mb-3">
      {bits.join(" ")}
    </Callout>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function CurrenciesPage() {
  const cur = useList<Currency>("/currencies?all=1&usage=1");
  // Sync-status drives the freshness banner (audit #6). The old unused
  // `/currencies/rates` prefetch (audit #10) was removed — the page never
  // rendered it; the dossier owns rate history.
  const status = useResource<SyncStatus | null>(
    () => tenant<{ data: SyncStatus }>("/currencies/sync-status").then((r) => r.data),
    [],
  );
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Currency | null>(null);
  const [rateForm, setRateForm] = React.useState<{
    base?: string;
    quote?: string;
  } | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const rows = React.useMemo(() => {
    const list = cur.rows || [];
    // Base first, then most-used (usage desc), then code — so "which is used
    // most" reads straight off the top of the list.
    return [...list].sort(
      (a, b) =>
        Number(b.is_base) - Number(a.is_base) ||
        (b.usage_count ?? 0) - (a.usage_count ?? 0) ||
        String(a.code).localeCompare(String(b.code)),
    );
  }, [cur.rows]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (c) =>
        String(c.code).toLowerCase().includes(needle) ||
        String(c.name).toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const codes = rows.map((c) => String(c.code)).filter(Boolean);
  const activeCodes = rows
    .filter((c) => c.is_active)
    .map((c) => String(c.code));

  React.useEffect(() => {
    if (!selId && rows.length) setSelId(rows[0].code);
    if (selId && rows.length && !rows.some((r) => r.code === selId))
      setSelId(rows[0]?.code ?? null);
  }, [rows, selId]);

  function reloadAll() {
    cur.reload();
    status.reload();
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await tenant<SyncResult>("/currencies/sync", {
        method: "POST",
      });
      // Strict `=== true`: the server's `skipped` is a sentinel boolean, not
      // the per-quote list. Loose truthiness once mis-read a successful run's
      // (unrelated) empty-array field as a skip and permanently rendered
      // "Sync skipped — no API key configured." over green syncs.
      if (r.skipped === true)
        setSyncMsg({
          ok: false,
          text: r.reason || "Sync skipped — no API key configured.",
        });
      else {
        const n = r.updated?.length ?? 0;
        const missing = r.unsupported?.length ?? 0;
        const tail = missing
          ? ` (no rate from provider for ${r.unsupported!.join(", ")})`
          : "";
        setSyncMsg({
          ok: true,
          text: `Synced ${n} ${n === 1 ? "rate" : "rates"} for ${r.base} from ${r.source ?? "exchangerate-api"}${r.fetched_at ? ` at ${dateTimeFmt(r.fetched_at)}` : ""}${tail}.`,
        });
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙ Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={syncing}
              onClick={syncNow}
              disabled={activeCodes.length < 2}
            >
              Sync now
            </Button>
            <Button onClick={() => setAddOpen(true)}>Add currency</Button>
          </div>
        }
      />
      <HubTabs />

      <SyncStatusBanner status={status.data ?? null} />

      {syncMsg && (
        <Callout
          tone={syncMsg.ok ? "ok" : "bad"}
          className="mb-3"
          action={
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setSyncMsg(null)}
            >
              Dismiss
            </button>
          }
        >
          {syncMsg.text}
        </Callout>
      )}

      {cur.error ? (
        <ErrorState message={cur.error} />
      ) : cur.rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No currencies yet"
          hint="Add your first currency from the world library."
        />
      ) : (
        <SplitPane
          storageKey="settings.currencies"
          label="Currency list width"
          defaultSize={300}
          min={240}
          max={520}
          activeKind={tr("Currency")}
          active={!!selId}
        >
          <div className="space-y-2">
            <Input
              placeholder="Search currency…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[72vh] space-y-1 overflow-auto rounded-lg border p-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  No match.
                </div>
              ) : (
                filtered.map((c) => (
                  <IndexRow
                    key={c.code}
                    selected={c.code === selId}
                    onClick={() => setSelId(c.code)}
                    className="items-center gap-2"
                  >
                    <span aria-hidden className="w-5 text-center">
                      {flagOf(ccyLib.representativeCountry(c.code))}
                    </span>
                    <span className="num w-10 font-medium">{c.code}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {c.name}
                    </span>
                    {c.is_base && <Pill tone="blue">{tr("Base")}</Pill>}
                    {c.most_used && !c.is_base && (
                      <Pill tone="orange">Top</Pill>
                    )}
                    {!c.is_active && <Pill tone="mute">{tr("Off")}</Pill>}
                  </IndexRow>
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
            <EmptyState
              title="No currency selected"
              hint="Choose a currency from the list."
            />
          )}
        </SplitPane>
      )}

      <AddCurrencyModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existing={codes}
        onSaved={(code) => {
          setSelId(code);
          reloadAll();
        }}
      />
      <EditCurrencyModal
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={reloadAll}
      />
      <FxSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
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
