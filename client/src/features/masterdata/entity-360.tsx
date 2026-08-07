/**
 * Corporate entity dossier (MOD-01).
 *
 * `EntityDossier` is the reusable body — header card, readiness, KPIs and the
 * tabbed collections. It renders inline in the master–detail list
 * (features/masterdata/corporate-entities.tsx), the same way the client and
 * supplier masters embed party-360.
 *
 * `EntityDossierPage` wraps it for the deep-link route
 * (/master/corporate-entities/:id): this object still has to be linkable on its
 * own — from a payroll run, an invoice footer, a compliance alert, a chat
 * message — which a modal could never be.
 *
 * One `/entities/:id/360` call feeds every tab, and the page renders for a
 * brand-new entity with nothing filled in — the readiness checklist is the
 * empty state, so "what do I do next" is answered rather than left blank.
 *
 * TREASURY IS READ-ONLY HERE, by design. Bank and cash accounts are
 * `treasury_account` rows owned by MOD-09; this tab lists them and deep-links to
 * the Treasury tab to add one. Two forms writing the same accounts is how an
 * invoice's payment block and the GL-mapped cash account drift apart.
 *
 * PEOPLE AND SHAREHOLDING are redacted server-side for a caller without the
 * MOD-01 update grant (`can_see_governance`), so this file never has to decide
 * what to hide — it renders what it was given and explains the gap.
 */
import * as React from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { SmartCountryPicker } from "@/components/smart-country-picker";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, enumLabel } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import { pageShell } from "@/lib/layout";
import { entityCommon } from "@shared";
import * as api from "@/lib/masterdata-api";

const LIFECYCLE_TONE: Record<string, Tone> = {
  DRAFT: "mute", PENDING_REVIEW: "blue", ACTIVE: "ok",
  SUSPENDED: "orange", DEACTIVATED: "mute", ARCHIVED: "mute",
};
const ROLE_TONE: Record<string, Tone> = {
  SHAREHOLDER: "blue", DIRECTOR: "ok", OFFICER: "ok", LEGAL_REPRESENTATIVE: "ok",
  AUTHORISED_SIGNATORY: "orange", BENEFICIAL_OWNER: "blue",
  STATUTORY_AUDITOR: "mute", SECRETARY: "mute",
};

const TABS = [
  "Overview", "Identity & registrations", "Documents", "Tax & jurisdiction",
  "People & shareholding", "Contacts & addresses", "Structure",
  "Banking & treasury", "Letterhead", "Renewals",
] as const;
type Tab = (typeof TABS)[number];

const RENEWAL_TONE: Record<string, Tone> = { EXPIRED: "bad", DUE: "orange", APPROACHING: "warn" };
const SCAN_TONE: Record<string, Tone> = {
  PENDING: "warn", SCANNED: "blue", VERIFIED: "ok", REJECTED: "bad", EXPIRED: "bad",
};

/* ── Small building blocks ─────────────────────────────────────────────────── */

function MiniTable({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty: boolean }) {
  if (empty) return <div className="px-3 py-6 text-center micro">Nothing here yet.</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground"><tr>{head}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>;

/** A labelled read-only value. `—` for anything blank, so gaps are visible. */
function Detail({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="space-y-0.5">
      <dt className="micro text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${empty ? "text-muted-foreground" : "text-foreground"}`}>{empty ? "—" : children}</dd>
    </div>
  );
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="micro text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type FieldSpec = {
  key: string; label: string;
  type?: "text" | "number" | "date" | "email" | "country" | "checkbox" | "select" | "textarea";
  options?: { value: string; label: string }[]; placeholder?: string; hint?: string;
};

/** Generic "add / edit a nested item" modal — one implementation for every collection. */
function ChildModal({ title, fields, initial, onClose, onSubmit }: {
  title: string; fields: FieldSpec[]; initial?: Record<string, unknown> | null;
  onClose: () => void; onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    if (!initial) return {};
    // Only carry the editable keys across — sending back server-owned fields
    // (verified, created_at, the pk) would be rejected by the write allow-list.
    const seed: Record<string, unknown> = {};
    for (const f of fields) if (initial[f.key] !== null && initial[f.key] !== undefined) seed[f.key] = initial[f.key];
    return seed;
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true); setError(null);
    try { await onSubmit(values); onClose(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={title} description="Blank fields are left unset.">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className={`space-y-1 text-sm ${f.type === "textarea" ? "sm:col-span-2" : ""} ${f.type === "checkbox" ? "flex items-center gap-2 space-y-0" : ""}`}>
            <span className="font-medium text-foreground">{f.label}</span>
            {f.type === "country" ? (
              <SmartCountryPicker value={(values[f.key] as string) || ""} onChange={(c) => set(f.key, c)} label={f.label} />
            ) : f.type === "checkbox" ? (
              <Checkbox checked={!!values[f.key]} onCheckedChange={(v) => set(f.key, v)} label={<span className="sr-only">{f.label}</span>} />
            ) : f.type === "select" ? (
              <Select value={(values[f.key] as string) || ""} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : f.type === "textarea" ? (
              <textarea
                className="min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                value={(values[f.key] as string) ?? ""} placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            ) : (
              <Input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                value={(values[f.key] as string) ?? ""} placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
            {f.hint && <span className="micro text-muted-foreground">{f.hint}</span>}
          </label>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorState message={error} /></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={save}>Save</Button>
      </div>
    </Modal>
  );
}

const opts = (xs: readonly string[]) => xs.map((v) => ({ value: v, label: enumLabel(v) }));

/* ── Field specs per collection ────────────────────────────────────────────── */

const PERSON_FIELDS: FieldSpec[] = [
  { key: "role", label: "Role", type: "select", options: opts(entityCommon.PERSON_ROLES) },
  { key: "holder_type", label: "Holder type", type: "select", options: opts(entityCommon.HOLDER_TYPES), hint: "A shareholder can be a company." },
  { key: "full_name", label: "Full name" },
  { key: "title", label: "Title", placeholder: "Directeur Général" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", placeholder: "+237690000000" },
  { key: "date_of_birth", label: "Date of birth", type: "date", hint: "Natural persons only." },
  { key: "nationality", label: "Nationality", type: "country" },
  { key: "id_type", label: "ID type", placeholder: "PASSPORT / CNI" },
  { key: "id_number", label: "ID number" },
  { key: "company_registration_number", label: "Company reg. number", hint: "Corporate holders only." },
  { key: "company_country", label: "Company country", type: "country" },
  { key: "share_class", label: "Share class", placeholder: "ORDINARY" },
  { key: "share_count", label: "Number of shares", type: "number" },
  { key: "share_nominal_value", label: "Nominal value per share", type: "number" },
  { key: "ownership_percent", label: "Ownership %", type: "number" },
  { key: "voting_percent", label: "Voting %", type: "number" },
  { key: "effective_from", label: "Held from", type: "date" },
  { key: "effective_to", label: "Held until", type: "date", hint: "Leave blank for a current holding." },
  { key: "is_pep", label: "Politically exposed", type: "checkbox" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const CONTACT_FIELDS: FieldSpec[] = [
  { key: "name", label: "Name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "is_primary", label: "Primary contact", type: "checkbox" },
];

const ADDRESS_FIELDS: FieldSpec[] = [
  { key: "type", label: "Type", type: "select", options: opts(entityCommon.ADDRESS_TYPES), hint: "REGISTERED is what the letterhead prints." },
  { key: "line1", label: "Address line 1" },
  { key: "line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "postal_code", label: "Postal code" },
  { key: "country_code", label: "Country", type: "country" },
  { key: "po_box", label: "PO box" },
  { key: "is_primary", label: "Primary", type: "checkbox" },
];

const REGISTRATION_FIELDS: FieldSpec[] = [
  { key: "country_code", label: "Country", type: "country" },
  { key: "kind", label: "Type", placeholder: "NIU / RCCM / VAT / EORI", hint: "Whatever the jurisdiction issues." },
  { key: "number", label: "Number" },
  { key: "issuing_authority", label: "Issuing authority" },
  { key: "issued_on", label: "Issued on", type: "date" },
  { key: "expires_on", label: "Expires on", type: "date" },
  { key: "is_primary", label: "Primary for this country", type: "checkbox" },
];

const TAX_REGISTRATION_FIELDS: FieldSpec[] = [
  { key: "country_code", label: "Country", type: "country", hint: "Where this registration was issued." },
  { key: "tax_kind", label: "Tax", type: "select", options: opts(["VAT", "INCOME", "WHT", "PAYROLL", "CUSTOMS", "LOCAL", "OTHER"]) },
  { key: "tax_number", label: "Tax number", placeholder: "FR12345678901" },
  { key: "regime", label: "Regime", placeholder: "RÉEL / NORMAL / SIMPLIFIÉ" },
  { key: "filing_frequency", label: "Filing frequency", type: "select", options: opts(["MONTHLY", "QUARTERLY", "BIMONTHLY", "ANNUAL", "ON_EVENT"]) },
  { key: "filing_due_day", label: "Filing due day", type: "number", hint: "Day of the month, 1–31." },
  { key: "currency", label: "Filing currency", placeholder: "XAF" },
  { key: "registered_on", label: "Registered on", type: "date" },
  { key: "deregistered_on", label: "Deregistered on", type: "date", hint: "Leave blank while it is live." },
  { key: "filing_portal_url", label: "Filing portal", placeholder: "https://…" },
  { key: "is_withholding_agent", label: "We withhold tax here", type: "checkbox" },
  { key: "reverse_charge_applies", label: "Reverse charge applies", type: "checkbox" },
  { key: "is_primary", label: "Primary for this country", type: "checkbox" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const ESTABLISHMENT_FIELDS: FieldSpec[] = [
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
  { key: "kind", label: "Kind", type: "select", options: opts(entityCommon.ESTABLISHMENT_KINDS) },
  { key: "country_code", label: "Country", type: "country" },
  { key: "city", label: "City" },
  { key: "address_line", label: "Address" },
  { key: "tax_office_ref", label: "Tax office reference", hint: "SIRET, centre des impôts…" },
  { key: "registration_ref", label: "Registration reference" },
  { key: "customs_office", label: "Customs office" },
  { key: "opened_on", label: "Opened on", type: "date" },
  { key: "closed_on", label: "Closed on", type: "date" },
];

/* ── The dossier ───────────────────────────────────────────────────────────── */

export function EntityDossier({ entityId, onEdit, onChanged }: {
  entityId: string;
  /** Opens the entity's edit form — owned by the host screen (the master–detail
   *  list, or the deep-link page), so there is one form reachable from both. */
  onEdit: () => void;
  /** Fired after any change here, so a host list can refresh its rows — a status
   *  change on the dossier is visible in the list beside it. */
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const d = useResource<api.Entity360>(() => api.entityDossier(entityId), [entityId]);
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [editing, setEditing] = React.useState<null | { seg: api.EntityCollection; title: string; fields: FieldSpec[]; row?: Record<string, unknown> | null }>(null);
  const [statusOpen, setStatusOpen] = React.useState(false);

  const reload = () => { d.reload(); onChanged?.(); };

  async function saveChild(seg: api.EntityCollection, values: Record<string, unknown>, childId?: string) {
    // Empty strings mean "not filled in", not "set to empty" — the API's shared
    // schemas normalise them away, and sending them would write blanks.
    const body = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined));
    if (childId) await api.updateEntityChild(entityId, seg, childId, body);
    else await api.addEntityChild(entityId, seg, body);
    toast.success("Saved.");
    reload();
  }

  async function removeChild(seg: api.EntityCollection, childId: string) {
    try {
      await api.deleteEntityChild(entityId, seg, childId);
      toast.success("Removed.");
      reload();
    } catch (e) { reportActionError(e); }
  }

  if (d.loading) return <LoadingRow label="Loading entity…" />;
  if (d.error || !d.data) {
    return <ErrorState message={d.error ? errMsg(d.error) : "Entity not found."} />;
  }

  const { entity: e, structure, people, contacts, addresses, registrations, establishments, cap_table: cap, usage, readiness, treasury_accounts: treasury, expiring_registrations: expiring, can_see_governance: gov } = d.data;
  const status = e.registration_status || (e.is_active ? "ACTIVE" : "DEACTIVATED");
  const currency = e.default_currency || "XAF";
  const shareholders = people.filter((p) => p.role === "SHAREHOLDER");
  const officers = people.filter((p) => p.role !== "SHAREHOLDER");

  return (
    <div className="space-y-4">
      {/* Header card — the client/supplier 360 surface (party-360.tsx), so the
          three masters read as one family. */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-foreground">{e.legal_name}</h3>
              <Pill tone={LIFECYCLE_TONE[status] || "mute"}>{enumLabel(status)}</Pill>
              {e.legal_form && <Pill tone="mute">{e.legal_form}</Pill>}
              {e.country_code && <Pill tone="mute">{e.country_code}</Pill>}
              {e.accounting_framework && <Pill tone="blue">{enumLabel(e.accounting_framework)}</Pill>}
              {structure.is_group_parent && <Pill tone="ok">Group parent</Pill>}
            </div>
            <p className="mt-1 micro">
              <span className="num font-medium text-foreground">{e.code}</span>
              {e.trading_name ? ` · ${e.trading_name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setStatusOpen(true)}>Change status</Button>
            <Button size="sm" onClick={onEdit}>Edit details</Button>
          </div>
        </div>
      </div>

      {/* The readiness checklist IS the empty state: a new entity opens here and
          is told what to fill in, rather than showing six blank tabs. */}
      {!readiness.ready && (
        <Callout tone="warn" title="Not yet complete for statutory documents">
          <p className="text-muted-foreground">
            These are missing before this entity can print a compliant letterhead. Nothing is blocked — you can trade and invoice meanwhile.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {readiness.missing.map((m) => <li key={m.field}><Pill tone="warn">{m.label}</Pill></li>)}
          </ul>
        </Callout>
      )}

      {expiring.length > 0 && (
        <Callout tone="bad" title="Registrations needing attention">
          <ul className="mt-1 space-y-1">
            {expiring.map((x) => (
              <li key={x.registration_id}>
                <Pill tone={x.expired ? "bad" : "orange"}>{x.expired ? "Expired" : "Expiring"}</Pill>{" "}
                {x.kind} {x.number ? <span className="num">{x.number}</span> : null} — {dateFmt(x.expires_on)}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <KpiRow>
        <KpiTile label="Shareholders" value={num(gov ? shareholders.length : cap.holder_count)} />
        <KpiTile label="Ownership recorded" value={`${num(cap.total_percent)}%`} hint={cap.balanced ? "Balanced" : "Check the cap table"} />
        <KpiTile label="Employees" value={num(usage.employees)} />
        <KpiTile label="Subsidiaries" value={num(usage.subsidiaries)} />
        <KpiTile label="Journal entries" value={num(usage.journal_entries)} />
      </KpiRow>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Entity sections">
        {TABS.map((t) => (
          <button
            key={t} type="button" onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="About" description="Shown on the entity picker and internal directories.">
            <p className="text-sm text-muted-foreground">{e.description || "No description yet."}</p>
            <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Detail label="Trading name">{e.trading_name}</Detail>
              <Detail label="Industry">{e.industry}</Detail>
              <Detail label="Website">{e.website}</Detail>
              <Detail label="Headcount">{e.headcount != null ? num(e.headcount) : null}</Detail>
              <Detail label="Email">{e.email}</Detail>
              <Detail label="Phone">{e.phone}</Detail>
            </dl>
          </Section>

          <Section title="Incorporation" description="The statutory facts printed on documents.">
            <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Detail label="Legal form">{e.legal_form}</Detail>
              <Detail label="Incorporated">{e.incorporation_date ? dateFmt(e.incorporation_date) : null}</Detail>
              <Detail label="Place">{e.incorporation_place}</Detail>
              <Detail label="Country">{e.incorporation_country}</Detail>
              <Detail label="Share capital">{e.share_capital != null ? money(e.share_capital, e.share_capital_currency || currency) : null}</Detail>
              <Detail label="Paid up">{e.share_capital_paid_up != null ? money(e.share_capital_paid_up, e.share_capital_currency || currency) : null}</Detail>
              {e.dissolution_date && <Detail label="Dissolved">{dateFmt(e.dissolution_date)}</Detail>}
            </dl>
          </Section>

          <Section
            title="Defaults carried into other modules"
            description="What HR, payroll and billing inherit when someone picks this entity."
          >
            <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Detail label="Accounting framework">{e.accounting_framework ? enumLabel(e.accounting_framework) : null}</Detail>
              <Detail label="Default currency">{e.default_currency}</Detail>
              <Detail label="Payroll country">{e.payroll_country}</Detail>
              <Detail label="Default language">{e.default_language === "fr" ? "Français" : e.default_language === "en" ? "English" : null}</Detail>
              <Detail label="Fiscal year starts">{e.fiscal_year_start_month ? new Date(2000, e.fiscal_year_start_month - 1, 1).toLocaleString("en", { month: "long" }) : null}</Detail>
              <Detail label="Document prefix">{e.doc_prefix}</Detail>
              <Detail label="Numbering resets">{e.numbering_reset ? enumLabel(e.numbering_reset) : null}</Detail>
              <Detail label="VAT registered">{e.vat_registered == null ? null : e.vat_registered ? "Yes" : "No"}</Detail>
            </dl>
          </Section>

          <Section title="Letterhead" description="What a document header would print today.">
            <div className="flex items-start gap-3">
              {e.logo_light_ref
                ? <img src={e.logo_light_ref} alt="" className="h-12 w-auto rounded border bg-background object-contain p-1" />
                : <div className="flex h-12 w-24 items-center justify-center rounded border border-dashed micro text-muted-foreground">No logo</div>}
              <div className="min-w-0 text-sm">
                <p className="font-medium text-foreground">{e.legal_name}{e.legal_form ? `, ${e.legal_form}` : ""}</p>
                {e.share_capital != null && <p className="text-muted-foreground">Capital {money(e.share_capital, e.share_capital_currency || currency)}</p>}
                <p className="text-muted-foreground">
                  {addresses.find((a) => a.type === "REGISTERED")
                    ? [addresses.find((a) => a.type === "REGISTERED")?.line1, addresses.find((a) => a.type === "REGISTERED")?.city].filter(Boolean).join(", ")
                    : e.address || "No registered address"}
                </p>
                <p className="num text-muted-foreground">
                  {registrations.filter((r) => r.number).slice(0, 4).map((r) => `${r.kind} ${r.number}`).join(" · ") || "No registrations"}
                </p>
              </div>
            </div>
            <p className="micro text-muted-foreground">
              The full letterhead and footer designer, with a live preview, arrives with the documents work.
            </p>
          </Section>
        </div>
      )}

      {tab === "Identity & registrations" && (
        <Section
          title="Registrations"
          description="Tax and trade identifiers, one row per country. This is what keeps a multi-country group compliant in each system."
          action={<Button size="sm" onClick={() => setEditing({ seg: "registrations", title: "Add registration", fields: REGISTRATION_FIELDS })}>Add registration</Button>}
        >
          <MiniTable
            empty={registrations.length === 0}
            head={<><Th>Country</Th><Th>Type</Th><Th>Number</Th><Th>Authority</Th><Th>Issued</Th><Th>Expires</Th><Th /></>}
          >
            {registrations.map((r) => (
              <tr key={r.registration_id}>
                <Td>{r.country_code || "—"}</Td>
                <Td><span className="font-medium text-foreground">{r.kind}</span>{r.is_primary ? <> <Pill tone="ok">Primary</Pill></> : null}</Td>
                <Td><span className="num">{r.number || "—"}</span></Td>
                <Td>{r.issuing_authority || "—"}</Td>
                <Td>{r.issued_on ? dateFmt(r.issued_on) : "—"}</Td>
                <Td>{r.expires_on ? dateFmt(r.expires_on) : "—"}</Td>
                <Td r>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "registrations", title: "Edit registration", fields: REGISTRATION_FIELDS, row: r as unknown as Record<string, unknown> })}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => removeChild("registrations", r.registration_id)}>Remove</Button>
                </Td>
              </tr>
            ))}
          </MiniTable>
        </Section>
      )}

      {tab === "Documents" && (
        <DocumentsTab
          entityId={entityId}
          documents={d.data.documents}
          onEdit={(row) => setEditing({ seg: "documents", title: row ? "Edit document" : "Add document", fields: [], row })}
          onRemove={(id) => removeChild("documents", id)}
          onSaved={reload}
        />
      )}

      {tab === "Tax & jurisdiction" && (
        <div className="space-y-4">
          <Section
            title="Tax registrations"
            description="One row per jurisdiction this entity is registered in. Rate cards stay in the Tax module and are shared across entities — what lives here is this entity's own number, regime and filing rhythm."
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate("/master/tax-jurisdictions")}>Open Tax module →</Button>
                <Button size="sm" onClick={() => setEditing({ seg: "tax-registrations", title: "Add tax registration", fields: TAX_REGISTRATION_FIELDS, row: { country_code: e.country_code, tax_kind: "VAT" } })}>Add registration</Button>
              </div>
            }
          >
            <MiniTable
              empty={d.data.tax_registrations.length === 0}
              head={<><Th>Country</Th><Th>Tax</Th><Th>Number</Th><Th>Regime</Th><Th>Filing</Th><Th>Status</Th><Th /></>}
            >
              {d.data.tax_registrations.map((t) => (
                <tr key={t.tax_registration_id}>
                  <Td>{t.country_code}{t.jurisdiction_name ? <span className="micro text-muted-foreground"> · {t.jurisdiction_name}</span> : null}</Td>
                  <Td>
                    <span className="font-medium text-foreground">{t.tax_kind}</span>
                    {t.is_withholding_agent ? <> <Pill tone="orange">WHT agent</Pill></> : null}
                    {t.reverse_charge_applies ? <> <Pill tone="blue">Reverse charge</Pill></> : null}
                  </Td>
                  <Td><span className="num">{t.tax_number || "—"}</span></Td>
                  <Td>{t.regime || "—"}</Td>
                  <Td>
                    {t.filing_frequency ? enumLabel(t.filing_frequency) : "—"}
                    {t.filing_due_day ? <span className="micro text-muted-foreground"> · day {t.filing_due_day}</span> : null}
                  </Td>
                  <Td>
                    {t.deregistered_on
                      ? <Pill tone="mute">Ended {dateFmt(t.deregistered_on)}</Pill>
                      : <Pill tone={t.is_active === false ? "mute" : "ok"}>{t.is_active === false ? "Inactive" : "Active"}</Pill>}
                  </Td>
                  <Td r>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "tax-registrations", title: "Edit tax registration", fields: TAX_REGISTRATION_FIELDS, row: t as unknown as Record<string, unknown> })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeChild("tax-registrations", t.tax_registration_id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
            {d.data.tax_registrations.length === 0 && (
              <Callout tone="info" title="No tax registrations yet">
                This is what lets one group stay compliant in several countries at once — a Cameroon entity filing TVA monthly and a France subsidiary filing under its own VAT number, each with its own number on its own invoices.
              </Callout>
            )}
          </Section>

          <Section
            title="Filing calendar"
            description="Upcoming statutory obligations for this entity, from the shared compliance calendar."
          >
            <MiniTable
              empty={d.data.tax_obligations.length === 0}
              head={<><Th>Obligation</Th><Th>Period</Th><Th>Due</Th><Th>Status</Th></>}
            >
              {d.data.tax_obligations.map((o) => (
                <tr key={o.tax_calendar_id}>
                  <Td><span className="font-medium text-foreground">{enumLabel(o.obligation)}</span>{o.country_code ? <span className="micro text-muted-foreground"> · {o.country_code}</span> : null}</Td>
                  <Td>{o.period_code || "—"}</Td>
                  <Td>{dateFmt(o.due_on)}</Td>
                  <Td><Pill tone={o.status === "DONE" ? "ok" : o.status === "LATE" ? "bad" : o.status === "PENDING" ? "warn" : "mute"}>{enumLabel(o.status)}</Pill></Td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </div>
      )}

      {tab === "Letterhead" && (
        <LetterheadTab entityId={entityId} onSaved={reload} />
      )}

      {tab === "Renewals" && (
        <Section
          title="Renewals"
          description={`Everything on this entity that has expired or is approaching expiry, as of ${dateFmt(d.data.renewals.as_of)}. Nothing here blocks anything — these are recommendations for a person to act on.`}
        >
          <KpiRow>
            <KpiTile label="Expired" value={num(d.data.renewals.counts.expired)} />
            <KpiTile label="Due now" value={num(d.data.renewals.counts.due)} />
            <KpiTile label="Approaching" value={num(d.data.renewals.counts.approaching)} />
          </KpiRow>
          <MiniTable
            empty={d.data.renewals.items.length === 0}
            head={<><Th>Item</Th><Th>Kind</Th><Th>Country</Th><Th>Expires</Th><Th r>Days</Th><Th>State</Th></>}
          >
            {d.data.renewals.items.map((i) => (
              <tr key={`${i.kind}-${i.id}`}>
                <Td><span className="font-medium text-foreground">{i.label}</span></Td>
                <Td>{enumLabel(i.kind)}</Td>
                <Td>{i.country_code || "—"}</Td>
                <Td>{dateFmt(i.expires_on)}</Td>
                <Td r>{i.days_remaining != null ? num(i.days_remaining) : "—"}</Td>
                <Td>
                  <Pill tone={RENEWAL_TONE[i.state] || "mute"}>{enumLabel(i.state)}</Pill>
                  {i.severity === "SOFT_BLOCK_RECOMMENDATION" && <> <Pill tone="bad">Act now</Pill></>}
                </Td>
              </tr>
            ))}
          </MiniTable>
          {d.data.renewals.items.length === 0 && (
            <EmptyState title="Nothing expiring" hint="Documents and registrations with an expiry date appear here as their deadline approaches." />
          )}
        </Section>
      )}

      {tab === "People & shareholding" && (
        <div className="space-y-4">
          {!gov && (
            <div className="rounded-lg border p-3">
              <p className="text-sm text-foreground">Ownership details are hidden</p>
              <p className="micro text-muted-foreground">
                Shareholdings, dates of birth and identity numbers need the entity-admin permission. Roles and names are shown because they are on the public trade register.
              </p>
            </div>
          )}

          <Section
            title="Shareholding"
            description={`Reconciled as of ${dateFmt(cap.as_of)}. Warnings never block saving — a partly-recorded cap table is normal during onboarding.`}
            action={<Button size="sm" onClick={() => setEditing({ seg: "people", title: "Add shareholder", fields: PERSON_FIELDS, row: { role: "SHAREHOLDER" } })}>Add shareholder</Button>}
          >
            {cap.findings.length > 0 && (
              <ul className="space-y-1">
                {cap.findings.map((f, i) => (
                  <li key={i} className="text-sm">
                    <Pill tone={f.severity === "WARN" ? "warn" : "mute"}>{enumLabel(f.code)}</Pill> <span className="text-muted-foreground">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <MiniTable
              empty={shareholders.length === 0}
              head={<><Th>Holder</Th><Th>Class</Th><Th r>Shares</Th><Th r>Ownership</Th><Th r>Voting</Th><Th>Held from</Th><Th /></>}
            >
              {shareholders.map((p) => (
                <tr key={p.person_id}>
                  <Td>
                    <span className="font-medium text-foreground">{p.full_name}</span>
                    {p.holder_type === "COMPANY" && <> <Pill tone="blue">Company</Pill></>}
                    {p.is_pep && <> <Pill tone="orange">PEP</Pill></>}
                    {p.holder_entity_code && <> <Pill tone="mute">{p.holder_entity_code}</Pill></>}
                  </Td>
                  <Td>{p.share_class || "—"}</Td>
                  <Td r>{p.share_count != null ? num(p.share_count) : "—"}</Td>
                  <Td r>{p.ownership_percent != null ? `${num(p.ownership_percent)}%` : "—"}</Td>
                  <Td r>{p.voting_percent != null ? `${num(p.voting_percent)}%` : "—"}</Td>
                  <Td>{p.effective_from ? dateFmt(p.effective_from) : "—"}</Td>
                  <Td r>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "people", title: "Edit shareholder", fields: PERSON_FIELDS, row: p as unknown as Record<string, unknown> })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeChild("people", p.person_id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
            {shareholders.length > 0 && (
              <p className="micro text-muted-foreground">
                {num(cap.total_shares)} shares recorded · {num(cap.total_percent)}% allocated
                {cap.issued_capital > 0 ? ` · issued capital ${money(cap.issued_capital, e.share_capital_currency || currency)}` : ""}
              </p>
            )}
          </Section>

          <Section
            title="Directors, officers and signatories"
            description="One person can hold several roles — add a row per role."
            action={<Button size="sm" onClick={() => setEditing({ seg: "people", title: "Add person", fields: PERSON_FIELDS, row: { role: "DIRECTOR" } })}>Add person</Button>}
          >
            <MiniTable
              empty={officers.length === 0}
              head={<><Th>Name</Th><Th>Role</Th><Th>Title</Th><Th>Appointed</Th><Th>Until</Th><Th /></>}
            >
              {officers.map((p) => (
                <tr key={p.person_id}>
                  <Td><span className="font-medium text-foreground">{p.full_name}</span></Td>
                  <Td><Pill tone={ROLE_TONE[p.role] || "mute"}>{enumLabel(p.role)}</Pill></Td>
                  <Td>{p.title || "—"}</Td>
                  <Td>{p.effective_from ? dateFmt(p.effective_from) : "—"}</Td>
                  <Td>{p.effective_to ? dateFmt(p.effective_to) : "—"}</Td>
                  <Td r>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "people", title: "Edit person", fields: PERSON_FIELDS, row: p as unknown as Record<string, unknown> })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeChild("people", p.person_id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </div>
      )}

      {tab === "Contacts & addresses" && (
        <div className="space-y-4">
          <Section
            title="Addresses"
            description="REGISTERED is the statutory office the letterhead prints — often not where people actually work."
            action={<Button size="sm" onClick={() => setEditing({ seg: "addresses", title: "Add address", fields: ADDRESS_FIELDS, row: { type: "REGISTERED" } })}>Add address</Button>}
          >
            <MiniTable empty={addresses.length === 0} head={<><Th>Type</Th><Th>Address</Th><Th>City</Th><Th>Country</Th><Th /></>}>
              {addresses.map((a) => (
                <tr key={a.address_id}>
                  <Td><Pill tone={a.type === "REGISTERED" ? "ok" : "mute"}>{enumLabel(a.type)}</Pill></Td>
                  <Td>{[a.line1, a.line2, a.po_box].filter(Boolean).join(", ") || "—"}</Td>
                  <Td>{[a.postal_code, a.city].filter(Boolean).join(" ") || "—"}</Td>
                  <Td>{a.country_code || "—"}</Td>
                  <Td r>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "addresses", title: "Edit address", fields: ADDRESS_FIELDS, row: a as unknown as Record<string, unknown> })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeChild("addresses", a.address_id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>

          <Section
            title="Contacts"
            description="Departmental contact points for this entity — the AP inbox, the legal contact on a tender."
            action={<Button size="sm" onClick={() => setEditing({ seg: "contacts", title: "Add contact", fields: CONTACT_FIELDS })}>Add contact</Button>}
          >
            <MiniTable empty={contacts.length === 0} head={<><Th>Name</Th><Th>Title</Th><Th>Email</Th><Th>Phone</Th><Th /></>}>
              {contacts.map((c) => (
                <tr key={c.contact_id}>
                  <Td><span className="font-medium text-foreground">{c.name}</span>{c.is_primary ? <> <Pill tone="ok">Primary</Pill></> : null}</Td>
                  <Td>{c.title || "—"}</Td>
                  <Td>{c.email || "—"}</Td>
                  <Td>{c.phone || "—"}</Td>
                  <Td r>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "contacts", title: "Edit contact", fields: CONTACT_FIELDS, row: c as unknown as Record<string, unknown> })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeChild("contacts", c.contact_id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </div>
      )}

      {tab === "Structure" && (
        <div className="space-y-4">
          <Section title="Position in the group" description="A subsidiary is its own entity with its own books — this records how it relates to the parent.">
            <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Detail label="Parent">
                {structure.ancestors.length
                  ? <Link className="underline" to={`/master/corporate-entities/${structure.ancestors[0].entity_id}`}>{structure.ancestors[0].code} — {structure.ancestors[0].legal_name}</Link>
                  : null}
              </Detail>
              <Detail label="Relationship">{structure.relationship_type ? enumLabel(structure.relationship_type) : null}</Detail>
              <Detail label="Owned">{structure.ownership_percent != null ? `${num(structure.ownership_percent)}%` : null}</Detail>
              <Detail label="Consolidates into parent">{structure.consolidates ? "Yes" : "No"}</Detail>
              <Detail label="Group parent">{structure.is_group_parent ? "Yes" : "No"}</Detail>
            </dl>
            {structure.ancestors.length > 1 && (
              <p className="micro text-muted-foreground">
                Chain: {structure.ancestors.map((a) => a.code).join(" → ")}
              </p>
            )}
          </Section>

          <Section title="Subsidiaries" description="Entities whose parent is this one.">
            <MiniTable empty={structure.children.length === 0} head={<><Th>Code</Th><Th>Legal name</Th><Th>Country</Th><Th>Relationship</Th><Th r>Owned</Th><Th>Framework</Th></>}>
              {structure.children.map((c) => (
                <tr key={c.entity_id}>
                  <Td><Link className="num font-medium underline" to={`/master/corporate-entities/${c.entity_id}`}>{c.code}</Link></Td>
                  <Td>{c.legal_name}</Td>
                  <Td>{c.country_code || "—"}</Td>
                  <Td>{c.relationship_type ? enumLabel(c.relationship_type) : "—"}</Td>
                  <Td r>{c.ownership_percent != null ? `${num(c.ownership_percent)}%` : "—"}</Td>
                  <Td>{c.accounting_framework ? enumLabel(c.accounting_framework) : "—"}</Td>
                </tr>
              ))}
            </MiniTable>
          </Section>

          <Section
            title="Establishments"
            description="Sites that are not separate legal persons — a warehouse or branch office with its own tax-office reference but no separate books."
            action={<Button size="sm" onClick={() => setEditing({ seg: "establishments", title: "Add establishment", fields: ESTABLISHMENT_FIELDS })}>Add establishment</Button>}
          >
            <MiniTable empty={establishments.length === 0} head={<><Th>Name</Th><Th>Kind</Th><Th>City</Th><Th>Country</Th><Th>Tax office</Th><Th /></>}>
              {establishments.map((s) => (
                <tr key={s.establishment_id}>
                  <Td><span className="font-medium text-foreground">{s.name}</span></Td>
                  <Td>{s.kind ? enumLabel(s.kind) : "—"}</Td>
                  <Td>{s.city || "—"}</Td>
                  <Td>{s.country_code || "—"}</Td>
                  <Td><span className="num">{s.tax_office_ref || "—"}</span></Td>
                  <Td r>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ seg: "establishments", title: "Edit establishment", fields: ESTABLISHMENT_FIELDS, row: s as unknown as Record<string, unknown> })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeChild("establishments", s.establishment_id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </div>
      )}

      {tab === "Banking & treasury" && (
        <Section
          title="Treasury accounts"
          description="Read-only here. Bank, cash and mobile-money accounts are owned by Treasury so the GL mapping and the invoice payment block can never disagree."
          action={<Button size="sm" variant="outline" onClick={() => navigate("/master/treasury-accounts")}>Open Treasury →</Button>}
        >
          <MiniTable empty={treasury.length === 0} head={<><Th>Label</Th><Th>Kind</Th><Th>GL account</Th><Th>Currency</Th><Th>Status</Th></>}>
            {treasury.map((t) => (
              <tr key={t.treasury_account_id}>
                <Td><span className="font-medium text-foreground">{t.label}</span></Td>
                <Td>{enumLabel(t.kind)}{t.momo_network ? ` · ${t.momo_network}` : ""}</Td>
                <Td><span className="num">{t.coa_code}</span></Td>
                <Td>{t.currency || "—"}</Td>
                <Td><Pill tone={t.is_active ? "ok" : "mute"}>{t.is_active ? "Active" : "Inactive"}</Pill></Td>
              </tr>
            ))}
          </MiniTable>
          {treasury.length === 0 && (
            <EmptyState
              title="No treasury accounts for this entity"
              hint="Add them in Treasury — they carry the GL mapping this entity's payments post to."
            />
          )}
        </Section>
      )}

      {editing && (
        <ChildModal
          title={editing.title}
          fields={editing.fields}
          initial={editing.row}
          onClose={() => setEditing(null)}
          onSubmit={(values) => {
            const pkBySeg: Record<api.EntityCollection, string> = {
              people: "person_id", contacts: "contact_id", addresses: "address_id",
              registrations: "registration_id", establishments: "establishment_id",
              documents: "document_id", "tax-registrations": "tax_registration_id",
            };
            const childId = editing.row ? (editing.row[pkBySeg[editing.seg]] as string | undefined) : undefined;
            return saveChild(editing.seg, values, childId);
          }}
        />
      )}

      {statusOpen && (
        <StatusModal
          entity={e}
          usage={usage}
          onClose={() => setStatusOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

/**
 * The deep-link route (`/master/corporate-entities/:id`). The dossier is now
 * reached inline from the master–detail list, but it must stay linkable on its
 * own — from a payroll run, an invoice footer, a compliance alert, a chat
 * message — so this thin page renders the same body against the URL's id.
 */
export function EntityDossierPage() {
  const { entityId = "" } = useParams();
  const navigate = useNavigate();
  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div className="micro">
        <Link to="/master/corporate-entities" className="text-muted-foreground hover:text-foreground">← Corporate entities</Link>
      </div>
      <EntityDossier entityId={entityId} onEdit={() => navigate(`/master/corporate-entities?edit=${entityId}`)} />
    </section>
  );
}

/**
 * Administrative documents.
 *
 * Its own component because the form's fields depend on the chosen document
 * TYPE — the registry says whether a type needs an expiry date and an issuing
 * authority — so the type list has to be loaded before the modal can be built.
 *
 * A document may be recorded paper-only: the digital scan is a VERIFICATION
 * gate, not a creation gate. Refusing to record a certificate you are holding in
 * your hand because it has not been scanned is how a register ends up incomplete.
 */
function DocumentsTab({ entityId, documents, onRemove, onSaved }: {
  entityId: string;
  documents: api.EntityDocument[];
  onEdit: (row: Record<string, unknown> | null) => void;
  onRemove: (id: string) => void;
  onSaved: () => void;
}) {
  const types = useResource(() => api.listDocumentTypes("ENTITY"), []);
  const [adding, setAdding] = React.useState<api.EntityDocument | "new" | null>(null);
  // `types.data || []` is a fresh array each render, so it cannot be a useMemo
  // dependency — the memo would rebuild the field list on every keystroke.
  const typeList = React.useMemo(() => types.data || [], [types.data]);

  const fields = React.useMemo<FieldSpec[]>(() => [
    { key: "document_type_id", label: "Document type", type: "select", options: typeList.map((t) => ({ value: t.document_type_id, label: t.name })) },
    { key: "title", label: "Title", placeholder: "Customs bond 2026" },
    { key: "document_number", label: "Reference number" },
    { key: "issuing_authority", label: "Issuing authority", placeholder: "Direction Générale des Douanes" },
    { key: "country_code", label: "Country", type: "country" },
    { key: "issued_on", label: "Issued on", type: "date" },
    { key: "expires_on", label: "Expires on", type: "date", hint: "Drives the renewals list." },
    { key: "renewal_lead_days", label: "Warn this many days ahead", type: "number", hint: "Blank uses the document type's own lead time." },
    { key: "physical_ref", label: "Paper original filed at", placeholder: "Box A-12", hint: "A document can be recorded before it is scanned." },
    { key: "scan_due_on", label: "Scan due by", type: "date" },
    { key: "notes", label: "Notes", type: "textarea" },
  ], [typeList]);

  async function save(values: Record<string, unknown>, id?: string) {
    const body = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined));
    if (id) await api.updateEntityChild(entityId, "documents", id, body);
    else await api.addEntityChild(entityId, "documents", body);
    onSaved();
  }

  return (
    <Section
      title="Administrative documents"
      description="Statutes, tax clearances, licences and insurance. Anything with an expiry date feeds the Renewals tab."
      action={<Button size="sm" onClick={() => setAdding("new")}>Add document</Button>}
    >
      {types.error && <ErrorState message={errMsg(types.error)} />}
      <MiniTable
        empty={documents.length === 0}
        head={<><Th>Document</Th><Th>Type</Th><Th>Number</Th><Th>Country</Th><Th>Expires</Th><Th>Scan</Th><Th /></>}
      >
        {documents.map((doc) => (
          <tr key={doc.document_id}>
            <Td><span className="font-medium text-foreground">{doc.title || doc.document_type_name || "Untitled"}</span></Td>
            <Td>{doc.document_type_name || "—"}</Td>
            <Td><span className="num">{doc.document_number || "—"}</span></Td>
            <Td>{doc.country_code || "—"}</Td>
            <Td>{doc.expires_on ? dateFmt(doc.expires_on) : "—"}</Td>
            <Td>
              <Pill tone={SCAN_TONE[doc.scan_status] || "mute"}>{enumLabel(doc.scan_status)}</Pill>
              {!doc.vault_id && doc.physical_ref ? <> <Pill tone="mute">Paper</Pill></> : null}
            </Td>
            <Td r>
              <Button size="sm" variant="ghost" onClick={() => setAdding(doc)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => onRemove(doc.document_id)}>Remove</Button>
            </Td>
          </tr>
        ))}
      </MiniTable>

      {documents.length === 0 && (
        <EmptyState
          title="No documents recorded"
          hint="Start with the certificate of incorporation and the statutes — the rest can follow as you gather them."
        />
      )}

      {adding && (
        <ChildModal
          title={adding === "new" ? "Add document" : "Edit document"}
          fields={fields}
          initial={adding === "new" ? null : (adding as unknown as Record<string, unknown>)}
          onClose={() => setAdding(null)}
          onSubmit={(values) => save(values, adding === "new" ? undefined : adding.document_id)}
        />
      )}
    </Section>
  );
}

/**
 * The letterhead and footer designer.
 *
 * The preview is not a mock-up: it renders `preview.fr` / `preview.en` straight
 * off the API, which come from the same pure function the invoice renderer
 * calls. Toggling a switch saves and re-renders, so what is on screen is what a
 * document prints — a hand-drawn preview would drift the first time the renderer
 * changed.
 *
 * `empty_blocks` is the part a picture alone would hide: a block switched on
 * with nothing behind it looks identical to one that is switched off.
 */
function LetterheadTab({ entityId, onSaved }: { entityId: string; onSaved: () => void }) {
  const toast = useToast();
  const lh = useResource<api.LetterheadBundle>(() => api.entityLetterhead(entityId), [entityId]);
  const [lang, setLang] = React.useState<"fr" | "en">("fr");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Local echo of the text areas so typing is not a round trip per keystroke.
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (!lh.data) return;
    const c = lh.data.config;
    setDraft({
      header_note_fr: c.header_note_fr ?? "", header_note_en: c.header_note_en ?? "",
      footer_note_fr: c.footer_note_fr ?? "", footer_note_en: c.footer_note_en ?? "",
      legal_mentions_fr: c.legal_mentions_fr ?? "", legal_mentions_en: c.legal_mentions_en ?? "",
      brand_color: c.brand_color ?? "",
    });
    setDirty(false);
  }, [lh.data]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      await api.saveEntityLetterhead(entityId, body);
      lh.reload(); onSaved();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  async function saveText() {
    // Empty string clears the field rather than leaving the old value — these are
    // nullable columns and the schema maps "" to undefined, so send null.
    const body = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
    await patch(body);
    toast.success("Letterhead saved.");
  }

  if (lh.loading) return <LoadingRow label="Loading letterhead…" />;
  if (lh.error || !lh.data) return <ErrorState message={lh.error ? errMsg(lh.error) : "Could not load the letterhead."} />;

  const { config: c, preview, treasury_accounts: accounts, remittance_account_id: remittance } = lh.data;
  const p = preview[lang];
  const toggles: { key: keyof api.LetterheadConfig; label: string; hint: string }[] = [
    { key: "show_legal_form", label: "Legal form", hint: "SARL, SAS, Ltd — mandatory in most of the EU." },
    { key: "show_share_capital", label: "Share capital", hint: "Mandatory on French invoices." },
    { key: "show_registered_address", label: "Registered address", hint: "The statutory office, not the trading one." },
    { key: "show_registrations", label: "Tax & trade identifiers", hint: "NIU, RCCM, VAT, EORI." },
    { key: "show_contact", label: "Phone, email, website", hint: "" },
    { key: "show_bank_block", label: "Payment block", hint: "Bank details on invoices." },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Section title="What appears" description="The content is taken from the entity's own record — you choose which blocks print. Mandatory mentions differ by country.">
          <div className="space-y-2">
            {toggles.map((t) => (
              <div key={String(t.key)} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{t.label}</p>
                  {t.hint && <p className="micro text-muted-foreground">{t.hint}</p>}
                </div>
                <Checkbox
                  checked={c[t.key] === true}
                  disabled={busy}
                  onCheckedChange={(v) => patch({ [t.key]: v === true })}
                  label={<span className="sr-only">{t.label}</span>}
                />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Wording" description="What cannot be derived — a strapline, payment terms, a jurisdiction clause. Per language, so a French document never falls back to English small print.">
          <div className="flex gap-1 border-b">
            {(["fr", "en"] as const).map((l) => (
              <button
                key={l} type="button" onClick={() => setLang(l)}
                aria-current={lang === l ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${lang === l ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {l === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
          {(["header_note", "footer_note", "legal_mentions"] as const).map((base) => {
            const key = `${base}_${lang}`;
            const label = base === "header_note" ? "Header note" : base === "footer_note" ? "Footer note" : "Legal mentions";
            return (
              <label key={key} className="block space-y-1 text-sm">
                <span className="font-medium text-foreground">{label}</span>
                <textarea
                  className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  value={draft[key] ?? ""}
                  placeholder={base === "legal_mentions" ? (lang === "fr" ? "Pénalités de retard : 3 fois le taux légal." : "Late payment interest at 3× the statutory rate.") : ""}
                  onChange={(ev) => { setDraft((s) => ({ ...s, [key]: ev.target.value })); setDirty(true); }}
                />
              </label>
            );
          })}
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-foreground">Brand colour</span>
            <Input
              value={draft.brand_color ?? ""}
              placeholder="#C2703D"
              onChange={(ev) => { setDraft((s) => ({ ...s, brand_color: ev.target.value })); setDirty(true); }}
            />
          </label>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end">
            <Button loading={busy} disabled={!dirty || busy} onClick={saveText}>Save wording</Button>
          </div>
        </Section>

        <Section title="Payment block" description="Which account leads the payment block on this entity's documents. Accounts themselves live in Treasury.">
          {p.payment_block.source === "bank_block_legacy" && (
            <Callout tone="warn" title="Still using the old bank block">
              These details come from the entity&apos;s legacy bank block, not a treasury account. Activate the migrated account in Treasury and flag it &ldquo;show on documents&rdquo; so the payment block and the ledger agree.
            </Callout>
          )}
          <Select
            value={remittance ?? ""}
            disabled={busy}
            onChange={(ev) => patch({ remittance_account_id: ev.target.value || null })}
          >
            <option value="">— first flagged account —</option>
            {accounts.map((a) => <option key={a.treasury_account_id} value={a.treasury_account_id}>{a.label} ({a.currency})</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={() => window.location.assign("/master/treasury-accounts")}>Manage accounts in Treasury →</Button>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Preview" description={`Exactly what a document prints in ${lang === "fr" ? "French" : "English"} — rendered by the same code the invoice generator uses.`}>
          <article className="space-y-3 rounded-lg border bg-background p-4" style={p.brand_color ? { borderTopColor: p.brand_color, borderTopWidth: 3 } : undefined}>
            <header className={`space-y-1 ${p.logo_position === "CENTER" ? "text-center" : p.logo_position === "RIGHT" ? "text-right" : ""}`}>
              {p.header.logo
                ? <img src={p.header.logo} alt="" className="inline-block h-10 w-auto object-contain" />
                : <div className="inline-flex h-10 items-center micro text-muted-foreground">No logo</div>}
              {p.header.company_line && <p className="text-sm font-semibold text-foreground">{p.header.company_line}</p>}
              {p.header.address_line && <p className="micro text-muted-foreground">{p.header.address_line}</p>}
              {p.header.contact_line && <p className="micro text-muted-foreground">{p.header.contact_line}</p>}
              {p.header.note && <p className="micro text-muted-foreground">{p.header.note}</p>}
            </header>

            <div className="rounded border border-dashed py-8 text-center micro text-muted-foreground">Document body</div>

            {p.payment_block.accounts.length > 0 && (
              <div className="space-y-0.5 border-t pt-2">
                <p className="micro font-medium text-foreground">{lang === "fr" ? "Coordonnées bancaires" : "Payment details"}</p>
                {p.payment_block.accounts.map((a, i) => (
                  <p key={i} className="micro num text-muted-foreground">
                    {[a.bank_name, a.branch, a.account_number, a.iban, a.swift_bic, a.currency].filter(Boolean).join(" · ")}
                  </p>
                ))}
              </div>
            )}

            <footer className="space-y-0.5 border-t pt-2 text-center">
              {p.footer.company_line && <p className="micro text-muted-foreground">{p.footer.company_line}</p>}
              {p.footer.address_line && <p className="micro text-muted-foreground">{p.footer.address_line}</p>}
              {p.footer.identifier_line && <p className="micro num text-muted-foreground">{p.footer.identifier_line}</p>}
              {p.footer.note && <p className="micro text-muted-foreground">{p.footer.note}</p>}
              {p.footer.legal_mentions && <p className="micro text-muted-foreground">{p.footer.legal_mentions}</p>}
            </footer>
          </article>
        </Section>

        {p.empty_blocks.length > 0 && (
          <Callout tone="warn" title="Switched on, but empty">
            <p className="text-muted-foreground">
              These blocks are enabled and would print nothing. Fill them in on the entity&apos;s other tabs, or switch them off.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {p.empty_blocks.map((b) => <li key={b}><Pill tone="warn">{enumLabel(b)}</Pill></li>)}
            </ul>
          </Callout>
        )}
      </div>
    </div>
  );
}

/**
 * Lifecycle change. The API owns the transition table — this offers every target
 * and lets a rejected move come back as a readable 409, rather than the client
 * keeping a second copy of the rules that can drift from the server's.
 */
function StatusModal({ entity, usage, onClose, onSaved }: {
  entity: api.Entity;
  usage: { subsidiaries: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const current = entity.registration_status || (entity.is_active ? "ACTIVE" : "DEACTIVATED");
  const [status, setStatus] = React.useState<api.EntityLifecycle>(current as api.EntityLifecycle);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const needsReason = ["SUSPENDED", "DEACTIVATED", "ARCHIVED"].includes(status);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.setEntityStatus(entity.entity_id, status, reason || undefined);
      toast.success("Status updated.");
      onSaved(); onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Change entity status" description={`Currently ${enumLabel(current)}.`}>
      <div className="space-y-3">
        <Field label="New status">
          <Select value={status} onChange={(ev) => setStatus(ev.target.value as api.EntityLifecycle)}>
            {entityCommon.LIFECYCLE_STATES.map((s) => (
              <option key={s} value={s}>{enumLabel(s)}</option>
            ))}
          </Select>
        </Field>
        {needsReason && (
          <Field label="Reason" required hint="Recorded on the audit trail.">
            <Input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Dormant since the 2026 restructuring" />
          </Field>
        )}
        {usage.subsidiaries > 0 && ["DEACTIVATED", "ARCHIVED"].includes(status) && (
          <Callout tone="warn">
            This entity is the parent of {usage.subsidiaries} other {usage.subsidiaries === 1 ? "entity" : "entities"}. Re-parent them first.
          </Callout>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={busy || status === current || (needsReason && !reason.trim())} onClick={save}>Update status</Button>
        </div>
      </div>
    </Modal>
  );
}
