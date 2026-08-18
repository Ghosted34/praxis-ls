/**
 * Structured editor for a tax code's `brackets` JSON (MOD-07).
 *
 * The most-likely-to-change tax parameters at a Finance-Law boundary are the
 * ones the flat `rate_percent` column can't hold: the IRPP progressive scale,
 * the CNPS contribution caps, and the work-injury risk classes. They live in
 * `tax_code.brackets` (jsonb) and, until now, could only be seeded via SQL —
 * which defeats the whole "amend a rate without a developer" promise.
 *
 * This gives non-technical finance staff a form for the three shapes the seed
 * uses (migrations/seeds/9010_seed_tax.sql), composed into one object:
 *
 *   progressive : { annual_brackets:[{upto,rate}…,{above,rate}], deductions?:{…} }
 *   cap         : { cap_xaf: number }
 *   risk classes: { risk_classes: { <name>: <rate>, … } }
 *
 * `buildBrackets` serialises the editor state back to that object (or null when
 * nothing is filled); `parseBrackets` hydrates the editor from an existing row
 * so "Amend" pre-fills the current scale. A code may combine a `rate_percent`
 * with a `cap_xaf` (e.g. CNPS pension 4.2% capped at 750,000) — the parts are
 * independent, so each is behind its own toggle.
 */
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { num } from "@/lib/format";

type ThresholdRow = { limit: string; rate: string };
type RiskRow = { name: string; rate: string };

export type BracketsValue = Record<string, unknown> | null;

export type BracketsState = {
  scaleOn: boolean;
  rows: ThresholdRow[];
  topRate: string;
  deductionsOn: boolean;
  cnpsPension: boolean;
  profAllowancePct: string;
  annualAbatement: string;
  capOn: boolean;
  capXaf: string;
  riskOn: boolean;
  risk: RiskRow[];
};

export const emptyBracketsState = (): BracketsState => ({
  scaleOn: false,
  rows: [{ limit: "", rate: "" }],
  topRate: "",
  deductionsOn: false,
  cnpsPension: false,
  profAllowancePct: "",
  annualAbatement: "",
  capOn: false,
  capXaf: "",
  riskOn: false,
  risk: [{ name: "", rate: "" }],
});

const n = (s: string): number | null => {
  if (s === "" || s == null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** Editor state → the `brackets` object (or null when nothing usable is set). */
export function buildBrackets(s: BracketsState): BracketsValue {
  const out: Record<string, unknown> = {};

  if (s.scaleOn) {
    const upto = s.rows
      .map((r) => ({ upto: n(r.limit), rate: n(r.rate) }))
      .filter((r) => r.upto != null && r.rate != null) as {
      upto: number;
      rate: number;
    }[];
    const annual: Record<string, number>[] = upto.map((r) => ({
      upto: r.upto,
      rate: r.rate,
    }));
    const top = n(s.topRate);
    if (top != null) {
      const lastLimit = upto.length ? Math.max(...upto.map((r) => r.upto)) : 0;
      annual.push({ above: lastLimit, rate: top });
    }
    if (annual.length) out.annual_brackets = annual;

    if (s.deductionsOn) {
      const ded: Record<string, unknown> = {};
      if (s.cnpsPension) ded.cnps_pension = true;
      const pa = n(s.profAllowancePct);
      if (pa != null) ded.prof_allowance_pct = pa;
      const ab = n(s.annualAbatement);
      if (ab != null) ded.annual_abatement = ab;
      if (Object.keys(ded).length) out.deductions = ded;
    }
  }

  if (s.capOn) {
    const cap = n(s.capXaf);
    if (cap != null) out.cap_xaf = cap;
  }

  if (s.riskOn) {
    const classes: Record<string, number> = {};
    for (const r of s.risk) {
      const name = r.name.trim();
      const rate = n(r.rate);
      if (name && rate != null) classes[name] = rate;
    }
    if (Object.keys(classes).length) out.risk_classes = classes;
  }

  return Object.keys(out).length ? out : null;
}

/** An existing `brackets` object → editor state (for the Amend pre-fill). */
export function parseBrackets(value: unknown): BracketsState {
  const s = emptyBracketsState();
  if (!value || typeof value !== "object") return s;
  const v = value as Record<string, unknown>;

  const annual = Array.isArray(v.annual_brackets)
    ? (v.annual_brackets as Record<string, unknown>[])
    : null;
  if (annual && annual.length) {
    s.scaleOn = true;
    const rows: ThresholdRow[] = [];
    for (const b of annual) {
      if (b.upto != null)
        rows.push({
          limit: String(b.upto),
          rate: b.rate != null ? String(b.rate) : "",
        });
      else if (b.above != null)
        s.topRate = b.rate != null ? String(b.rate) : "";
    }
    s.rows = rows.length ? rows : [{ limit: "", rate: "" }];
  }

  const ded =
    v.deductions && typeof v.deductions === "object"
      ? (v.deductions as Record<string, unknown>)
      : null;
  if (ded) {
    s.deductionsOn = true;
    s.cnpsPension = ded.cnps_pension === true;
    if (ded.prof_allowance_pct != null)
      s.profAllowancePct = String(ded.prof_allowance_pct);
    if (ded.annual_abatement != null)
      s.annualAbatement = String(ded.annual_abatement);
  }

  if (v.cap_xaf != null) {
    s.capOn = true;
    s.capXaf = String(v.cap_xaf);
  }

  const risk =
    v.risk_classes && typeof v.risk_classes === "object"
      ? (v.risk_classes as Record<string, unknown>)
      : null;
  if (risk) {
    s.riskOn = true;
    const rows = Object.entries(risk).map(([name, rate]) => ({
      name,
      rate: rate != null ? String(rate) : "",
    }));
    s.risk = rows.length ? rows : [{ name: "", rate: "" }];
  }

  return s;
}

/** Small labelled toggle header for each optional sub-editor. */
function Toggle({
  on,
  onChange,
  title,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-sm font-medium">{title}</span>
      </label>
      <p className="pl-6 micro text-muted-foreground">{hint}</p>
    </div>
  );
}

export function BracketsEditor({
  state,
  onChange,
}: {
  state: BracketsState;
  onChange: (s: BracketsState) => void;
}) {
  const set = (patch: Partial<BracketsState>) =>
    onChange({ ...state, ...patch });

  const setRow = (i: number, patch: Partial<ThresholdRow>) =>
    set({ rows: state.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRow = () => set({ rows: [...state.rows, { limit: "", rate: "" }] });
  const removeRow = (i: number) =>
    set({
      rows:
        state.rows.length > 1
          ? state.rows.filter((_, j) => j !== i)
          : state.rows,
    });

  const setRisk = (i: number, patch: Partial<RiskRow>) =>
    set({ risk: state.risk.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRisk = () => set({ risk: [...state.risk, { name: "", rate: "" }] });
  const removeRisk = (i: number) =>
    set({
      risk:
        state.risk.length > 1
          ? state.risk.filter((_, j) => j !== i)
          : state.risk,
    });

  const lastLimit = state.rows
    .map((r) => Number(r.limit))
    .filter((x) => Number.isFinite(x) && x > 0)
    .reduce((a, b) => Math.max(a, b), 0);

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <p className="micro text-muted-foreground">
        Advanced parameters that don&apos;t fit a single rate — the IRPP scale,
        a contribution cap, or work-injury risk classes. Leave all off for a
        simple percentage code.
      </p>

      {/* Progressive scale (IRPP) */}
      <div className="space-y-2">
        <Toggle
          on={state.scaleOn}
          onChange={(v) => set({ scaleOn: v })}
          title="Progressive scale (barème)"
          hint="e.g. IRPP annual brackets — a rate per income band."
        />
        {state.scaleOn && (
          <div className="space-y-2 pl-6">
            {state.rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 micro text-muted-foreground">
                  Up to
                </span>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  className="num text-right"
                  value={r.limit}
                  onChange={(e) => setRow(i, { limit: e.target.value })}
                  placeholder="2000000"
                />
                <span className="micro text-muted-foreground">XAF →</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num w-24 text-right"
                  value={r.rate}
                  onChange={(e) => setRow(i, { rate: e.target.value })}
                  placeholder="10"
                />
                <span className="micro text-muted-foreground">%</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeRow(i)}
                  aria-label="Remove band"
                >
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 micro text-muted-foreground">
                Above
              </span>
              <span
                className="num rounded-md border bg-background px-3 py-2 text-right text-sm text-muted-foreground"
                style={{ minWidth: "8rem" }}
              >
                {lastLimit ? num(lastLimit) : "—"}
              </span>
              <span className="micro text-muted-foreground">XAF →</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="num w-24 text-right"
                value={state.topRate}
                onChange={(e) => set({ topRate: e.target.value })}
                placeholder="35"
              />
              <span className="micro text-muted-foreground">%</span>
            </div>
            <Button size="sm" variant="outline" onClick={addRow}>
              + Add band
            </Button>

            {/* Deductions applied before the scale (IRPP) */}
            <div className="mt-2 border-t pt-2">
              <Toggle
                on={state.deductionsOn}
                onChange={(v) => set({ deductionsOn: v })}
                title="Pre-tax deductions"
                hint="Applied to the base before the scale (IRPP net-taxable)."
              />
              {state.deductionsOn && (
                <div className="mt-2 space-y-2 pl-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={state.cnpsPension}
                      onChange={(e) => set({ cnpsPension: e.target.checked })}
                    />
                    Deduct CNPS pension first
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="micro text-muted-foreground">
                      Professional allowance
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="num w-24 text-right"
                      value={state.profAllowancePct}
                      onChange={(e) =>
                        set({ profAllowancePct: e.target.value })
                      }
                      placeholder="30"
                    />
                    <span className="micro text-muted-foreground">%</span>
                    <span className="ml-3 micro text-muted-foreground">
                      Annual abatement
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      className="num w-32 text-right"
                      value={state.annualAbatement}
                      onChange={(e) => set({ annualAbatement: e.target.value })}
                      placeholder="500000"
                    />
                    <span className="micro text-muted-foreground">{tr("XAF")}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Contribution cap (CNPS) */}
      <div className="space-y-2 border-t pt-3">
        <Toggle
          on={state.capOn}
          onChange={(v) => set({ capOn: v })}
          title="Contribution cap"
          hint="Base is capped, e.g. CNPS ceiling 750,000 XAF/month."
        />
        {state.capOn && (
          <div className="flex items-center gap-2 pl-6">
            <span className="micro text-muted-foreground">{tr("Cap")}</span>
            <Input
              type="number"
              min="0"
              step="1"
              className="num w-40 text-right"
              value={state.capXaf}
              onChange={(e) => set({ capXaf: e.target.value })}
              placeholder="750000"
            />
            <span className="micro text-muted-foreground">{tr("XAF")}</span>
          </div>
        )}
      </div>

      {/* Risk classes (work injury) */}
      <div className="space-y-2 border-t pt-3">
        <Toggle
          on={state.riskOn}
          onChange={(v) => set({ riskOn: v })}
          title="Risk classes"
          hint="A rate per class, e.g. work-injury office / ops / high."
        />
        {state.riskOn && (
          <div className="space-y-2 pl-6">
            {state.risk.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="w-40"
                  value={r.name}
                  onChange={(e) => setRisk(i, { name: e.target.value })}
                  placeholder="office"
                />
                <span className="micro text-muted-foreground">→</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num w-24 text-right"
                  value={r.rate}
                  onChange={(e) => setRisk(i, { rate: e.target.value })}
                  placeholder="1.75"
                />
                <span className="micro text-muted-foreground">%</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeRisk(i)}
                  aria-label="Remove class"
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRisk}>
              + Add class
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
