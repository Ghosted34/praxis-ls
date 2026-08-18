/**
 * Settings — tax jurisdictions and their effective-dated tax codes (MOD-07).
 *
 * This is the single source of truth every posted invoice reads: the
 * account-determination engine (services/accounting/determination.js) looks up
 * the tax_code version effective at the entry date, so a missing or wrong rate
 * here stops invoices from posting. The design rule is that a rate is never
 * edited in place — a Finance-Law change is a NEW effective-dated version that
 * supersedes the old one, preserving prior-period history (migration 0210_tax).
 *
 * The screen is a master → detail "360": the jurisdiction list opens a dossier
 * with a tab per tax family (TVA / IS / retenues / paie / autre), each showing
 * the current effective rate plus its full version timeline, and the two writes
 * that make no-code amendment real:
 *   • Add code   — a new code key (POST /:id/codes)
 *   • Amend rate — atomic supersede (POST /:id/codes/supersede): expire the
 *                  current row the day before, open the new one, in one tx.
 *
 * Kinds are stored canonically (VAT/WHT/INCOME/PAYROLL/OTHER — the DB CHECK and
 * what determination reads) and shown with Cameroon labels; the specific
 * instrument (IS_MIN_REEL, PATENTE…) lives in the Code field, as the seed does.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { errMsg, useList, useRefresh, useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { loadPostableAccounts } from "@/lib/finance-api";
import type { Option } from "@/lib/finance-api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { SplitPane } from "@/components/ui/split-pane";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Callout } from "@/components/ui/callout";
import { Pill, type Tone } from "@/components/ui/pill";
import { num, dateFmt, todayISO } from "@/lib/format";
import {
  BracketsEditor,
  buildBrackets,
  parseBrackets,
  emptyBracketsState,
  type BracketsState,
} from "./tax-brackets-editor";

/* ─────────────────────────── kinds & helpers ─────────────────────────── */

const KINDS = ["VAT", "WHT", "INCOME", "PAYROLL", "OTHER"] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  VAT: "TVA (VAT)",
  WHT: "Retenue à la source",
  INCOME: "Impôt sociétés (IS)",
  PAYROLL: "Paie & social",
  OTHER: "Autre",
};
const KIND_HINT: Record<Kind, string> = {
  VAT: "Taxe sur la valeur ajoutée — collectée sur les ventes, récupérable sur les achats.",
  WHT: "Précompte / acompte / retenue à la source (SIT non-résident…).",
  INCOME: "Impôt sur les sociétés et minimum de perception.",
  PAYROLL: "CNPS, CFC, FNE, CAC, IRPP — retenues et charges sur salaires.",
  OTHER: "Patente, droit de timbre, taxe foncière et autres.",
};
const RATE_REQUIRED: ReadonlySet<Kind> = new Set(["VAT", "WHT", "INCOME"]);

type Code = Record<string, unknown>;
const iso = (d: unknown): string => (d == null ? "" : String(d).slice(0, 10));

/** The version effective today, else the most recent by effective_from. */
function currentVersion(versions: Code[]): Code | null {
  if (!versions.length) return null;
  const today = todayISO();
  const eff = versions.filter((v) => {
    const from = iso(v.effective_from);
    const to = iso(v.effective_to);
    return (!from || from <= today) && (!to || to >= today);
  });
  const pool = eff.length ? eff : versions;
  return (
    [...pool].sort((a, b) =>
      iso(a.effective_from) < iso(b.effective_from) ? 1 : -1,
    )[0] ?? null
  );
}

/** Group a flat code list into { code → versions[] (newest first) }. */
function groupByCode(codes: Code[]): Map<string, Code[]> {
  const m = new Map<string, Code[]>();
  for (const c of codes) {
    const k = String(c.code ?? "");
    const arr = m.get(k) ?? [];
    arr.push(c);
    m.set(k, arr);
  }
  for (const [, arr] of m)
    arr.sort((a, b) =>
      iso(a.effective_from) < iso(b.effective_from) ? 1 : -1,
    );
  return m;
}

/** Compact human summary of a code's rate/scale. */
function rateLabel(c: Code | null): string {
  if (!c) return "—";
  const parts: string[] = [];
  if (c.rate_percent != null) parts.push(`${num(c.rate_percent as number)}%`);
  const b = c.brackets as Record<string, unknown> | null;
  if (b && typeof b === "object") {
    if (Array.isArray(b.annual_brackets)) parts.push("barème");
    if (b.cap_xaf != null) parts.push(`cap ${num(b.cap_xaf as number)}`);
    if (b.risk_classes) parts.push("risk classes");
  }
  return parts.join(" · ") || "—";
}

/** Postable GL accounts, loaded only while a form is open. */
function usePostableAccounts(open: boolean): Option[] {
  const { data } = useResource(
    () => (open ? loadPostableAccounts() : Promise.resolve([] as Option[])),
    [open],
  );
  return data ?? [];
}

function AccountField({
  label,
  hint,
  value,
  onChange,
  accounts,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  accounts: Option[];
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tr("— none —")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* ─────────────────────────── new jurisdiction ─────────────────────────── */

function NewJurisdictionForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
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
      await tenant("/tax-jurisdictions", {
        method: "POST",
        body: {
          country_code: country.trim().toUpperCase(),
          name: name.trim(),
          currency: currency.trim().toUpperCase(),
        },
      });
      onCreated();
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
      title="New tax jurisdiction"
      description="A jurisdiction groups the effective-dated tax codes (TVA, WHT, IS…) that account determination reads."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tr("Country")} hint={tr("ISO code")} required>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="CM"
            />
          </Field>
          <Field label={tr("Name")} required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cameroun (CEMAC)"
            />
          </Field>
          <Field label={tr("Currency")}>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder={tr("XAF")}
            />
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

/* ─────────────────── add / amend a tax code (shared body) ─────────────── */

type CodeTarget = { code: string; kind: Kind; current: Code | null };

function CodeFormModal({
  jurisdictionId,
  mode,
  target,
  open,
  onClose,
  onDone,
}: {
  jurisdictionId: string;
  mode: "add" | "amend";
  target?: CodeTarget | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const accounts = usePostableAccounts(open);
  const [code, setCode] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("VAT");
  const [ratePercent, setRatePercent] = React.useState("");
  const [baseRule, setBaseRule] = React.useState("");
  const [appliesTo, setAppliesTo] = React.useState("");
  const [recoverable, setRecoverable] = React.useState(false);
  const [debit, setDebit] = React.useState("");
  const [credit, setCredit] = React.useState("");
  const [brackets, setBrackets] =
    React.useState<BracketsState>(emptyBracketsState());
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayISO());
  const [effectiveTo, setEffectiveTo] = React.useState("");
  const [legalRef, setLegalRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setEffectiveTo("");
    setBusy(false);
    if (mode === "amend" && target) {
      const c = target.current;
      setCode(target.code);
      setKind(target.kind);
      setRatePercent(c?.rate_percent != null ? String(c.rate_percent) : "");
      setBaseRule(c?.base_rule ? String(c.base_rule) : "");
      setAppliesTo(c?.applies_to ? String(c.applies_to) : "");
      setRecoverable(c?.recoverable === true);
      setDebit(c?.posts_debit_account ? String(c.posts_debit_account) : "");
      setCredit(c?.posts_credit_account ? String(c.posts_credit_account) : "");
      const b = parseBrackets(c?.brackets);
      setBrackets(b);
      setShowAdvanced(b.scaleOn || b.capOn || b.riskOn);
      setLegalRef(c?.legal_reference ? String(c.legal_reference) : "");
      setEffectiveFrom(todayISO());
    } else {
      setCode("");
      setKind("VAT");
      setRatePercent("");
      setBaseRule("");
      setAppliesTo("");
      setRecoverable(false);
      setDebit("");
      setCredit("");
      setBrackets(emptyBracketsState());
      setShowAdvanced(false);
      setLegalRef("");
      setEffectiveFrom(todayISO());
    }
  }, [open, mode, target]);

  const builtBrackets = buildBrackets(brackets);
  const hasRate = ratePercent !== "" && Number(ratePercent) >= 0;
  const rateSatisfied = !RATE_REQUIRED.has(kind) || hasRate || !!builtBrackets;
  const canSubmit = !!code.trim() && !!effectiveFrom && rateSatisfied && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(),
      kind,
      rate_percent: hasRate ? Number(ratePercent) : null,
      base_rule: baseRule.trim() || undefined,
      applies_to: appliesTo.trim() || undefined,
      recoverable,
      posts_debit_account: debit || undefined,
      posts_credit_account: credit || undefined,
      brackets: builtBrackets ?? undefined,
      effective_from: effectiveFrom,
      effective_to: effectiveTo || undefined,
      legal_reference: legalRef.trim() || undefined,
    };
    try {
      const path =
        mode === "amend"
          ? `/tax-jurisdictions/${jurisdictionId}/codes/supersede`
          : `/tax-jurisdictions/${jurisdictionId}/codes`;
      await tenant(path, { method: "POST", body });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "amend" ? `Amend rate — ${target?.code ?? ""}` : "Add tax code";
  const description =
    mode === "amend"
      ? "Enter the new values and the date they take effect. The current version is expired the day before and this one opens — history is preserved, never overwritten."
      : "An effective-dated rate card. Store the instrument in the Code (e.g. TVA_STD, IS_MIN_REEL); pick the family in Kind.";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Code")} required hint="Uppercase key, e.g. TVA_STD">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="TVA_STD"
              disabled={mode === "amend"}
            />
          </Field>
          <Field label={tr("Kind")} required hint={KIND_HINT[kind]}>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              disabled={mode === "amend"}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Rate %"
            hint={
              RATE_REQUIRED.has(kind)
                ? "Required unless a scale is set below"
                : "Optional for payroll/other"
            }
          >
            <Input
              type="number"
              min="0"
              step="0.0001"
              className="num text-right"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="19.25"
            />
          </Field>
          <Field
            label={tr("Applies to")}
            hint="sales · purchases · salary · nonresident"
          >
            <Input
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              placeholder="sales"
            />
          </Field>
          <Field label="Base rule" hint="service_ht · turnover · net_taxable…">
            <Input
              value={baseRule}
              onChange={(e) => setBaseRule(e.target.value)}
              placeholder="service_ht"
            />
          </Field>
          <Field label="Legal reference" hint="CGI article / Finance Law year">
            <Input
              value={legalRef}
              onChange={(e) => setLegalRef(e.target.value)}
              placeholder="CGI TVA / LF 2026"
            />
          </Field>
          <AccountField
            label="Posts — debit account"
            hint="COA code debited (e.g. input VAT 4452)"
            value={debit}
            onChange={setDebit}
            accounts={accounts}
          />
          <AccountField
            label="Posts — credit account"
            hint="COA code credited (e.g. output VAT 4432)"
            value={credit}
            onChange={setCredit}
            accounts={accounts}
          />
          <Field label={tr("Effective from")} required>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </Field>
          <Field label="Effective to" hint="Blank = open-ended">
            <Input
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={recoverable}
            onChange={(e) => setRecoverable(e.target.checked)}
          />
          Recoverable (input VAT credit)
        </label>

        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced
              ? "Hide scales & caps"
              : "Scales, caps & risk classes (IRPP / CNPS)"}
          </Button>
          {showAdvanced && (
            <div className="mt-2">
              <BracketsEditor state={brackets} onChange={setBrackets} />
            </div>
          )}
        </div>

        {!rateSatisfied && (
          <Callout
            tone="warn"
            title="A rate or a scale is required"
          >{`${KIND_LABEL[kind]} codes need a Rate % or a progressive scale.`}</Callout>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {mode === "amend" ? "Amend rate" : "Add code"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────── code group table (per kind) ──────────────────── */

function CodeGroupTable({
  groups,
  onAmend,
}: {
  groups: [string, Code[]][];
  onAmend: (t: CodeTarget) => void;
}) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  if (!groups.length)
    return (
      <EmptyState
        title="No codes in this family yet"
        hint="Add one to make it available to account determination."
      />
    );
  return (
    <Table>
      <THead>
        <TR>
          <TH>{tr("Code")}</TH>
          <TH>{tr("Current rate")}</TH>
          <TH>{tr("Applies to")}</TH>
          <TH>Effective</TH>
          <TH>Legal ref</TH>
          <TH>{tr("Actions")}</TH>
        </TR>
      </THead>
      <TBody>
        {groups.map(([key, versions]) => {
          const cur = currentVersion(versions);
          const kind = String(
            cur?.kind ?? versions[0]?.kind ?? "OTHER",
          ) as Kind;
          const isOpen = openKey === key;
          return (
            <React.Fragment key={key}>
              <TR>
                <TD className="text-sm font-medium num">{key}</TD>
                <TD className="text-sm">{rateLabel(cur)}</TD>
                <TD className="text-sm">
                  {cur?.applies_to ? String(cur.applies_to) : "—"}
                </TD>
                <TD className="text-sm">
                  {dateFmt(cur?.effective_from)} →{" "}
                  {cur?.effective_to ? dateFmt(cur.effective_to) : "open"}
                </TD>
                <TD className="text-sm text-muted-foreground">
                  {cur?.legal_reference ? String(cur.legal_reference) : "—"}
                </TD>
                <TD>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAmend({ code: key, kind, current: cur })}
                    >
                      Amend rate
                    </Button>
                    {versions.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenKey(isOpen ? null : key)}
                      >
                        {isOpen
                          ? "Hide history"
                          : `History (${versions.length})`}
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
              {isOpen && (
                <TR>
                  <TD colSpan={6}>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <span className="mb-2 block text-xs font-medium text-muted-foreground">
                        Version history
                      </span>
                      <ul className="space-y-1">
                        {versions.map((v, i) => (
                          <li
                            key={i}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <span className="num font-medium">
                              {rateLabel(v)}
                            </span>
                            <span className="text-muted-foreground">
                              {dateFmt(v.effective_from)} →{" "}
                              {v.effective_to
                                ? dateFmt(v.effective_to)
                                : "open"}
                            </span>
                            {v === cur && <Pill tone="ok">current</Pill>}
                            {v.legal_reference ? (
                              <span className="micro text-muted-foreground">
                                · {String(v.legal_reference)}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </TD>
                </TR>
              )}
            </React.Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}

/* ───────────────────────── jurisdiction 360 ───────────────────────────── */

const DOSSIER_TABS = ["Overview", ...KINDS] as const;
type DossierTab = (typeof DOSSIER_TABS)[number];
const tabLabel = (t: DossierTab) =>
  t === "Overview" ? "Overview" : KIND_LABEL[t as Kind];

function JurisdictionDossier({ id }: { id: string }) {
  const reloadList = useRefresh();
  const d = useResource<Record<string, unknown> & { tax_codes?: Code[] }>(
    () =>
      tenant<Record<string, unknown> & { tax_codes?: Code[] }>(
        `/tax-jurisdictions/${id}`,
      ),
    [id],
  );
  const [tab, setTab] = React.useState<DossierTab>("Overview");
  const [addOpen, setAddOpen] = React.useState(false);
  const [amendTarget, setAmendTarget] = React.useState<CodeTarget | null>(null);
  const [rowBusy, setRowBusy] = React.useState(false);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const refreshAll = () => {
    d.reload();
    reloadList();
  };

  async function setActive(active: boolean) {
    setRowBusy(true);
    setRowError(null);
    try {
      await tenant(`/tax-jurisdictions/${id}/active`, {
        method: "POST",
        body: { active },
      });
      refreshAll();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(false);
    }
  }

  if (d.loading) return <LoadingRow label="Loading jurisdiction…" />;
  if (d.error || !d.data)
    return <ErrorState message={d.error ?? "Jurisdiction not found."} />;

  const j = d.data;
  const codes = Array.isArray(j.tax_codes) ? j.tax_codes : [];
  const groups = groupByCode(codes);
  const groupsByKind = (k: Kind): [string, Code[]][] =>
    [...groups.entries()].filter(
      ([, vs]) => String(currentVersion(vs)?.kind ?? vs[0]?.kind) === k,
    );

  const active = j.is_active !== false;
  const currency = String(j.currency ?? "XAF");
  const countByKind = (k: Kind) => groupsByKind(k).length;
  const vatStd = currentVersion(
    groups.get("TVA_STD") ?? groupsByKind("VAT")[0]?.[1] ?? [],
  );
  const isStd = currentVersion(
    groups.get("IS_STD") ?? groupsByKind("INCOME")[0]?.[1] ?? [],
  );

  return (
    <div className="space-y-4">
      {/* Header card — same surface as the entity / party 360s. */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-foreground">
                {String(j.name ?? "")}
              </h3>
              <Pill tone={(active ? "ok" : "mute") as Tone}>
                {active ? "active" : "inactive"}
              </Pill>
              <Pill tone="mute">{String(j.country_code ?? "")}</Pill>
              <Pill tone="blue">{currency}</Pill>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Add code
            </Button>
            <Button
              size="sm"
              variant={active ? "outline" : "default"}
              loading={rowBusy}
              onClick={() => setActive(!active)}
            >
              {active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        </div>
      </div>

      {rowError && <ErrorState message={rowError} />}

      {codes.length === 0 && (
        <Callout tone="warn" title="No tax codes yet">
          This jurisdiction has no rate cards, so account determination has
          nothing to read and invoices in it cannot post. Add the standard codes
          (TVA_STD, IS_STD, the withholding and payroll codes) to get started.
        </Callout>
      )}

      <KpiRow>
        <KpiTile label="Tax codes" value={num(groups.size)} />
        <KpiTile
          label="TVA standard"
          value={
            vatStd?.rate_percent != null
              ? `${num(vatStd.rate_percent as number)}%`
              : "—"
          }
          tone="info"
        />
        <KpiTile
          label="IS"
          value={
            isStd?.rate_percent != null
              ? `${num(isStd.rate_percent as number)}%`
              : "—"
          }
          tone="info"
        />
        <KpiTile label="Retenues" value={num(countByKind("WHT"))} />
        <KpiTile label="Paie & social" value={num(countByKind("PAYROLL"))} />
      </KpiRow>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Tax families">
        {DOSSIER_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tabLabel(t)}
            {t !== "Overview" && countByKind(t as Kind) > 0 ? (
              <span className="ml-1 micro text-muted-foreground">
                ({countByKind(t as Kind)})
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {tab === "Overview" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The current effective rate for every code in this jurisdiction.
            Rates are versioned — to change one for a new Finance Law, open its
            family and use{" "}
            <span className="font-medium text-foreground">Amend rate</span>.
          </p>
          {groups.size === 0 ? (
            <EmptyState
              title="Nothing configured"
              hint="Add a tax code to begin."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{tr("Code")}</TH>
                  <TH>Family</TH>
                  <TH>{tr("Current rate")}</TH>
                  <TH>{tr("Applies to")}</TH>
                  <TH>{tr("Effective from")}</TH>
                </TR>
              </THead>
              <TBody>
                {[...groups.entries()].map(([key, versions]) => {
                  const cur = currentVersion(versions);
                  const k = String(
                    cur?.kind ?? versions[0]?.kind ?? "OTHER",
                  ) as Kind;
                  return (
                    <TR key={key}>
                      <TD className="num text-sm font-medium">{key}</TD>
                      <TD className="text-sm">{KIND_LABEL[k] ?? k}</TD>
                      <TD className="text-sm">{rateLabel(cur)}</TD>
                      <TD className="text-sm">
                        {cur?.applies_to ? String(cur.applies_to) : "—"}
                      </TD>
                      <TD className="text-sm">
                        {dateFmt(cur?.effective_from)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {KIND_HINT[tab as Kind]}
          </p>
          <CodeGroupTable
            groups={groupsByKind(tab as Kind)}
            onAmend={(t) => setAmendTarget(t)}
          />
        </div>
      )}

      <CodeFormModal
        jurisdictionId={id}
        mode="add"
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={refreshAll}
      />
      <CodeFormModal
        jurisdictionId={id}
        mode="amend"
        target={amendTarget}
        open={!!amendTarget}
        onClose={() => setAmendTarget(null)}
        onDone={refreshAll}
      />
    </div>
  );
}

/* ───────────────────────────── the page ───────────────────────────────── */

export function TaxJurisdictionsPage() {
  const reload = useRefresh();
  const { rows, error, loading } = useList("/tax-jurisdictions");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  const list = React.useMemo(() => rows ?? [], [rows]);
  const filtered = q
    ? list.filter((r) =>
        `${String(r.name ?? "")} ${String(r.country_code ?? "")}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      )
    : list;
  const selected =
    list.find((r) => String(r.jurisdiction_id) === selId) || null;
  React.useEffect(() => {
    if (!selId && list.length) setSelId(String(list[0].jurisdiction_id));
  }, [list, selId]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Tax rates & jurisdictions"
        description="Jurisdictions and their effective-dated tax codes (TVA/WHT/IS…) read by account determination."
        action={
          <Button onClick={() => setCreateOpen(true)}>New jurisdiction</Button>
        }
      />
      <HubTabs />

      {error ? (
        <ErrorState message={error} />
      ) : (
        <SplitPane
          storageKey="master.tax-jurisdictions"
          label="Jurisdiction list width"
          defaultSize={260}
          min={200}
          max={480}
        >
          <div className="space-y-2">
            <Input
              placeholder="Search jurisdiction…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {loading ? (
                <LoadingRow label="Loading jurisdictions…" />
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No jurisdictions.</div>
              ) : (
                filtered.map((r) => {
                  const id = String(r.jurisdiction_id);
                  const active = r.is_active !== false;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelId(id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {String(r.name ?? "")}
                        </span>
                        <span className="micro text-muted-foreground">
                          {String(r.country_code ?? "")} ·{" "}
                          {String(r.currency ?? "")}
                        </span>
                      </span>
                      <Pill tone={active ? "ok" : "mute"}>
                        {active ? "Active" : "Off"}
                      </Pill>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {selected ? (
            <JurisdictionDossier id={String(selected.jurisdiction_id)} />
          ) : (
            <EmptyState
              title="No jurisdiction selected"
              hint="Choose a jurisdiction from the list, or create one to start adding tax codes."
            />
          )}
        </SplitPane>
      )}

      <NewJurisdictionForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />
    </section>
  );
}
