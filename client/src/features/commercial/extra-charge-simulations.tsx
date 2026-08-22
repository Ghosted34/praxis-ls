/**
 * Commercial — extra-charge simulator (MOD-28), the five-family model.
 *
 * WHAT CHANGED AND WHY. This screen used to drive the generic tiered engine:
 * one container variant, a free-days/occupied-days pair, and a hand-edited
 * `tiers[]` list, rendering a per-day breakdown. That engine bills one box and
 * only demurrage. The business runs the legacy `extra-charges-simulator.php`,
 * which takes a CONTAINER LIST and three dates and returns five charge families
 * — demurrage, storage, yard occupancy, plugging, detention — with HT/VAT/TTC.
 * The API had both engines behind one endpoint and the UI reached the wrong one,
 * so the screen could not produce the number the carrier actually invoices.
 *
 * LAYOUT. A workbench, not a form-then-nothing. Below `xl` it is one column:
 * inputs, metrics, then the charge table. At `xl` it splits into a fixed 400px
 * input rail and a results column that owns the rest of the width, and the rail
 * is `sticky` so the operator can scroll a 60-row charge table while the dates
 * that produced it stay on screen. The results table is `sticky` with a bounded
 * height so its headings and its totals footer both stay put — on a 1440px
 * display that is roughly 30 charge lines visible at once against the 8 a modal
 * managed. Every band is a real `lg`/`xl`/`2xl` decision, never `sm:`-and-stop.
 *
 * THE WORKBENCH IS A DIALOG AGAIN (owner's call, 22 Aug 2026) — and the
 * objection that moved it out is answered rather than overruled. It was made
 * a page because a dialog "capped the result at the dialog's height and hid the
 * saved list behind it". The height half stands, so the dialog is `size="wide"`
 * (the rail keeps a real results column beside it), the charge table keeps its
 * own internal scroll, and the dialog scrolls its body — nothing is truncated.
 *
 * The other half was wrong about what an operator arrives to do. It is not
 * simulating; it is checking what has already been estimated against which
 * file. So the SAVED LIST is the page and the workbench opens on demand, which
 * also gives the screen an honest empty state and a single obvious first action.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { tr } from "@/lib/i18n";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useRibbonCommands } from "@/app/layout/ribbon-commands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { DateField } from "@/components/ui/date-field";
import { Select } from "@/components/ui/select";
import { Chips } from "@/components/ui/chips";
import { Pill } from "@/components/ui/pill";
import { Panel } from "@/components/ui/panel";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import {
  errMsg,
  useList,
  useRefresh,
  useResource,
  type Row,
} from "@/lib/use-resource";
import { useDebounced } from "@/lib/use-debounced";
import { cell, dateFmt, money, money0 } from "@/lib/format";
import { cn } from "@/lib/cn";
import { listCurrencies } from "@/lib/masterdata-api";
import { Modal } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";

const EXTRA_AI: AiAction[] = [
  {
    label: "Explain the charge",
    kind: "assist",
    describe:
      "Explain an extra-charge estimate — which containers drive which family, and which days fall in which band.",
  },
  {
    label: "Draft the dispute letter",
    kind: "assist",
    describe:
      "Draft a letter contesting a carrier's demurrage invoice against this simulation's day count.",
  },
];

/** The five families the legacy computed, in the order it listed them. */
const FAMILIES = [
  "Demurrage",
  "Storage",
  "Yard Occupancy",
  "Plugging",
  "Detention",
] as const;

type ChargeRow = {
  cat: string;
  desc: string;
  qty: number;
  unit: number;
  total: number;
};

/**
 * Narrow a `Row`'s `unknown` value to what `money0` accepts. `money0` is typed
 * `number | string | null | undefined` and a list row is
 * `Record<string, unknown>`, so the two do not meet without this — and casting
 * at each call site would hide the day a column really does arrive as an
 * object. Anything unexpected becomes `null`, which renders as an em dash.
 */
function amount(v: unknown): number | string | null {
  if (typeof v === "number" || typeof v === "string") return v;
  return null;
}

type Computed = {
  currency: string;
  rows: ChargeRow[];
  families: Record<string, number>;
  total_ht: number;
  vat: number;
  total_ttc: number;
  vat_rate: number;
  containers: { q: number; s: number; t: string }[];
  free_days: number;
  port_stay_days: number;
  yard_trigger: number;
  due_date: string | null;
  status: "OK" | "EXCEEDED" | "WAITING";
  container_count: number;
  teu: number;
};

/**
 * A saved simulation as the server returns it (§2.6). `GET /:id` rebuilds
 * `computed` from the frozen jsonb, so a re-opened simulation answers exactly
 * as it did when it was computed.
 *
 * `rendered_from_snapshot` false means the row predates the tariff freeze
 * (10716): its totals stand, but the breakdown cannot be reconstructed, and the
 * screen says so rather than rendering an empty table as though there were no
 * charges.
 */
type SavedSim = Row & {
  computed?: Computed & {
    breakdown?: unknown[];
    model?: "five_family" | "tiered";
    rendered_from_snapshot?: boolean;
    rates_used?: Record<string, unknown> | null;
  };
};

/* ── Metrics band ─────────────────────────────────────────────────────────── */

/**
 * A metric tile. Deliberately not `<Stat>`: Stat is a 3-line block sized for a
 * dashboard, and six of them would eat the vertical budget this screen is
 * trying to spend on charge lines. This is one line of label over one line of
 * figure, ~52px, and it wraps from 2-up on a phone to 6-up at `2xl`.
 */
function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "ok" | "warn" | "bad" | "accent";
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-micro uppercase text-muted-foreground">{label}</div>
      <div
        className={cn(
          "num truncate text-base font-semibold leading-tight",
          tone === "ok" && "text-[rgb(var(--ok))]",
          tone === "warn" && "text-[rgb(var(--warn))]",
          tone === "bad" && "text-[rgb(var(--bad))]",
          tone === "accent" && "text-primary-ink",
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="truncate text-micro text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

/* ── Rate configuration (§3.2) ────────────────────────────────────────────── */

/**
 * The Rate Configuration modal, ON the simulator — the owner's strongest
 * objection was rates living in Settings ("how will user go to settings to
 * set rate then come back to simulation screen to compute"). The legacy
 * proves the placement (extra-charges-simulator.php:481 opens #adminModal
 * from the toolbar and recalculates live) but its save was
 * alert("Saved locally!") — a mutation of a JS object that a reload undid.
 * This one PUTs to /extra-charge-simulations/rates (persisted in tenant
 * settings) and the workbench recomputes immediately. Saving is gated
 * server-side (MOD-70 edit): a pricer sees the tariff, an admin changes it —
 * the 403 message says so rather than hiding the button client-side.
 *
 * The editor walks the tariff object generically: a number is one input, an
 * array of numbers is a comma-separated band list. No family list is
 * hardcoded — a tenant whose tariff grows a key grows a row.
 */
type FlatRate = { path: string[]; value: string; isArray: boolean };

function flattenRates(obj: unknown, path: string[] = []): FlatRate[] {
  const out: FlatRate[] = [];
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "number") {
    out.push({ path, value: String(obj), isArray: false });
    return out;
  }
  if (Array.isArray(obj)) {
    out.push({ path, value: obj.join(", "), isArray: true });
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === "fx") continue; // conversion belongs to the currency module
      out.push(...flattenRates(v, [...path, k]));
    }
  }
  return out;
}

function unflattenRates(flat: FlatRate[]): Record<string, unknown> {
  // Property-injection guard (same class CodeQL flagged server-side): path
  // segments come from the fetched tariff and pass through editable state, so
  // never let a prototype-reaching key become a write target.
  const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
  const root: Record<string, unknown> = {};
  for (const f of flat) {
    if (f.path.some((k) => FORBIDDEN.has(k))) continue;
    let at = root;
    for (let i = 0; i < f.path.length - 1; i += 1) {
      const k = f.path[i];
      if (typeof at[k] !== "object" || at[k] === null) at[k] = {};
      at = at[k] as Record<string, unknown>;
    }
    const leaf = f.path[f.path.length - 1];
    at[leaf] = f.isArray
      ? f.value
          .split(/[,;]/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n >= 0)
      : Number(f.value) || 0;
  }
  return root;
}

function RateConfigModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const info = useResource<{ rates: Record<string, unknown>; source: string }>(
    () => tenant("/extra-charge-simulations/rates"),
    [open],
  );
  const [flat, setFlat] = React.useState<FlatRate[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && info.data) setFlat(flattenRates(info.data.rates));
    if (!open) {
      setFlat(null);
      setError(null);
    }
  }, [open, info.data]);

  async function save() {
    if (!flat) return;
    setBusy(true);
    setError(null);
    try {
      await tenant("/extra-charge-simulations/rates", {
        method: "PUT",
        body: { rates: unflattenRates(flat) },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Group rows by their first path segment so the modal reads as the legacy's
  // family sections rather than one flat wall of inputs.
  const groups = React.useMemo(() => {
    const g = new Map<string, FlatRate[]>();
    for (const f of flat || []) {
      const head = f.path[0] || "misc";
      g.set(head, [...(g.get(head) || []), f]);
    }
    return [...g.entries()];
  }, [flat]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Rate configuration")}
      description="The tariff every simulation on this screen uses — persisted for the whole tenant, not this browser. Bands are comma-separated per day range. FX is managed in Master Data → Currencies."
      size="lg"
    >
      {info.error ? (
        <ErrorState message={info.error} />
      ) : !flat ? null : (
        <div className="space-y-4">
          {groups.map(([family, rows]) => (
            <div key={family}>
              <p className="micro mb-2 uppercase">{family}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {rows.map((f) => {
                  const idx = (flat || []).indexOf(f);
                  return (
                    <Field
                      key={f.path.join(".")}
                      label={f.path.slice(1).join(" · ") || family}
                      hint={f.isArray ? "Bands, comma-separated" : undefined}
                    >
                      <Input
                        className="num text-right"
                        value={f.value}
                        onChange={(e) =>
                          setFlat((rs) =>
                            (rs || []).map((r, i) =>
                              i === idx ? { ...r, value: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>
                  );
                })}
              </div>
            </div>
          ))}
          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {tr("Cancel")}
            </Button>
            <Button onClick={save} loading={busy}>
              {tr("Save tariff")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── The screen ───────────────────────────────────────────────────────────── */

export function ExtraChargeSimulationsPage() {
  const reload = useRefresh();
  const { rows: saved, error: listError } = useList(
    "/extra-charge-simulations",
  );
  // Currencies come from the live currency module (GET /currencies), not a
  // hardcoded three-item list — when the treasurer adds or deactivates a
  // currency the dropdown moves with it (SS4).
  const currencies = useResource(() => listCurrencies(), []);
  /**
   * MISALIGNED CURRENCY SELECTOR (22 Aug). The label was `${code} — ${name}`,
   * so the trigger read "XAF — CFA Franc BEAC" in a ~120px column of a 3-up row
   * and wrapped to three lines, pushing the control out of its field.
   *
   * Fixed with the kit's own answer rather than a width hack: `Select`'s `hint`
   * is documented as "shown only in the open list… Radix clones ItemText into
   * the closed trigger, so a hint placed in `label` would follow the selection
   * into the collapsed control and turn a one-line field into two" — which is
   * precisely what was happening. Code in `label`, name in `hint`: the picker
   * still names the currency, the trigger shows "XAF".
   */
  const currencyOptions = (currencies.data || [])
    .filter((c) => c.is_active !== false)
    .map((c) => ({ value: c.code, label: c.code, hint: c.name || undefined }));

  // Inputs. The legacy's defaults: 11 free days (billing opens on day 12) and a
  // 14-day yard trigger — both editable, because a shipping line's contract can
  // move either and the operator is usually reading one off a bill of lading.
  const [containers, setContainers] = React.useState("2x40HC, 1x20RF");
  const [ata, setAta] = React.useState("");
  const [gateOut, setGateOut] = React.useState("");
  const [emptyReturn, setEmptyReturn] = React.useState("");
  const [freeDays, setFreeDays] = React.useState("11");
  const [yardTrigger, setYardTrigger] = React.useState("14");
  const [currency, setCurrency] = React.useState("XAF");
  const [shippingLine, setShippingLine] = React.useState("");

  // §3.2 — "The file" now has a file. Picking a dossier pre-fills containers,
  // ATA and the shipping line from what the system already knows; gate-out and
  // empty-return stay the operator's (the system does not know them yet).
  const [dossierId, setDossierId] = React.useState("");
  const [dossierLabel, setDossierLabel] = React.useState<string | null>(null);
  const [prefillNote, setPrefillNote] = React.useState<string | null>(null);
  async function pickDossier(d: { dossier_id?: unknown; ref?: unknown }) {
    const id = String(d.dossier_id);
    setDossierId(id);
    setDossierLabel(cell(d.ref ?? id));
    try {
      const p = await tenant<{
        containers: string | null;
        ata: string | null;
        shipping_line: string | null;
      }>(`/extra-charge-simulations/prefill/${id}`);
      if (p.containers) setContainers(p.containers);
      if (p.ata) setAta(String(p.ata).slice(0, 10));
      if (p.shipping_line) setShippingLine(p.shipping_line);
      setPrefillNote(
        p.containers || p.ata || p.shipping_line
          ? "Pre-filled from the file — edit anything that moved."
          : "The file has no containers or ATA recorded yet — enter them here.",
      );
    } catch (e) {
      setPrefillNote(errMsg(e));
    }
  }

  // §3.2 — bumping this after a tariff save re-runs the live preview with the
  // NEW persisted rates (the legacy's saveAdminSettings→updateCalc, but real).
  const [ratesVersion, setRatesVersion] = React.useState(0);
  const [ratesOpen, setRatesOpen] = React.useState(false);

  const [computed, setComputed] = React.useState<Computed | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [computing, setComputing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedNote, setSavedNote] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("all");
  // §3.2 — saved simulations are reusable, not inert: clicking a row opens it.
  const [selected, setSelected] = React.useState<Row | null>(null);
  /**
   * §2.4a — the saved simulation being EDITED, if any. Without this the only
   * forward action was "Re-apply to workbench", which re-seeds the form and
   * saves a SECOND row: every correction left a duplicate behind and the
   * register filled with near-identical simulations of the same file.
   */
  const [editingId, setEditingId] = React.useState<string | null>(null);
  /** The workbench dialog. Closed on arrival — the saved list is the page. */
  const [workbenchOpen, setWorkbenchOpen] = React.useState(false);

  const body = React.useCallback(
    (): Record<string, unknown> => ({
      dossier_id: dossierId || undefined,
      containers: containers.trim(),
      ata: ata || undefined,
      gate_out: gateOut || undefined,
      empty_return: emptyReturn || undefined,
      free_days: Number(freeDays) || 0,
      yard_trigger: Number(yardTrigger) || undefined,
      currency,
      shipping_line: shippingLine.trim() || undefined,
    }),
    [
      dossierId,
      containers,
      ata,
      gateOut,
      emptyReturn,
      freeDays,
      yardTrigger,
      currency,
      shippingLine,
    ],
  );

  // Live preview. The legacy recomputed on every keystroke because the whole
  // point is watching the total move as you try dates; debounced here so a
  // typed container list is one request, not twelve.
  const signature = useDebounced(JSON.stringify(body()), 350);
  const ready = containers.trim() !== "" && ata !== "" && gateOut !== "";

  React.useEffect(() => {
    if (!ready) {
      setComputed(null);
      return;
    }
    let cancelled = false;
    setComputing(true);
    tenant<Computed>("/extra-charge-simulations/preview", {
      method: "POST",
      // Parsed from the debounced signature, not from `body()`: the signature
      // is what the effect actually depends on, so sending anything else could
      // post inputs the dependency array never saw.
      body: JSON.parse(signature),
    })
      .then((c) => {
        if (cancelled) return;
        setComputed(c);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      })
      .finally(() => {
        if (!cancelled) setComputing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signature, ready, ratesVersion]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // §2.4a — PATCH the row being edited, POST a new one. The server
      // recomputes and replaces the stored result wholesale, including a fresh
      // tariff snapshot, so the row and its totals can never disagree.
      await tenant(
        editingId
          ? `/extra-charge-simulations/${editingId}`
          : "/extra-charge-simulations",
        { method: editingId ? "PATCH" : "POST", body: body() },
      );
      setSavedNote(editingId ? "Simulation updated." : "Simulation saved.");
      setEditingId(null);
      // Back to the list: it is the page, and the row just written is the
      // confirmation. Leaving the dialog open invites a second save of the
      // same estimate.
      setWorkbenchOpen(false);
      reload();
      window.setTimeout(() => setSavedNote(null), 4000);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Open an EMPTY workbench. Explicitly resets every input: the dialog now
   * outlives the estimate it was opened for, so without this a "new"
   * simulation would silently inherit the last one's dates and container list
   * — the sort of thing that is only noticed after it has been saved.
   */
  function startNew() {
    setEditingId(null);
    setDossierId("");
    setDossierLabel(null);
    setContainers("");
    setAta("");
    setGateOut("");
    setEmptyReturn("");
    setShippingLine("");
    setComputed(null);
    setError(null);
    setSavedNote(null);
    setWorkbenchOpen(true);
  }

  /** Load a saved simulation's inputs into the workbench. `asEdit` decides
   *  whether saving updates that row or creates a new one. */
  function loadIntoWorkbench(s: Row, asEdit: boolean) {
    const list = s.containers as { q: number; s: number; t: string }[] | null;
    if (Array.isArray(list) && list.length) {
      setContainers(list.map((c) => `${c.q}x${c.s}${c.t}`).join(", "));
    }
    if (s.ata) setAta(String(s.ata).slice(0, 10));
    if (s.gate_out) setGateOut(String(s.gate_out).slice(0, 10));
    if (s.empty_return) setEmptyReturn(String(s.empty_return).slice(0, 10));
    if (s.free_days != null) setFreeDays(String(s.free_days));
    if (s.shipping_line) setShippingLine(String(s.shipping_line));
    if (s.currency) setCurrency(String(s.currency));
    if (s.dossier_id) {
      setDossierId(String(s.dossier_id));
      setDossierLabel(null);
    }
    setEditingId(asEdit ? String(s.extra_charge_simulation_id) : null);
    setSelected(null);
    setWorkbenchOpen(true);
  }

  // The ribbon command must be a STABLE array — republishing it on every
  // keystroke would re-run the registry effect against a live-previewing
  // screen. So the callback is held in a ref and the array never changes
  // identity; without the ref the command would close over the first render's
  // `save` and post an empty simulation.
  const saveRef = React.useRef(save);
  saveRef.current = save;
  // The ribbon now offers NEW SIMULATION, not Save. Save belongs to the dialog
  // and only makes sense while it is open with something computed in it; a
  // ribbon "Save simulation" sitting over a list of saved simulations would
  // save whatever the last form state happened to be. Same stable-array and
  // ref discipline as before — the array identity must not change per
  // keystroke or the registry effect re-runs against a live-previewing screen.
  const newRef = React.useRef(startNew);
  newRef.current = startNew;
  useRibbonCommands(
    React.useMemo(
      () => [
        {
          key: "new",
          label: "New simulation",
          primary: true,
          onSelect: () => newRef.current(),
        },
      ],
      [],
    ),
  );

  const charges = computed?.rows ?? [];

  // Drop a filter whose family stopped existing. Change the dates so nothing is
  // billable in the family you were looking at and the chip row would lose that
  // option while `filter` still held it — leaving a table that reads "0 lines"
  // with no visibly selected chip to explain why, and no way back but reload.
  const hasFilter = charges.some((r) => r.cat === filter);
  React.useEffect(() => {
    if (filter !== "all" && !hasFilter) setFilter("all");
  }, [filter, hasFilter]);

  const shown =
    filter === "all" ? charges : charges.filter((r) => r.cat === filter);

  // Filtering the table filters the TOTAL too. The legacy did this and it is
  // the right behaviour: "what am I paying in storage alone" is the question
  // the filter is being asked, and a total that ignores it answers a different
  // one. The full TTC stays visible in the metrics band regardless.
  const shownHt = shown.reduce((a, r) => a + r.total, 0);
  const shownVat = shownHt * (computed?.vat_rate ?? 0.1925);

  const chipOptions = [
    { value: "all", label: "All", count: charges.length },
    ...FAMILIES.filter((f) => charges.some((r) => r.cat === f)).map((f) => ({
      value: f,
      label: f,
      count: charges.filter((r) => r.cat === f).length,
    })),
  ];

  const statusTone =
    computed?.status === "EXCEEDED"
      ? "bad"
      : computed?.status === "OK"
        ? "ok"
        : "mute";

  const savedCols: Column<Row>[] = [
    {
      key: "created",
      label: "Simulated",
      render: (r) => (
        <span className="whitespace-nowrap font-medium">
          {dateFmt(r.created_at)}
        </span>
      ),
    },
    {
      key: "line",
      label: "Shipping line",
      render: (r) => cell(r.shipping_line),
    },
    {
      key: "boxes",
      label: "Containers",
      render: (r) => {
        const list =
          (r.containers as { q: number; s: number; t: string }[]) || [];
        if (!Array.isArray(list) || list.length === 0)
          return cell(r.container_variant);
        return (
          <span className="num">
            {list.map((c) => `${c.q}x${c.s}${c.t}`).join(", ")}
          </span>
        );
      },
    },
    {
      key: "window",
      label: "ATA → gate-out",
      className: "hidden lg:table-cell",
      render: (r) =>
        r.ata ? (
          <span className="num whitespace-nowrap text-muted-foreground">
            {dateFmt(r.ata)} → {dateFmt(r.gate_out)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "free",
      label: "Free",
      className: "hidden xl:table-cell text-right",
      render: (r) => <span className="num">{cell(r.free_days)}</span>,
    },
    {
      key: "ht",
      label: "Total HT",
      className: "text-right",
      render: (r) => <span className="num">{money0(amount(r.total_ht))}</span>,
    },
    {
      key: "vat",
      label: "VAT",
      className: "hidden lg:table-cell text-right",
      render: (r) => (
        <span className="num text-muted-foreground">
          {money0(amount(r.vat_total))}
        </span>
      ),
    },
    {
      key: "ttc",
      label: "Total TTC",
      className: "text-right",
      render: (r) => (
        <span className="num font-semibold text-primary-ink">
          {money(r.total_amount, r.currency)}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow={<HubCrumb area="Commercial" to="/commercial" />}
        title="Extra-charge simulator"
        description="Demurrage, storage, yard occupancy, plugging and detention across a container list — an estimate, with no accounting entries."
        action={
          <Button onClick={() => startNew()}>{tr("New simulation")}</Button>
        }
      />
      <HubTabs />

      {/* ── Saved simulations ARE the page now. Arriving here shows what has
             been estimated against which file; a new estimate is a deliberate act. ── */}
      <div className="mt-4">
        <Panel
          title="Saved simulations"
          subtitle="Each row keeps the tariff it was computed with — click one to open it"
          className="p-4"
        >
          <DataList
            columns={savedCols}
            rows={saved}
            error={listError}
            loading={saved === null}
            density="compact"
            sticky
            maxHeight="640px"
            rowKey={(r, i) => String(r.extra_charge_simulation_id ?? i)}
            onRowClick={(r) => setSelected(r)}
            empty={{
              title: "No simulations saved yet",
              hint: "Start one with New simulation — a container list, an ATA and a gate-out date are all it needs.",
            }}
          />
        </Panel>
      </div>

      {/* ── THE WORKBENCH, now in a dialog (owner's call, 22 Aug 2026). ─────
             The note at the top of this file argued for a full page AGAINST a
             dialog, because a dialog caps the result height and hides the saved
             list behind it. The height half of that is still true, so it is
             answered rather than ignored: `size="wide"` keeps the 400px rail
             beside a real results column, the charge table keeps its own
             internal scroll, and the dialog scrolls its body — the estimate is
             never truncated.

             The other half no longer holds. Simulating is not the first thing
             an operator does on arriving; seeing what has already been
             estimated is. So the saved list IS the page, and starting a new
             estimate is a deliberate act rather than the default state. ── */}
      <Modal
        open={workbenchOpen}
        onClose={() => setWorkbenchOpen(false)}
        title={editingId ? tr("Edit simulation") : tr("New simulation")}
        description="Demurrage, storage, yard occupancy, plugging and detention across a container list — an estimate, with no accounting entries."
        size="wide"
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* ── Input rail. Sticky from xl, where there is height to spend. ── */}
        <div className="xl:sticky xl:top-2 xl:self-start">
          <Panel
            title="The file"
            subtitle="Dates and boxes — the charge follows"
            action={
              // §3.2 — the legacy toolbar button (openAdminModal), one click
              // from the calculation. Everyone can look; saving is admin.
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRatesOpen(true)}
              >
                {tr("Rate configuration")}
              </Button>
            }
            className="p-4"
          >
            <div className="space-y-3">
              <Field
                label={tr("Operations file")}
                hint="Pre-fills containers, ATA and the shipping line"
              >
                <SearchSelect
                  path="/operations"
                  value={dossierLabel}
                  placeholder={tr("Search files…")}
                  getLabel={(d) => cell(d.ref ?? d.dossier_id)}
                  getKey={(d) => String(d.dossier_id)}
                  onSelect={(d) => void pickDossier(d)}
                />
              </Field>
              {prefillNote && (
                <p className="micro" role="status">
                  {prefillNote}
                </p>
              )}
              <Field
                label="Containers"
                hint="Free text, as on the bill of lading — “2x40HC, 1x20RF”."
              >
                <Input
                  value={containers}
                  onChange={(e) => setContainers(e.target.value)}
                  placeholder="2x40HC, 1x20RF"
                />
              </Field>

              {computed && computed.containers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {computed.containers.map((c, i) => (
                    <Pill key={i} tone={c.t === "RF" ? "blue" : "mute"}>
                      <span className="num">
                        {c.q} × {c.s}′ {c.t}
                      </span>
                    </Pill>
                  ))}
                </div>
              )}

              {/* Two-up from the narrowest useful width: these are short date
                  boxes and stacking them wastes the rail's whole budget. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="ATA" hint="Vessel arrival">
                  <DateField value={ata} onChange={setAta} />
                </Field>
                <Field label="Gate-out" hint="Left the port">
                  <DateField value={gateOut} onChange={setGateOut} />
                </Field>
                <Field label="Empty return" hint="Drives detention">
                  <DateField value={emptyReturn} onChange={setEmptyReturn} />
                </Field>
                <Field label="Shipping line">
                  <Input
                    value={shippingLine}
                    onChange={(e) => setShippingLine(e.target.value)}
                    placeholder="Maersk"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Free days">
                  <Input
                    type="number"
                    min="0"
                    className="num text-right"
                    value={freeDays}
                    onChange={(e) => setFreeDays(e.target.value)}
                  />
                </Field>
                <Field label="Yard from">
                  <Input
                    type="number"
                    min="1"
                    className="num text-right"
                    value={yardTrigger}
                    onChange={(e) => setYardTrigger(e.target.value)}
                  />
                </Field>
                <Field
                  label={tr("Currency")}
                  className="col-span-2 sm:col-span-1"
                >
                  <Select
                    value={currency}
                    onValueChange={setCurrency}
                    options={currencyOptions}
                  />
                </Field>
              </div>

              {/* The tariff is editable from THIS screen (Rate configuration,
                  above) — pointing at Settings was true of an earlier build and
                  sends the operator away mid-simulation for no reason. VAT is
                  the tenant's rate now too, not the engine's old 19.25%
                  literal (§2.3). */}
              <p className="text-micro text-muted-foreground">
                {tr(
                  "Rates come from the tenant tariff — edit them in Rate configuration above. The total recomputes as you type; saving freezes the tariff onto the record so it can still explain itself after a rate change.",
                )}
              </p>

              {editingId && (
                <p className="text-micro text-[rgb(var(--warn))]" role="status">
                  {tr("Editing a saved simulation — saving replaces it.")}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setEditingId(null)}
                  >
                    {tr("Save as new instead")}
                  </button>
                </p>
              )}

              {/* Always visible now. This was `hidden md:flex` because the
                  page header carried a phone-only Save; that header button is
                  now "New simulation", so hiding this one below `md` would
                  leave a phone with no way to save at all. */}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setWorkbenchOpen(false)}
                  disabled={saving}
                >
                  {tr("Cancel")}
                </Button>
                <Button
                  onClick={save}
                  loading={saving}
                  disabled={!computed || computed.total_ttc === 0}
                >
                  {editingId ? tr("Update simulation") : tr("Save simulation")}
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Results ────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {error && <ErrorState message={error} />}
          {savedNote && (
            <div className="rounded-lg border border-[rgb(var(--ok)_/_0.3)] bg-[rgb(var(--ok)_/_0.06)] px-3 py-2 text-sm text-[rgb(var(--ok))]">
              {savedNote}
            </div>
          )}

          {/* 2-up on a phone, 3-up at md, all six across at xl — the band is
              one row of height on a desktop rather than three. */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Port stay"
              value={computed ? `${computed.port_stay_days} d` : "—"}
              sub={computed ? `${computed.free_days} free` : undefined}
            />
            <Metric
              label="Free until"
              value={computed?.due_date ? dateFmt(computed.due_date) : "—"}
              sub="ATA + free − 1"
            />
            <Metric
              label="Status"
              value={computed?.status ?? "WAITING"}
              tone={
                computed?.status === "EXCEEDED"
                  ? "bad"
                  : computed?.status === "OK"
                    ? "ok"
                    : undefined
              }
            />
            <Metric
              label="Boxes"
              value={computed ? String(computed.container_count) : "—"}
              sub={computed ? `${computed.teu} TEU` : undefined}
            />
            <Metric
              label="Total HT"
              value={computed ? money0(computed.total_ht) : "—"}
              sub={currency}
            />
            <Metric
              label="Total TTC"
              value={computed ? money0(computed.total_ttc) : "—"}
              sub={
                computed
                  ? `incl. ${(computed.vat_rate * 100).toFixed(2)}% VAT`
                  : undefined
              }
              tone="accent"
            />
          </div>

          {/* Family totals: five small cards, the shape of the charge at a
              glance. Also the fastest way to spot a family billing zero when
              it should not — the defect that made this rebuild necessary. */}
          {computed && charges.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {FAMILIES.map((f) => {
                const v = computed.families[f] ?? 0;
                const pct = computed.total_ht
                  ? (v / computed.total_ht) * 100
                  : 0;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(filter === f ? "all" : f)}
                    aria-pressed={filter === f}
                    className={cn(
                      "rounded-lg border bg-card px-3 py-2 text-left transition-colors",
                      "hover:bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]",
                      filter === f && "border-[rgb(var(--brand-blue))]",
                    )}
                  >
                    <div className="truncate text-micro uppercase text-muted-foreground">
                      {f}
                    </div>
                    <div className="num text-sm font-semibold">{money0(v)}</div>
                    <div
                      className="mt-1 h-1 rounded-full bg-secondary"
                      aria-hidden="true"
                    >
                      <div
                        className="h-1 rounded-full bg-[rgb(var(--brand-blue))]"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <Panel
            title="Charge breakdown"
            subtitle={
              computed
                ? `${shown.length} line${shown.length === 1 ? "" : "s"} · ${computed.currency}`
                : "Awaiting ATA, gate-out and a container list"
            }
            action={
              computed && computed.status === "EXCEEDED" ? (
                <Pill tone={statusTone}>Free period exceeded</Pill>
              ) : undefined
            }
            className="p-4"
            bodyClassName="space-y-3"
          >
            {chipOptions.length > 1 && (
              <Chips
                label="Filter by charge family"
                value={filter}
                onChange={setFilter}
                options={chipOptions}
              />
            )}

            {!ready ? (
              <EmptyState
                title="Enter the file"
                hint="A container list, an ATA and a gate-out date are all it needs. Everything else has a sensible default."
              />
            ) : charges.length === 0 ? (
              <EmptyState
                title={computing ? "Computing…" : "No charges"}
                hint={
                  computing
                    ? undefined
                    : "The boxes left inside every free period — nothing is billable on these dates."
                }
              />
            ) : (
              /* `sticky` bounds the table's height, which is what keeps the
                 headings AND the totals row on screen while 60 charge lines
                 scroll underneath. The cap is generous on tall displays and
                 shrinks on short ones. */
              <Table
                sticky
                maxHeight="clamp(280px, calc(100vh - 30rem), 900px)"
                density="compact"
                containerClassName={computing ? "opacity-60" : undefined}
              >
                <THead>
                  <TR>
                    <TH>Family</TH>
                    <TH>Detail</TH>
                    <TH className="text-right">Days</TH>
                    <TH className="hidden text-right sm:table-cell">
                      Unit rate
                    </TH>
                    <TH className="text-right">Amount HT</TH>
                    <TH className="hidden text-right lg:table-cell">VAT</TH>
                    <TH className="text-right">TTC</TH>
                  </TR>
                </THead>
                <TBody>
                  {shown.map((r, i) => (
                    <TR key={`${r.cat}-${r.desc}-${i}`}>
                      <TD>
                        <Pill tone={r.cat === "Demurrage" ? "orange" : "mute"}>
                          {r.cat}
                        </Pill>
                      </TD>
                      <TD className="text-muted-foreground">{r.desc}</TD>
                      <TD className="num text-right">{r.qty}</TD>
                      <TD className="num hidden text-right text-muted-foreground sm:table-cell">
                        {money0(r.unit)}
                      </TD>
                      <TD className="num text-right">{money0(r.total)}</TD>
                      <TD className="num hidden text-right text-muted-foreground lg:table-cell">
                        {money0(r.total * (computed?.vat_rate ?? 0.1925))}
                      </TD>
                      <TD className="num text-right font-medium">
                        {money0(r.total * (1 + (computed?.vat_rate ?? 0.1925)))}
                      </TD>
                    </TR>
                  ))}
                </TBody>
                <tfoot className="sticky bottom-0 border-t bg-secondary">
                  <TR className="hover:bg-transparent">
                    <TD className="font-semibold" colSpan={2}>
                      {filter === "all" ? "Total" : `Total — ${filter}`}
                    </TD>
                    <TD />
                    <TD className="hidden sm:table-cell" />
                    <TD className="num text-right font-semibold">
                      {money0(shownHt)}
                    </TD>
                    <TD className="num hidden text-right text-muted-foreground lg:table-cell">
                      {money0(shownVat)}
                    </TD>
                    <TD className="num text-right font-semibold text-primary-ink">
                      {money0(shownHt + shownVat)}
                    </TD>
                  </TR>
                </tfoot>
              </Table>
            )}
          </Panel>
        </div>
      </div>
      </Modal>


      {/* §3.2 — a saved simulation opens and re-applies: they are saved to be
          reused, not to sit as inert rows. */}
      {selected && (
        <SavedSimModal
          summary={selected}
          onClose={() => setSelected(null)}
          onLoad={loadIntoWorkbench}
        />
      )}

      <RateConfigModal
        open={ratesOpen}
        onClose={() => setRatesOpen(false)}
        onSaved={() => setRatesVersion((v) => v + 1)}
      />

      <AiActions actions={EXTRA_AI} />
    </PageContainer>
  );
}

/**
 * §2.6 — a saved simulation, read from the SERVER's rebuilt result.
 *
 * This modal used to read raw columns off the list row: `selected.total_ht`,
 * `selected.computed_charges`. `create` returned a `computed` object and `get`
 * returned only the bare row, so the screen that SAVED a simulation could
 * render its breakdown and the screen that RE-OPENED the same simulation could
 * not — hence TOTAL TTC 450,000.00 XAF beside TOTAL HT "—", over an empty
 * charge table. `GET /:id` now rebuilds `computed` from the frozen jsonb, so
 * this fetches by id and reads that.
 */
function SavedSimModal({
  summary,
  onClose,
  onLoad,
}: {
  summary: Row;
  onClose: () => void;
  onLoad: (s: Row, asEdit: boolean) => void;
}) {
  const id = String(summary.extra_charge_simulation_id);
  const detail = useResource<SavedSim | null>(
    () => tenant<SavedSim>(`/extra-charge-simulations/${id}`),
    [id],
  );
  // Fall back to the list row while the fetch is in flight, so the modal opens
  // with something rather than blank.
  const s = (detail.data || summary) as SavedSim;
  const c = detail.data?.computed;
  const currency = String(s.currency || "XAF");
  const rows = c?.rows ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={tr("Saved simulation")}
      description="The estimate as computed, with the tariff it was frozen with."
      size="lg"
    >
      <div className="space-y-3">
        {detail.error && <ErrorState message={detail.error} />}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Simulated" value={dateFmt(s.created_at)} />
          <Metric
            label="Shipping line"
            value={cell(s.shipping_line)}
          />
          <Metric
            label="Total HT"
            value={money0(c ? c.total_ht : amount(s.total_ht))}
            sub={c ? `${(c.vat_rate * 100).toFixed(2)}% VAT · ${money0(c.vat)}` : undefined}
          />
          <Metric
            label="Total TTC"
            value={money(c ? c.total_ttc : amount(s.total_amount), currency)}
            tone="accent"
          />
        </div>
        {c && c.rendered_from_snapshot === false && (
          <p className="text-micro text-[rgb(var(--warn))]">
            {tr(
              "Saved before the tariff was frozen onto the record — the totals stand, but the line-by-line breakdown cannot be reconstructed.",
            )}
          </p>
        )}
        {(() => {
          return rows.length ? (
            <Table sticky maxHeight="320px" density="compact">
              <THead>
                <TR>
                  <TH>Family</TH>
                  <TH>Detail</TH>
                  <TH className="text-right">Days</TH>
                  <TH className="text-right">Amount HT</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r, i) => (
                  <TR key={i}>
                    <TD>{r.cat}</TD>
                    <TD className="text-muted-foreground">{r.desc}</TD>
                    <TD className="num text-right">{r.qty}</TD>
                    <TD className="num text-right">{money0(r.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : null;
        })()}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Close")}
          </Button>
          {/* Re-apply CLONES: the live preview recomputes against TODAY's
              tariff, which is the point (compare then vs now), and saving
              writes a new row. That is a legitimate act — it just is not
              the only one, which is what made it a duplicate factory. */}
          <Button variant="outline" onClick={() => onLoad(s, false)}>
            {tr("Re-apply as new")}
          </Button>
          {/* §2.4a — correct THIS simulation instead of leaving a near
              identical twin beside it. */}
          <Button onClick={() => onLoad(s, true)}>{tr("Edit")}</Button>
        </div>
      </div>
    </Modal>
  );
}
