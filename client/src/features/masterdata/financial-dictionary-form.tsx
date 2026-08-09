/**
 * Financial dictionary — the create/edit wizard.
 *
 * UX per the spec's long-form playbook: a 3-step wizard (Basic → Advanced →
 * Review) with a progress header, single-column top-labelled fields, inline
 * validation, segmented/chips/toggles for small choices, a Direction-prefiltered
 * SYSCOHADA account popover, and client-side autosave so a dropped session does
 * not lose typing. There is NO database draft (Q17): an item is only ever
 * persisted complete, with its OHADA mapping — the autosave is the browser's,
 * not the ledger's.
 *
 * Basic step alone is enough to create a valid item; Advanced + Review are
 * optional passes. Required fields all live in Basic by design.
 */
import * as React from "react";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { SearchSelect } from "@/components/ui/search-select";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { money } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import * as ops from "@/lib/operations-api";

type Ctx = api.PostingContext;
type RuleRow = { applies_context: Ctx; debit_account: string; credit_account: string; tax_code_id: string; is_debours: boolean };
type TierRow = { service_type_id: string; tier: api.Tier };

const DIRECTIONS: { value: api.Direction; label: string; letter: string }[] = [
  { value: "REVENUE", label: "Revenue", letter: "R" },
  { value: "EXPENSE", label: "Expense", letter: "E" },
  { value: "DEBOURS", label: "Débours", letter: "D" },
  { value: "ASSET", label: "Asset", letter: "A" },
];
const CATEGORIES = ["service", "debours", "overhead", "asset", "other"] as const;
const CONTEXTS: Ctx[] = ["sale", "purchase", "disbursement"];
const APPLIC: { value: api.ApplicabilityMode; label: string }[] = [
  { value: "SERVICE_SCOPED", label: "Service-scoped" },
  { value: "ANY_OPERATIONS", label: "Any operation" },
  { value: "NON_OPERATIONAL", label: "Overhead / admin" },
];
const RECEIPT: api.ReceiptRequirement[] = ["NOT_REQUIRED", "CONDITIONALLY_REQUIRED", "ALWAYS_REQUIRED"];
const TIERS: api.Tier[] = ["BASIC", "ADVANCED", "FULL"];
const DRAFT_KEY = "fd-wizard-draft-v1";

// Which SYSCOHADA class each account side naturally belongs to, so the picker
// opens already narrowed (removable). Class 6 charge, 7 revenue, 2 asset, 4 third-party.
function preferClass(ctx: Ctx, side: "debit" | "credit", direction: api.Direction): number | undefined {
  if (ctx === "sale") return side === "credit" ? 7 : 4;
  if (ctx === "purchase") return side === "debit" ? (direction === "ASSET" ? 2 : 6) : 4;
  return 4; // disbursement clears through class 4 (4731)
}

function AccountField({ label, value, onChange, preferredClass }: { label: string; value: string; onChange: (v: string) => void; preferredClass?: number }) {
  const [restrict, setRestrict] = React.useState<boolean>(!!preferredClass);
  return (
    <Field label={label}>
      <SearchSelect
        path="/chart-of-accounts"
        value={value}
        label={label}
        placeholder={value || "Search account…"}
        getKey={(r) => String(r.code)}
        getLabel={(r) => `${r.code} — ${r.label_fr ?? ""}`.trim()}
        filter={(r) => r.is_postable !== false && (restrict && preferredClass ? Number(r.class) === preferredClass : true)}
        onSelect={(r) => onChange(String(r.code))}
      />
      {preferredClass ? (
        <button type="button" onClick={() => setRestrict((v) => !v)} className="mt-1 text-xs text-muted-foreground underline">
          {restrict ? `Showing class ${preferredClass} only — browse all` : "Restrict to class " + preferredClass}
        </button>
      ) : null}
    </Field>
  );
}

export function DictForm({ row, onClose, onSaved }: { row: api.DictFull | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const toast = useToast();
  const services = useResource(() => ops.listServiceTypes({ includeInactive: false }), []);
  const taxCodes = useResource(() => api.listSalesTaxCodes(), []);
  const subcats = useResource(() => api.listDictRefs("SUBCATEGORY"), []);
  const units = useResource(() => api.listDictRefs("UNIT"), []);
  const proofSources = useResource(() => api.listDictRefs("PROOF_SOURCE"), []);
  const providers = useResource(() => api.listDictRefs("PROVIDER_KIND"), []);

  const [step, setStep] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // One flat state object → trivial autosave.
  const [f, setF] = React.useState(() => ({
    label_fr: row?.label_fr ?? "",
    label_en: row?.label_en ?? "",
    description: row?.description ?? "",
    category: row?.category ?? "service",
    direction: (row?.direction ?? "REVENUE") as api.Direction,
    applicability_mode: (row?.applicability_mode ?? "ANY_OPERATIONS") as api.ApplicabilityMode,
    subcategory: row?.subcategory ?? "",
    unit_of_measure: row?.unit_of_measure ?? "",
    default_price: row?.default_price != null ? String(row.default_price) : "",
    currency: row?.currency ?? "XAF",
    provider_kind: row?.provider_kind ?? "",
    proof_source: row?.proof_source ?? "",
    is_billable: row?.is_billable ?? true,
    is_debours: row?.is_debours ?? false,
    requires_justification: row?.requires_justification ?? false,
    receipt_requirement: (row?.receipt_requirement ?? "NOT_REQUIRED") as api.ReceiptRequirement,
    debours_vat_transparent: row?.debours_vat_transparent ?? true,
  }));
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const [rules, setRules] = React.useState<RuleRow[]>(
    (row?.posting_rules || []).map((r) => ({
      applies_context: r.applies_context, debit_account: r.debit_account ?? "", credit_account: r.credit_account ?? "",
      tax_code_id: r.tax_code_id ?? "", is_debours: !!r.is_debours,
    })),
  );
  const [tiers, setTiers] = React.useState<TierRow[]>((row?.service_tiers || []).map((t) => ({ service_type_id: t.service_type_id, tier: t.tier })));
  React.useEffect(() => { if (rules.length === 0) setRules([{ applies_context: "sale", debit_account: "", credit_account: "", tax_code_id: "", is_debours: false }]); }, [rules.length]);

  // Autosave (new items only) — restore on mount, persist on change, clear on exit.
  React.useEffect(() => {
    if (!isNew) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.f) setF((s) => ({ ...s, ...d.f }));
        if (Array.isArray(d.rules) && d.rules.length) setRules(d.rules);
        if (Array.isArray(d.tiers)) setTiers(d.tiers);
      }
    } catch { /* ignore malformed draft */ }
  }, [isNew]);
  React.useEffect(() => {
    if (!isNew) return;
    const h = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ f, rules, tiers })); } catch { /* quota */ } }, 400);
    return () => clearTimeout(h);
  }, [isNew, f, rules, tiers]);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  const setRule = (i: number, patch: Partial<RuleRow>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { applies_context: "purchase", debit_account: "", credit_account: "", tax_code_id: "", is_debours: f.direction === "DEBOURS" }]);
  const delRule = (i: number) => setRules((rs) => (rs.length === 1 ? rs : rs.filter((_, j) => j !== i)));

  const codeLetter = DIRECTIONS.find((d) => d.value === f.direction)?.letter ?? "X";

  // Validation — everything required lives in Basic.
  const scoped = f.applicability_mode === "SERVICE_SCOPED";
  const rulesComplete = rules.every((r) => r.debit_account && r.credit_account);
  const basicValid = !!f.label_fr && !!f.category && !!f.direction && rules.length > 0 && rulesComplete && (!scoped || tiers.length > 0);
  const canSave = basicValid && !busy;

  function payload(): api.DictInput {
    return {
      label_fr: f.label_fr.trim(),
      label_en: f.label_en.trim() || undefined,
      description: f.description.trim() || undefined,
      category: f.category as api.DictInput["category"],
      direction: f.direction,
      applicability_mode: f.applicability_mode,
      subcategory: f.subcategory || undefined,
      unit_of_measure: f.unit_of_measure || undefined,
      default_price: f.default_price === "" ? undefined : Number(f.default_price),
      currency: f.currency || undefined,
      provider_kind: f.provider_kind || undefined,
      proof_source: f.proof_source || undefined,
      is_billable: f.is_billable,
      is_debours: f.direction === "DEBOURS" ? true : f.is_debours,
      requires_justification: f.requires_justification,
      receipt_requirement: f.receipt_requirement,
      debours_vat_transparent: f.debours_vat_transparent,
      posting_rules: rules.map((r) => ({
        applies_context: r.applies_context,
        debit_account: r.debit_account || undefined,
        credit_account: r.credit_account || undefined,
        tax_code_id: r.tax_code_id || undefined,
        is_debours: r.is_debours,
      })),
      service_tiers: scoped ? tiers.map((t) => ({ service_type_id: t.service_type_id, tier: t.tier })) : [],
    };
  }

  async function submit() {
    if (!basicValid) { setStep(1); return; }
    setBusy(true); setError(null);
    try {
      if (isNew) await api.createDict(payload());
      else await api.updateDict(row!.dictionary_item_id, payload());
      clearDraft();
      toast.success(isNew ? "Dictionary item created" : "Changes saved");
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  const serviceRows = services.data || [];
  const taxRows = taxCodes.data || [];
  const STEPS = ["Basics", "Details", "Review"];

  return (
    <Modal open onClose={() => { clearDraft(); onClose(); }} size="lg"
      title={isNew ? "New dictionary item" : `Edit ${row?.code}`}
      description="A priced line with its OHADA posting rules — the single source every quote, invoice and costing reads.">
      {/* Progress */}
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <button key={s} type="button" onClick={() => setStep(i + 1)}
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            <span className="grid h-4 w-4 place-items-center rounded-full border text-[10px]">{i + 1}</span>{s}
          </button>
        ))}
        <span className="ml-auto num text-xs text-muted-foreground">Code {isNew ? `#${codeLetter}•••` : row?.code}</span>
      </div>

      <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
        {step === 1 && (
          <>
            <Field label="Direction" hint="Sets the code letter and prefilters the account picker.">
              <Segmented label="Direction" value={f.direction} onChange={(v) => set({ direction: v })} options={DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name (FR)" required><Input value={f.label_fr} onChange={(e) => set({ label_fr: e.target.value })} placeholder="Frais portuaires (THC)" /></Field>
              <Field label="Name (EN)" required><Input value={f.label_en} onChange={(e) => set({ label_en: e.target.value })} placeholder="Port charges (THC)" /></Field>
              <Field label="Category" required>
                <Select value={f.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              </Field>
              <Field label="Sub-category">
                <Select value={f.subcategory} onChange={(e) => set({ subcategory: e.target.value })}>
                  <option value="">—</option>
                  {(subcats.data || []).map((r) => <option key={r.code} value={r.code}>{r.name_en || r.name_fr}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Applicability" hint="Where this line surfaces. Overhead/admin lines never appear in a service pick-list.">
              <Segmented label="Applicability" value={f.applicability_mode} onChange={(v) => set({ applicability_mode: v })} options={APPLIC} />
            </Field>
            {scoped && (
              <ServiceTiersEditor rows={tiers} setRows={setTiers} services={serviceRows} />
            )}

            {/* OHADA mapping — mandatory, so it lives in Basics. */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div><span className="text-sm font-semibold text-foreground">OHADA posting</span><p className="micro">Every item maps to accounts before it can be saved.</p></div>
                <Button type="button" size="sm" variant="outline" onClick={addRule}>+ Rule</Button>
              </div>
              <div className="space-y-3">
                {rules.map((r, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Segmented label="Context" value={r.applies_context} onChange={(v) => setRule(i, { applies_context: v as Ctx })} options={CONTEXTS.map((c) => ({ value: c, label: c }))} />
                      <Button type="button" size="sm" variant="ghost" disabled={rules.length === 1} onClick={() => delRule(i)}>✕</Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <AccountField label="Debit" value={r.debit_account} onChange={(v) => setRule(i, { debit_account: v })} preferredClass={preferClass(r.applies_context, "debit", f.direction)} />
                      <AccountField label="Credit" value={r.credit_account} onChange={(v) => setRule(i, { credit_account: v })} preferredClass={preferClass(r.applies_context, "credit", f.direction)} />
                      <Field label="Tax code" hint={r.is_debours ? "Débours lines carry no tax of ours." : undefined}>
                        <Select value={r.tax_code_id} disabled={r.is_debours} onChange={(e) => setRule(i, { tax_code_id: e.target.value })}>
                          <option value="">None</option>
                          {taxRows.map((t) => <option key={t.tax_code_id} value={t.tax_code_id}>{t.code}{t.rate_percent != null ? ` (${t.rate_percent}%)` : ""}</option>)}
                        </Select>
                      </Field>
                      <div className="flex items-end"><Checkbox checked={r.is_debours} onCheckedChange={(v) => setRule(i, { is_debours: !!v, tax_code_id: v ? "" : r.tax_code_id })} label={<span className="text-xs">Débours (pass-through)</span>} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Compliance controls — Basic per Q4. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Receipt requirement">
                <Select value={f.receipt_requirement} onChange={(e) => set({ receipt_requirement: e.target.value as api.ReceiptRequirement })}>
                  {RECEIPT.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}
                </Select>
              </Field>
              <div className="flex items-end gap-4">
                <Checkbox checked={f.requires_justification} onCheckedChange={(v) => set({ requires_justification: !!v })} label={<span className="text-sm">Justification required</span>} />
                <Checkbox checked={f.is_billable} onCheckedChange={(v) => set({ is_billable: !!v })} label={<span className="text-sm">Billable</span>} />
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Field label="Description"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="Optional notes / definition." /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unit of measure">
                <Select value={f.unit_of_measure} onChange={(e) => set({ unit_of_measure: e.target.value })}>
                  <option value="">—</option>
                  {(units.data || []).map((r) => <option key={r.code} value={r.code}>{r.name_en || r.name_fr}</option>)}
                </Select>
              </Field>
              <Field label="Default price"><Input type="number" min="0" step="0.01" className="num text-right" value={f.default_price} onChange={(e) => set({ default_price: e.target.value })} /></Field>
              <Field label="Currency"><Input value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
              <Field label="Provider kind" hint="For rate items — shipping line, customs, port authority.">
                <Select value={f.provider_kind} onChange={(e) => set({ provider_kind: e.target.value })}>
                  <option value="">—</option>
                  {(providers.data || []).map((r) => <option key={r.code} value={r.code}>{r.name_en || r.name_fr}</option>)}
                </Select>
              </Field>
              <Field label="Proof source">
                <Select value={f.proof_source} onChange={(e) => set({ proof_source: e.target.value })}>
                  <option value="">—</option>
                  {(proofSources.data || []).map((r) => <option key={r.code} value={r.code}>{r.name_en || r.name_fr}</option>)}
                </Select>
              </Field>
            </div>
            {(f.direction === "DEBOURS" || f.is_debours) && (
              <Checkbox checked={f.debours_vat_transparent} onCheckedChange={(v) => set({ debours_vat_transparent: !!v })}
                label={<span className="text-sm">Show the upstream supplier VAT to the client <span className="text-muted-foreground">(pass-through, not retained by us)</span></span>} />
            )}
          </>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <ReviewRow k="Code" v={isNew ? `#${codeLetter}••• (auto)` : row?.code} />
            <ReviewRow k="Name" v={`${f.label_fr}${f.label_en ? " · " + f.label_en : ""}`} />
            <ReviewRow k="Direction / category" v={<><Pill tone="blue">{f.direction}</Pill> <span className="text-muted-foreground">{f.category}{f.subcategory ? ` · ${f.subcategory}` : ""}</span></>} />
            <ReviewRow k="Applicability" v={f.applicability_mode.replace(/_/g, " ").toLowerCase() + (scoped ? ` · ${tiers.length} service tier(s)` : "")} />
            <ReviewRow k="Posting rules" v={<div className="space-y-0.5">{rules.map((r, i) => <div key={i} className="num text-xs">{r.applies_context}: {r.debit_account || "—"} → {r.credit_account || "—"}{r.is_debours ? " · débours" : ""}</div>)}</div>} />
            <ReviewRow k="Compliance" v={`${f.receipt_requirement.replace(/_/g, " ").toLowerCase()}${f.requires_justification ? " · justification" : ""}${f.is_billable ? " · billable" : ""}`} />
            {f.default_price ? <ReviewRow k="Default price" v={money(Number(f.default_price), f.currency)} /> : null}
            {!basicValid && <ErrorState message="Some required fields are missing — go back to Basics." />}
          </div>
        )}
        {error && <ErrorState message={error} />}
      </div>

      <div className="mt-4 flex items-center justify-between border-t pt-4">
        <div>{step > 1 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>← Back</Button>}</div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => { clearDraft(); onClose(); }}>Cancel</Button>
          {step < 3 && <Button type="button" variant="outline" onClick={() => setStep(step + 1)}>Next →</Button>}
          <Button type="button" loading={busy} disabled={!canSave} onClick={submit}>{isNew ? "Create item" : "Save changes"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewRow({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[140px_1fr] gap-2 border-b pb-2"><span className="text-muted-foreground">{k}</span><span className="text-foreground">{v}</span></div>;
}

function ServiceTiersEditor({ rows, setRows, services }: { rows: TierRow[]; setRows: React.Dispatch<React.SetStateAction<TierRow[]>>; services: ops.ServiceType[] }) {
  const add = () => {
    const used = new Set(rows.map((r) => r.service_type_id));
    const next = services.find((s) => !used.has(s.service_type_id));
    if (next) setRows((rs) => [...rs, { service_type_id: next.service_type_id, tier: "BASIC" }]);
  };
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div><span className="text-sm font-semibold text-foreground">Service types & tier</span><p className="micro">Basic ⊆ Advanced ⊆ Full — pick the lowest bundle each line belongs to.</p></div>
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={rows.length >= services.length}>+ Service</Button>
      </div>
      {rows.length === 0 ? <p className="micro">Add at least one service for a service-scoped item.</p> : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={r.service_type_id} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, service_type_id: e.target.value } : x)))} className="flex-1">
                {services.map((s) => <option key={s.service_type_id} value={s.service_type_id}>{s.name_en || s.name_fr}</option>)}
              </Select>
              <Segmented label="Tier" value={r.tier} onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, tier: v as api.Tier } : x)))} options={TIERS.map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
