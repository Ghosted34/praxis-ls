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
import { tr } from "@/lib/i18n";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useUrlTab, useFieldHighlight } from "@/lib/use-url-tab";
import { LetterheadStudio } from "./letterhead-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { DateField } from "@/components/ui/date-field";
import { FileDrop } from "@/components/ui/file-drop";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { SmartCountryPicker } from "@/components/smart-country-picker";
import { TimezonePicker } from "@/components/timezone-picker";
import { ScanAttachment } from "@/components/scan-attachment";
import {
  SCAN_ACCEPT,
  scanFileProblem,
  readFileAsDataUrl,
} from "@/lib/vault-file";
import { WorkingCalendarTab } from "./working-calendar-tab";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, num, dateDmy, enumLabel, toDateInput } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import { pageShell } from "@/lib/layout";
import { entityCommon } from "@shared";
import * as api from "@/lib/masterdata-api";

const LIFECYCLE_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  PENDING_REVIEW: "blue",
  ACTIVE: "ok",
  SUSPENDED: "orange",
  DEACTIVATED: "mute",
  ARCHIVED: "mute",
};
const ROLE_TONE: Record<string, Tone> = {
  SHAREHOLDER: "blue",
  DIRECTOR: "ok",
  OFFICER: "ok",
  LEGAL_REPRESENTATIVE: "ok",
  AUTHORISED_SIGNATORY: "orange",
  BENEFICIAL_OWNER: "blue",
  STATUTORY_AUDITOR: "mute",
  SECRETARY: "mute",
};

const TABS = [
  "Overview",
  "Identity & registrations",
  "Documents",
  "Tax & jurisdiction",
  "People & shareholding",
  "Contacts & addresses",
  "Structure",
  "Banking & treasury",
  "Letterhead",
  "Renewals",
  "Working calendar",
] as const;
type Tab = (typeof TABS)[number];

const RENEWAL_TONE: Record<string, Tone> = {
  EXPIRED: "bad",
  DUE: "orange",
  APPROACHING: "warn",
};
const SCAN_TONE: Record<string, Tone> = {
  PENDING: "warn",
  SCANNED: "blue",
  VERIFIED: "ok",
  REJECTED: "bad",
  EXPIRED: "bad",
};

/* ── Small building blocks ─────────────────────────────────────────────────── */

function MiniTable({
  head,
  children,
  empty,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
}) {
  if (empty)
    return <div className="px-3 py-6 text-center micro">{tr("Nothing here yet.")}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

/**
 * Was this holding or mandate live on `on` (an ISO date)?
 *
 * The same window `rules.reconcileCapTable` applies server-side, so the rows the
 * table dims are exactly the ones the totals leave out. Duplicated deliberately:
 * the API returns aggregates, not the filtered rows, and a table whose footer
 * disagrees with its body is worse than either alone.
 */
const heldOn = (
  p: { effective_from?: string | null; effective_to?: string | null },
  on: string,
) => {
  const from = p.effective_from ? String(p.effective_from).slice(0, 10) : null;
  const to = p.effective_to ? String(p.effective_to).slice(0, 10) : null;
  return !(from && from > on) && !(to && to < on);
};

/** A labelled read-only value. `—` for anything blank, so gaps are visible. */
function Detail({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="space-y-0.5">
      <dt className="micro text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm ${empty ? "text-muted-foreground" : "text-foreground"}`}
      >
        {empty ? "—" : children}
      </dd>
    </div>
  );
}

/**
 * `field` is the DEEP-LINK ANCHOR — the value `?field=` looks for.
 *
 * `useFieldHighlight` finds `[data-field="…"]`, scrolls it into view, focuses
 * the first control inside it and rings it briefly. Until now the dossier
 * carried none of these, so `?field=` was plumbing that landed the tab and then
 * silently did nothing — someone sent to fix a missing P.O. Box still had the
 * whole tab to search.
 *
 * The anchor sits on the SECTION rather than on the input because most of these
 * facts are edited in a modal opened from a row, and a field inside a modal
 * that has not been opened is not in the document to focus. Landing on the
 * section that owns the fact, with its "Add…" button focused, is the honest
 * best — and it is what the letterhead studio's block links point at, because
 * the block catalogue names the section, not a control that may not exist yet.
 */
function Section({
  title,
  description,
  action,
  field,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  field?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-field={field} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="micro text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type FieldSpec = {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "date"
    | "email"
    | "country"
    | "timezone"
    | "checkbox"
    | "select"
    | "textarea"
    | "multiselect"
    | "file";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** Server-owned values such as system-generated document references. */
  systemGenerated?: boolean;
  /**
   * Heading this field sits under. The person modal carries close to thirty
   * controls spanning identity, shareholding, signing authority and the links to
   * an employee or counterparty record — one undivided grid of thirty is a form
   * people abandon halfway.
   */
  group?: string;
  /**
   * Seed for a NEW row only. `is_active` uses it so the box reflects what the
   * column would actually default to; without it every add form offered an
   * unticked "Active" for a record that is created active.
   */
  defaultValue?: unknown;
};

/**
 * A checkbox list. `role_tags` is the only array column in these collections.
 *
 * A fieldset with a visible legend rather than a labelled control: the group has
 * a name and each box has its own, which is what a screen reader needs to say
 * "Departments, Billing, checked" instead of reading ten unrelated checkboxes.
 */
function MultiSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <fieldset className="rounded-lg border p-2">
      <legend className="px-1 text-sm font-medium text-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => (
          <Checkbox
            key={o.value}
            checked={value.includes(o.value)}
            onCheckedChange={() => toggle(o.value)}
            label={<span className="text-sm">{o.label}</span>}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Generic "add / edit a nested item" modal — one implementation for every collection. */
function ChildModal({
  title,
  fields,
  initial,
  onClose,
  onSubmit,
  uploadProgress = null,
  uploadSuccess = false,
  allowAddAnother = false,
}: {
  title: string;
  fields: FieldSpec[];
  initial?: Record<string, unknown> | null;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  uploadProgress?: number | null;
  uploadSuccess?: boolean;
  allowAddAnother?: boolean;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of fields) {
      // Only carry the editable keys across — sending back server-owned fields
      // (verified, created_at, the pk) would be rejected by the write allow-list.
      if (initial && initial[f.key] !== null && initial[f.key] !== undefined) {
        /*
         * A date control renders ONLY `YYYY-MM-DD`. Seeded with anything else it
         * shows an empty box while this state still holds the original value, so
         * "Edit registration" opened with blank Issued on / Expires on for dates
         * that were saved, and Save posted the unrenderable value straight back —
         * `issued_on: Use the format YYYY-MM-DD., That date doesn't exist.` on a
         * row nobody had touched. Normalising at the seed keeps what the control
         * shows and what Save sends the same thing.
         */
        seed[f.key] =
          f.type === "date" ? toDateInput(initial[f.key]) : initial[f.key];
      } else if (!initial && f.systemGenerated) {
        seed[f.key] = "Assigned on save";
      } else if (!initial && f.defaultValue !== undefined)
        seed[f.key] = f.defaultValue;
    }
    return seed;
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  // A picked scan is validated here and parked in `values` as a File; the
  // collection's own onSubmit is what uploads it and links it to the record.
  function pickFile(key: string, f: File | null) {
    setFileError(null);
    if (!f) {
      set(key, null);
      return;
    }
    const problem = scanFileProblem(f);
    if (problem) {
      setFileError(problem);
      return;
    }
    set(key, f);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const keepOpen = allowAddAnother && submitter?.value === "add-another";
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      if (keepOpen) {
        const next: Record<string, unknown> = {};
        for (const f of fields) {
          if (f.systemGenerated) next[f.key] = "Assigned on save";
          else if (f.defaultValue !== undefined) next[f.key] = f.defaultValue;
        }
        setValues(next);
        setFileError(null);
        setError(null);
        return;
      }
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Fields keep their declared order; the headings are inserted where a group
  // first appears, so a spec stays a flat list and reads top to bottom.
  const seenGroups = new Set<string>();

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const heading =
              f.group && !seenGroups.has(f.group) ? f.group : null;
            if (heading) seenGroups.add(f.group as string);
            const wide =
              f.type === "textarea" ||
              f.type === "multiselect" ||
              f.type === "file";
            const cls = `space-y-1 text-sm ${wide ? "sm:col-span-2" : ""} ${f.type === "checkbox" ? "flex items-center gap-2 space-y-0" : ""}`;

            // File pickers bring their own label and span the width; render one
            // before the generic <label> branch, like checkbox / multiselect.
            if (f.type === "file") {
              return (
                <React.Fragment key={f.key}>
                  {heading && (
                    <h4 className="mt-1 border-b pb-1 text-sm font-semibold text-foreground sm:col-span-2">
                      {heading}
                    </h4>
                  )}
                  <div className="sm:col-span-2">
                    <FileDrop
                      label={f.label}
                      file={(values[f.key] as File | null) ?? null}
                      onPick={(file) => pickFile(f.key, file)}
                      accept={SCAN_ACCEPT}
                      disabled={busy}
                      error={fileError}
                      uploadProgress={
                        values[f.key] instanceof File ? uploadProgress : null
                      }
                      uploadSuccess={
                        uploadSuccess && values[f.key] instanceof File
                      }
                      hint={f.hint}
                    />
                  </div>
                </React.Fragment>
              );
            }

            /*
             * Checkboxes and multiselects bring their OWN labels, so neither may
             * sit inside this grid's generic `<label>`.
             *
             * `Checkbox` renders a `<label htmlFor>` internally. Nesting that in
             * another label is invalid, and the accessible name computed from the
             * pair is not the field's: `getByRole("checkbox", { name: "Active" })`
             * could not find the control at all. It went unnoticed because the axe
             * register never opens a modal and the only checkboxes here used to be
             * two optional flags. `MultiSelect` is the same fault with a
             * `<fieldset>`, where the outer label would additionally have toggled
             * whichever box happened to be first.
             */
            if (f.type === "checkbox" || f.type === "multiselect") {
              return (
                <React.Fragment key={f.key}>
                  {heading && (
                    <h4 className="mt-1 border-b pb-1 text-sm font-semibold text-foreground sm:col-span-2">
                      {heading}
                    </h4>
                  )}
                  <div className={cls}>
                    {f.type === "checkbox" ? (
                      <Checkbox
                        checked={!!values[f.key]}
                        onCheckedChange={(v) => set(f.key, v)}
                        label={f.label}
                        hint={f.hint}
                      />
                    ) : (
                      <>
                        <MultiSelect
                          label={f.label}
                          value={
                            Array.isArray(values[f.key])
                              ? (values[f.key] as string[])
                              : []
                          }
                          options={f.options || []}
                          onChange={(next) => set(f.key, next)}
                        />
                        {f.hint && (
                          <span className="micro text-muted-foreground">
                            {f.hint}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </React.Fragment>
              );
            }

            return (
              <React.Fragment key={f.key}>
                {heading && (
                  <h4 className="mt-1 border-b pb-1 text-sm font-semibold text-foreground sm:col-span-2">
                    {heading}
                  </h4>
                )}
                <label className={cls}>
                  <span className="font-medium text-foreground">{f.label}</span>
                  {f.type === "country" ? (
                    <SmartCountryPicker
                      value={(values[f.key] as string) || ""}
                      onChange={(c) => set(f.key, c)}
                      label={f.label}
                    />
                  ) : f.type === "timezone" ? (
                    <TimezonePicker
                      value={(values[f.key] as string) || ""}
                      onChange={(timezone) => set(f.key, timezone)}
                      label={f.label}
                    />
                  ) : f.type === "select" ? (
                    <Select
                      value={(values[f.key] as string) || ""}
                      onChange={(e) => set(f.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {(f.options || []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === "textarea" ? (
                    <textarea
                      className="min-h-20 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      value={(values[f.key] as string) ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  ) : f.type === "date" ? (
                    <DateField
                      value={(values[f.key] as string) || ""}
                      placeholder={f.placeholder}
                      onChange={(iso) => set(f.key, iso)}
                    />
                  ) : (
                    <Input
                      type={
                        f.type === "number"
                          ? "number"
                          : f.type === "email"
                            ? "email"
                            : "text"
                      }
                      value={(values[f.key] as string) ?? ""}
                      placeholder={f.placeholder}
                      readOnly={f.systemGenerated}
                      className={
                        f.systemGenerated
                          ? "bg-muted text-muted-foreground"
                          : undefined
                      }
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                  {f.hint && (
                    <span className="micro text-muted-foreground">
                      {f.hint}
                    </span>
                  )}
                </label>
              </React.Fragment>
            );
          })}
        </div>
        {error && (
          <div className="mt-3">
            <ErrorState message={error} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {allowAddAnother && (
            <Button
              type="submit"
              variant="ghost"
              name="submitIntent"
              value="add-another"
              disabled={busy}
            >
              Save & add another
            </Button>
          )}
          <div className="ml-auto flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

const opts = (xs: readonly string[]) =>
  xs.map((v) => ({ value: v, label: enumLabel(v) }));

/* ── Field specs per collection ────────────────────────────────────────────── */

/**
 * The rows a nested form needs to offer a real choice.
 *
 * Every one of these backs a foreign key the shared schema accepts and the
 * dossier already RENDERS, but that no control could set. The tax-registration
 * table printed `jurisdiction_name` from a `jurisdiction_id` nothing could
 * write; the cap table printed a `holder_entity_code` pill for an
 * entity-owns-entity holding that could not be recorded — in a module whose
 * whole point is group structure. A uuid text box would technically close the
 * gap and would never be used, so these are pickers.
 */
type Lookups = {
  entities: { entity_id: string; code: string; legal_name: string }[];
  employees: { employee_id: string; full_name?: string | null }[];
  users: {
    user_id: string;
    full_name?: string | null;
    email?: string | null;
  }[];
  jurisdictions: api.TaxJurisdiction[];
  clients: { client_id: string; name: string }[];
  suppliers: { supplier_id: string; name: string }[];
  establishments: api.EntityEstablishment[];
};

const EMPTY_LOOKUPS: Lookups = {
  entities: [],
  employees: [],
  users: [],
  jurisdictions: [],
  clients: [],
  suppliers: [],
  establishments: [],
};

const nameOpts = <T,>(
  rows: T[],
  id: (r: T) => string,
  label: (r: T) => string,
) => rows.map((r) => ({ value: id(r), label: label(r) }));

/**
 * People: shareholders, directors, officers, signatories, UBOs.
 *
 * Grouped, because it is the largest form in the module and the groups are real
 * distinctions — a director has no shareholding, a corporate holder has no date
 * of birth. The API refuses the contradictory combinations either way
 * (`withPersonRules`); the grouping is so a person does not have to discover
 * that by being rejected.
 */
const personFields = (lk: Lookups): FieldSpec[] => [
  {
    key: "role",
    label: "Role",
    type: "select",
    options: opts(entityCommon.PERSON_ROLES),
    group: "Who",
  },
  {
    key: "holder_type",
    label: "Holder type",
    type: "select",
    options: opts(entityCommon.HOLDER_TYPES),
    hint: "A shareholder can be a company.",
  },
  { key: "full_name", label: "Full name" },
  { key: "title", label: "Title", placeholder: "Directeur Général" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", placeholder: "+237690000000" },

  {
    key: "date_of_birth",
    label: "Date of birth",
    type: "date",
    hint: "Natural persons only.",
    group: "Identity (AML/KYC)",
  },
  { key: "nationality", label: "Nationality", type: "country" },
  {
    key: "country_of_residence",
    label: "Country of residence",
    type: "country",
    hint: "Drives which sanctions and tax-residency checks apply.",
  },
  { key: "id_type", label: "ID type", placeholder: "PASSPORT / CNI" },
  { key: "id_number", label: "ID number" },
  { key: "is_pep", label: "Politically exposed", type: "checkbox" },

  {
    key: "company_registration_number",
    label: "Company reg. number",
    hint: "Corporate holders only.",
    group: "Corporate holder",
  },
  { key: "company_country", label: "Company country", type: "country" },
  {
    key: "holder_entity_id",
    label: "Held by one of our entities",
    type: "select",
    options: nameOpts(
      lk.entities,
      (e) => e.entity_id,
      (e) => `${e.code} — ${e.legal_name}`,
    ),
    hint: "For an intra-group holding. The cap table shows this as a code beside the holder.",
  },

  {
    key: "share_class",
    label: "Share class",
    placeholder: "ORDINARY",
    group: "Shareholding",
  },
  { key: "share_count", label: "Number of shares", type: "number" },
  {
    key: "share_nominal_value",
    label: "Nominal value per share",
    type: "number",
  },
  { key: "ownership_percent", label: "Ownership %", type: "number" },
  {
    key: "voting_percent",
    label: "Voting %",
    type: "number",
    hint: "Differs from ownership where a class carries extra votes.",
  },

  {
    key: "signature_limit_amount",
    label: "Signature limit",
    type: "number",
    hint: "The most this person may commit alone.",
    group: "Authority and term",
  },
  {
    key: "signature_limit_currency",
    label: "Limit currency",
    placeholder: "XAF",
  },
  { key: "effective_from", label: "Held / appointed from", type: "date" },
  {
    key: "effective_to",
    label: "Until",
    type: "date",
    hint: "Leave blank for a current holding or mandate.",
  },

  {
    key: "employee_id",
    label: "Is also an employee",
    type: "select",
    options: nameOpts(
      lk.employees,
      (e) => e.employee_id,
      (e) => e.full_name || e.employee_id,
    ),
    group: "Also on file as",
  },
  {
    key: "client_id",
    label: "Is also a client",
    type: "select",
    options: nameOpts(
      lk.clients,
      (c) => c.client_id,
      (c) => c.name,
    ),
    hint: "A director who is also a counterparty — a related-party disclosure.",
  },
  {
    key: "supplier_id",
    label: "Is also a supplier",
    type: "select",
    options: nameOpts(
      lk.suppliers,
      (s) => s.supplier_id,
      (s) => s.name,
    ),
  },
  {
    key: "is_primary_contact",
    label: "Primary contact for the entity",
    type: "checkbox",
  },
  {
    key: "is_active",
    label: "Active",
    type: "checkbox",
    defaultValue: true,
    hint: "Clear this to retire a mandate without deleting its history.",
  },
  { key: "notes", label: "Notes", type: "textarea" },
];

const contactFields = (): FieldSpec[] => [
  { key: "name", label: "Name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  {
    key: "role_tags",
    label: "Departments",
    type: "multiselect",
    options: opts(entityCommon.CONTACT_ROLE_TAGS),
    hint: 'What this contact is for. Nothing else made this section\'s "departmental contact points" real.',
  },
  {
    key: "language",
    label: "Language",
    placeholder: "fr",
    hint: "Two-letter code — what to write to them in.",
  },
  {
    key: "timezone",
    label: "Timezone",
    type: "timezone",
    hint: "So a call is not scheduled at 3 a.m. their time.",
  },
  { key: "is_primary", label: "Primary contact", type: "checkbox" },
  { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
];

const addressFields = (): FieldSpec[] => [
  {
    key: "type",
    label: "Type",
    type: "select",
    options: opts(entityCommon.ADDRESS_TYPES),
    hint: "REGISTERED is what the letterhead prints.",
  },
  { key: "line1", label: "Address line 1" },
  { key: "line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "postal_code", label: "Postal code" },
  { key: "country_code", label: "Country", type: "country" },
  { key: "po_box", label: "PO box" },
  { key: "is_primary", label: "Primary", type: "checkbox" },
  {
    key: "is_active",
    label: "Active",
    type: "checkbox",
    defaultValue: true,
    hint: "An old office stays on file rather than being deleted.",
  },
];

const registrationFields = (): FieldSpec[] => [
  { key: "country_code", label: "Country", type: "country" },
  {
    key: "kind",
    label: "Type",
    placeholder: "NIU / RCCM / VAT / EORI",
    hint: "Whatever the jurisdiction issues.",
  },
  { key: "number", label: "Number" },
  { key: "issuing_authority", label: "Issuing authority" },
  { key: "issued_on", label: "Issued on", type: "date" },
  { key: "expires_on", label: "Expires on", type: "date" },
  { key: "is_primary", label: "Primary for this country", type: "checkbox" },
  {
    key: "notes",
    label: "Notes",
    type: "textarea",
    hint: "Where the original is filed, what the renewal needs.",
  },
];

const taxRegistrationFields = (lk: Lookups): FieldSpec[] => [
  {
    key: "country_code",
    label: "Country",
    type: "country",
    hint: "Where this registration was issued.",
  },
  {
    key: "jurisdiction_id",
    label: "Tax jurisdiction",
    type: "select",
    options: nameOpts(
      lk.jurisdictions,
      (j) => j.jurisdiction_id,
      (j) => `${j.name}${j.country_code ? ` (${j.country_code})` : ""}`,
    ),
    hint: "Links this registration to its rate card. The table's jurisdiction column reads from it.",
  },
  {
    key: "tax_kind",
    label: "Tax",
    type: "select",
    options: opts([
      "VAT",
      "INCOME",
      "WHT",
      "PAYROLL",
      "CUSTOMS",
      "LOCAL",
      "OTHER",
    ]),
  },
  { key: "tax_number", label: "Tax number", placeholder: "FR12345678901" },
  { key: "regime", label: "Regime", placeholder: "RÉEL / NORMAL / SIMPLIFIÉ" },
  {
    key: "filing_frequency",
    label: "Filing frequency",
    type: "select",
    options: opts(["MONTHLY", "QUARTERLY", "BIMONTHLY", "ANNUAL", "ON_EVENT"]),
  },
  {
    key: "filing_due_day",
    label: "Filing due day",
    type: "number",
    hint: "Day of the month, 1–31. Needs a frequency to attach to.",
  },
  { key: "currency", label: "Filing currency", placeholder: "XAF" },
  { key: "registered_on", label: "Registered on", type: "date" },
  {
    key: "deregistered_on",
    label: "Deregistered on",
    type: "date",
    hint: "Leave blank while it is live.",
  },
  {
    key: "filing_portal_url",
    label: "Filing portal",
    placeholder: "https://…",
  },
  {
    key: "responsible_user_id",
    label: "Responsible",
    type: "select",
    options: nameOpts(
      lk.users,
      (u) => u.user_id,
      (u) => u.full_name || u.email || u.user_id,
    ),
    hint: "Who chases this filing. Without a name, a missed deadline belongs to nobody.",
  },
  {
    key: "is_withholding_agent",
    label: "We withhold tax here",
    type: "checkbox",
  },
  {
    key: "reverse_charge_applies",
    label: "Reverse charge applies",
    type: "checkbox",
  },
  { key: "is_primary", label: "Primary for this country", type: "checkbox" },
  { key: "is_active", label: "Active", type: "checkbox", defaultValue: true },
  { key: "notes", label: "Notes", type: "textarea" },
];

const establishmentFields = (lk: Lookups): FieldSpec[] => [
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
  {
    key: "kind",
    label: "Kind",
    type: "select",
    options: opts(entityCommon.ESTABLISHMENT_KINDS),
  },
  { key: "country_code", label: "Country", type: "country" },
  { key: "city", label: "City" },
  { key: "address_line", label: "Address" },
  {
    key: "tax_office_ref",
    label: "Tax office reference",
    hint: "SIRET, centre des impôts…",
  },
  { key: "registration_ref", label: "Registration reference" },
  { key: "customs_office", label: "Customs office" },
  {
    key: "manager_employee_id",
    label: "Site manager",
    type: "select",
    options: nameOpts(
      lk.employees,
      (e) => e.employee_id,
      (e) => e.full_name || e.employee_id,
    ),
    hint: "Who runs it. A site with no named manager is a site nobody is answerable for.",
  },
  { key: "opened_on", label: "Opened on", type: "date" },
  { key: "closed_on", label: "Closed on", type: "date" },
  {
    key: "is_active",
    label: "Active",
    type: "checkbox",
    defaultValue: true,
    hint: "A closed site stays on file — old documents still reference it.",
  },
];

/**
 * Build the field list for one collection, and fetch only the lookups it needs.
 *
 * `useList(null)` disables a query, so a contacts modal costs no requests while a
 * people modal fetches four lists. They load when the modal opens rather than
 * with the dossier: six extra requests on every entity view, for pickers most
 * visits never open, is not a trade worth making.
 */
function useChildFields(
  seg: api.EntityCollection,
  establishments: api.EntityEstablishment[],
) {
  const needs = (...segs: api.EntityCollection[]) => segs.includes(seg);
  const entities = useList<Lookups["entities"][number]>(
    needs("people") ? "/entities" : null,
  );
  const employees = useList<Lookups["employees"][number]>(
    needs("people", "establishments") ? "/employees" : null,
  );
  const users = useList<Lookups["users"][number]>(
    needs("tax-registrations") ? "/users" : null,
  );
  const jurisdictions = useList<api.TaxJurisdiction>(
    needs("tax-registrations") ? "/tax-jurisdictions" : null,
  );
  const clients = useList<Lookups["clients"][number]>(
    needs("people") ? "/clients" : null,
  );
  const suppliers = useList<Lookups["suppliers"][number]>(
    needs("people") ? "/suppliers" : null,
  );

  return React.useMemo(() => {
    const lk: Lookups = {
      ...EMPTY_LOOKUPS,
      entities: entities.rows || [],
      employees: employees.rows || [],
      users: users.rows || [],
      jurisdictions: jurisdictions.rows || [],
      clients: clients.rows || [],
      suppliers: suppliers.rows || [],
      establishments,
    };
    switch (seg) {
      case "people":
        return personFields(lk);
      case "contacts":
        return contactFields();
      case "addresses":
        return addressFields();
      case "registrations":
        return registrationFields();
      case "tax-registrations":
        return taxRegistrationFields(lk);
      case "establishments":
        return establishmentFields(lk);
      // Documents build their own list: it depends on the chosen document TYPE,
      // which has to be loaded before the modal can be assembled. See DocumentsTab.
      default:
        return [];
    }
  }, [
    seg,
    establishments,
    entities.rows,
    employees.rows,
    users.rows,
    jurisdictions.rows,
    clients.rows,
    suppliers.rows,
  ]);
}

/** A nested add/edit modal that has loaded whatever pickers its collection needs. */
function EntityChildModal({
  seg,
  title,
  row,
  establishments,
  onClose,
  onSubmit,
}: {
  seg: api.EntityCollection;
  title: string;
  row?: Record<string, unknown> | null;
  establishments: api.EntityEstablishment[];
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const fields = useChildFields(seg, establishments);
  return (
    <ChildModal
      title={title}
      fields={fields}
      initial={row}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

/* ── The dossier ───────────────────────────────────────────────────────────── */

export function EntityDossier({
  entityId,
  onEdit,
  onChanged,
  titleAs: Title = "h2",
}: {
  entityId: string;
  /** Opens the entity's edit form — owned by the host screen (the master–detail
   *  list, or the deep-link page), so there is one form reachable from both. */
  onEdit: () => void;
  /** Fired after any change here, so a host list can refresh its rows — a status
   *  change on the dossier is visible in the list beside it. */
  onChanged?: () => void;
  /**
   * What level the entity's name is.
   *
   * It depends on the host, and getting it wrong is a real accessibility defect
   * rather than a style question. Inline in the master–detail list the page's h1
   * is "Corporate entities", so the entity name is an h2 and the `Section`
   * headings below it are h3s. On the deep-link route there is no other heading,
   * so the entity name IS the h1. It was hard-coded to h3 in both, which skipped
   * a level under the list's h1 and left the deep-link page with no h1 at all.
   */
  titleAs?: "h1" | "h2";
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const d = useResource<api.Entity360>(
    () => api.entityDossier(entityId),
    [entityId],
  );
  // `?tab=` / `?field=`. The route was always deep-linkable (see the comment on
  // it in app.tsx); the TAB was not, so a link that meant "the P.O. Box is
  // missing" landed on Overview with eleven tabs to guess from.
  const [tab, setTab] = useUrlTab<Tab>(TABS, "Overview");
  useFieldHighlight([tab]);
  // The field list is no longer carried in this state: it depends on lookups
  // fetched when the modal opens, so only the collection, the title and the row
  // being edited live here.
  const [editing, setEditing] = React.useState<null | {
    seg: api.EntityCollection;
    title: string;
    row?: Record<string, unknown> | null;
  }>(null);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [structureOpen, setStructureOpen] = React.useState(false);
  const [opsPrefixOpen, setOpsPrefixOpen] = React.useState(false);
  // Blank means "today", which is what the /360 bundle already carries — so the
  // common case costs no extra request and only a deliberate date fetches.
  const [capAsOf, setCapAsOf] = React.useState("");
  const [renewalAsOf, setRenewalAsOf] = React.useState("");
  const datedCap = useResource<api.CapTable | null>(
    () =>
      capAsOf ? api.entityCapTable(entityId, capAsOf) : Promise.resolve(null),
    [entityId, capAsOf],
  );
  const datedRenewals = useResource<api.Renewals | null>(
    () =>
      renewalAsOf
        ? api.entityRenewals(entityId, renewalAsOf)
        : Promise.resolve(null),
    [entityId, renewalAsOf],
  );

  const reload = () => {
    d.reload();
    onChanged?.();
  };

  async function saveChild(
    seg: api.EntityCollection,
    values: Record<string, unknown>,
    childId?: string,
  ) {
    // Empty strings mean "not filled in", not "set to empty" — the API's shared
    // schemas normalise them away, and sending them would write blanks.
    const body = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== "" && v !== undefined),
    );
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
    } catch (e) {
      reportActionError(e);
    }
  }

  if (d.loading) return <LoadingRow label="Loading entity…" />;
  if (d.error || !d.data) {
    return (
      <ErrorState message={d.error ? errMsg(d.error) : "Entity not found."} />
    );
  }

  const {
    entity: e,
    structure,
    people,
    contacts,
    addresses,
    registrations,
    establishments,
    cap_table: cap,
    usage,
    readiness,
    treasury_accounts: treasury,
    expiring_registrations: expiring,
    can_see_governance: gov,
  } = d.data;
  const status =
    e.registration_status || (e.is_active ? "ACTIVE" : "DEACTIVATED");
  const currency = e.default_currency || "XAF";
  const shareholders = people.filter((p) => p.role === "SHAREHOLDER");
  const officers = people.filter((p) => p.role !== "SHAREHOLDER");
  // The KPI row above the tabs stays on today; only the sections with a date
  // picker follow it, so the headline figures do not silently become historical.
  const capView = (capAsOf && datedCap.data) || cap;
  const renewalsView = (renewalAsOf && datedRenewals.data) || d.data.renewals;

  return (
    <div className="space-y-4">
      {/* Header card — the client/supplier 360 surface (party-360.tsx), so the
          three masters read as one family. */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Title className="truncate text-lg font-semibold text-foreground">
                {e.legal_name}
              </Title>
              <Pill tone={LIFECYCLE_TONE[status] || "mute"}>
                {enumLabel(status)}
              </Pill>
              {e.legal_form && <Pill tone="mute">{e.legal_form}</Pill>}
              {e.country_code && <Pill tone="mute">{e.country_code}</Pill>}
              {e.accounting_framework && (
                <Pill tone="blue">{enumLabel(e.accounting_framework)}</Pill>
              )}
              {structure.is_group_parent && <Pill tone="ok">Group parent</Pill>}
            </div>
            <p className="mt-1 micro">
              <span className="num font-medium text-foreground">{e.code}</span>
              {e.trading_name ? ` · ${e.trading_name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatusOpen(true)}
            >
              Change status
            </Button>
            <Button size="sm" onClick={onEdit}>
              Edit details
            </Button>
          </div>
        </div>
      </div>

      {/* The readiness checklist IS the empty state: a new entity opens here and
          is told what to fill in, rather than showing six blank tabs. */}
      {!readiness.ready && (
        <Callout tone="warn" title="Not yet complete for statutory documents">
          <p className="text-muted-foreground">
            These are missing before this entity can print a compliant
            letterhead. Nothing is blocked — you can trade and invoice
            meanwhile.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {readiness.missing.map((m) => (
              <li key={m.field}>
                <Pill tone="warn">{m.label}</Pill>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {expiring.length > 0 && (
        <Callout tone="bad" title="Registrations needing attention">
          <ul className="mt-1 space-y-1">
            {expiring.map((x) => (
              <li key={x.registration_id}>
                <Pill tone={x.expired ? "bad" : "orange"}>
                  {x.expired ? "Expired" : "Expiring"}
                </Pill>{" "}
                {x.kind}{" "}
                {x.number ? <span className="num">{x.number}</span> : null} —{" "}
                {dateDmy(x.expires_on)}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <KpiRow>
        <KpiTile
          label={tr("Shareholders")}
          value={num(gov ? shareholders.length : cap.holder_count)}
        />
        <KpiTile
          label="Ownership recorded"
          value={`${num(cap.total_percent)}%`}
          hint={cap.balanced ? "Balanced" : "Check the cap table"}
        />
        <KpiTile label={tr("Employees")} value={num(usage.employees)} />
        <KpiTile label="Subsidiaries" value={num(usage.subsidiaries)} />
        <KpiTile label="Journal entries" value={num(usage.journal_entries)} />
      </KpiRow>

      <nav
        className="flex flex-wrap gap-1 border-b"
        aria-label="Entity sections"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="About"
            field="contact"
            description="Shown on the entity picker and internal directories."
          >
            <p className="text-sm text-muted-foreground">
              {e.description || "No description yet."}
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Detail label="Trading name">{e.trading_name}</Detail>
              <Detail label="Industry">{e.industry}</Detail>
              <Detail label={tr("Website")}>{e.website}</Detail>
              <Detail label="Headcount">
                {e.headcount != null ? num(e.headcount) : null}
              </Detail>
              <Detail label={tr("Email")}>{e.email}</Detail>
              <Detail label={tr("Phone")}>{e.phone}</Detail>
            </dl>
          </Section>

          <Section
            title="Incorporation"
            field="legal_form"
            description="The statutory facts printed on documents."
          >
            <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Detail label="Legal form">{e.legal_form}</Detail>
              <Detail label="Incorporated">
                {e.incorporation_date ? dateDmy(e.incorporation_date) : null}
              </Detail>
              <Detail label="Place">{e.incorporation_place}</Detail>
              <Detail label={tr("Country")}>{e.incorporation_country}</Detail>
              <Detail label="Share capital">
                {e.share_capital != null
                  ? money(e.share_capital, e.share_capital_currency || currency)
                  : null}
              </Detail>
              <Detail label="Paid up">
                {e.share_capital_paid_up != null
                  ? money(
                      e.share_capital_paid_up,
                      e.share_capital_currency || currency,
                    )
                  : null}
              </Detail>
              {e.dissolution_date && (
                <Detail label="Dissolved">{dateDmy(e.dissolution_date)}</Detail>
              )}
            </dl>
          </Section>

          <Section
            title="Defaults carried into other modules"
            description="What HR, payroll and billing inherit when someone picks this entity."
          >
            <dl className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Detail label="Accounting framework">
                {e.accounting_framework
                  ? enumLabel(e.accounting_framework)
                  : null}
              </Detail>
              <Detail label={tr("Default currency")}>{e.default_currency}</Detail>
              <Detail label={tr("Payroll country")}>{e.payroll_country}</Detail>
              <Detail label="Default language">
                {e.default_language === "fr"
                  ? "Français"
                  : e.default_language === "en"
                    ? "English"
                    : null}
              </Detail>
              <Detail label="Fiscal year starts">
                {e.fiscal_year_start_month
                  ? new Date(
                      2000,
                      e.fiscal_year_start_month - 1,
                      1,
                    ).toLocaleString("en", { month: "long" })
                  : null}
              </Detail>
              <Detail label={tr("Document prefix")}>{e.doc_prefix}</Detail>
              {/*
                Two prefixes, two audiences. `doc_prefix` leads INVOICE numbers
                and an accountant reads it; this one leads OPERATION-FILE
                references and a client reads it. They are shown side by side so
                nobody edits one believing it is the other — the mistake the
                single-prefix version of this screen invited.
              */}
              <Detail label="Operation reference prefix">
                {e.ops_reference_prefix ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">{e.ops_reference_prefix}</span>
                    <button
                      type="button"
                      className="micro underline underline-offset-2 hover:text-foreground"
                      onClick={() => setOpsPrefixOpen(true)}
                    >
                      Change
                    </button>
                  </span>
                ) : null}
              </Detail>
              <Detail label="Numbering resets">
                {e.numbering_reset ? enumLabel(e.numbering_reset) : null}
              </Detail>
              <Detail label="VAT registered">
                {e.vat_registered == null
                  ? null
                  : e.vat_registered
                    ? "Yes"
                    : "No"}
              </Detail>
            </dl>
          </Section>

          <Section
            title="Letterhead"
            description="What a document header would print today."
          >
            <div className="flex items-start gap-3">
              {e.logo_light_ref ? (
                <img
                  src={e.logo_light_ref}
                  alt=""
                  className="h-12 w-auto rounded border bg-background object-contain p-1"
                />
              ) : (
                <div className="flex h-12 w-24 items-center justify-center rounded border border-dashed micro text-muted-foreground">
                  No logo
                </div>
              )}
              <div className="min-w-0 text-sm">
                <p className="font-medium text-foreground">
                  {e.legal_name}
                  {e.legal_form ? `, ${e.legal_form}` : ""}
                </p>
                {e.share_capital != null && (
                  <p className="text-muted-foreground">
                    Capital{" "}
                    {money(
                      e.share_capital,
                      e.share_capital_currency || currency,
                    )}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {addresses.find((a) => a.type === "REGISTERED")
                    ? [
                        addresses.find((a) => a.type === "REGISTERED")?.line1,
                        addresses.find((a) => a.type === "REGISTERED")?.city,
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : e.address || "No registered address"}
                </p>
                <p className="num text-muted-foreground">
                  {registrations
                    .filter((r) => r.number)
                    .slice(0, 4)
                    .map((r) => `${r.kind} ${r.number}`)
                    .join(" · ") || "No registrations"}
                </p>
              </div>
            </div>
            <p className="micro text-muted-foreground">
              The full letterhead and footer designer, with a live preview,
              arrives with the documents work.
            </p>
          </Section>
        </div>
      )}

      {tab === "Identity & registrations" && (
        <Section
          title={tr("Registrations")}
          field="registrations"
          description="Tax and trade identifiers, one row per country. This is what keeps a multi-country group compliant in each system."
          action={
            <Button
              size="sm"
              onClick={() =>
                setEditing({ seg: "registrations", title: "Add registration" })
              }
            >
              Add registration
            </Button>
          }
        >
          <MiniTable
            empty={registrations.length === 0}
            head={
              <>
                <Th>{tr("Country")}</Th>
                <Th>{tr("Type")}</Th>
                <Th>{tr("Number")}</Th>
                <Th>Authority</Th>
                <Th>{tr("Issued")}</Th>
                <Th>{tr("Expires")}</Th>
                <Th />
              </>
            }
          >
            {registrations.map((r) => (
              <tr key={r.registration_id}>
                <Td>{r.country_code || "—"}</Td>
                <Td>
                  <span className="font-medium text-foreground">{r.kind}</span>
                  {r.is_primary ? (
                    <>
                      {" "}
                      <Pill tone="ok">{tr("Primary")}</Pill>
                    </>
                  ) : null}
                </Td>
                <Td>
                  <span className="num">{r.number || "—"}</span>
                </Td>
                <Td>{r.issuing_authority || "—"}</Td>
                <Td>{r.issued_on ? dateDmy(r.issued_on) : "—"}</Td>
                <Td>{r.expires_on ? dateDmy(r.expires_on) : "—"}</Td>
                <Td r>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        seg: "registrations",
                        title: "Edit registration",
                        row: r as unknown as Record<string, unknown>,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      removeChild("registrations", r.registration_id)
                    }
                  >
                    Remove
                  </Button>
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
          establishments={establishments}
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/master/tax-jurisdictions")}
                >
                  Open Tax module →
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setEditing({
                      seg: "tax-registrations",
                      title: "Add tax registration",
                      row: { country_code: e.country_code, tax_kind: "VAT" },
                    })
                  }
                >
                  Add registration
                </Button>
              </div>
            }
          >
            <MiniTable
              empty={d.data.tax_registrations.length === 0}
              head={
                <>
                  <Th>{tr("Country")}</Th>
                  <Th>{tr("Tax")}</Th>
                  <Th>{tr("Number")}</Th>
                  <Th>Regime</Th>
                  <Th>Filing</Th>
                  <Th>{tr("Status")}</Th>
                  <Th />
                </>
              }
            >
              {d.data.tax_registrations.map((t) => (
                <tr key={t.tax_registration_id}>
                  <Td>
                    {t.country_code}
                    {t.jurisdiction_name ? (
                      <span className="micro text-muted-foreground">
                        {" "}
                        · {t.jurisdiction_name}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="font-medium text-foreground">
                      {t.tax_kind}
                    </span>
                    {t.is_withholding_agent ? (
                      <>
                        {" "}
                        <Pill tone="orange">WHT agent</Pill>
                      </>
                    ) : null}
                    {t.reverse_charge_applies ? (
                      <>
                        {" "}
                        <Pill tone="blue">Reverse charge</Pill>
                      </>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="num">{t.tax_number || "—"}</span>
                  </Td>
                  <Td>{t.regime || "—"}</Td>
                  <Td>
                    {t.filing_frequency ? enumLabel(t.filing_frequency) : "—"}
                    {t.filing_due_day ? (
                      <span className="micro text-muted-foreground">
                        {" "}
                        · day {t.filing_due_day}
                      </span>
                    ) : null}
                    {/* A filing rhythm with nobody's name against it is how a
                        deadline passes with everyone assuming someone else had it. */}
                    {t.responsible_name ? (
                      <div className="micro text-muted-foreground">
                        {t.responsible_name}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    {t.deregistered_on ? (
                      <Pill tone="mute">
                        Ended {dateDmy(t.deregistered_on)}
                      </Pill>
                    ) : (
                      <Pill tone={t.is_active === false ? "mute" : "ok"}>
                        {t.is_active === false ? "Inactive" : "Active"}
                      </Pill>
                    )}
                  </Td>
                  <Td r>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          seg: "tax-registrations",
                          title: "Edit tax registration",
                          row: t as unknown as Record<string, unknown>,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        removeChild("tax-registrations", t.tax_registration_id)
                      }
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
            {d.data.tax_registrations.length === 0 && (
              <Callout tone="info" title="No tax registrations yet">
                This is what lets one group stay compliant in several countries
                at once — a Cameroon entity filing TVA monthly and a France
                subsidiary filing under its own VAT number, each with its own
                number on its own invoices.
              </Callout>
            )}
          </Section>

          <Section
            title="Filing calendar"
            description="Upcoming statutory obligations for this entity, from the shared compliance calendar."
          >
            <MiniTable
              empty={d.data.tax_obligations.length === 0}
              head={
                <>
                  <Th>Obligation</Th>
                  <Th>{tr("Period")}</Th>
                  <Th>{tr("Due")}</Th>
                  <Th>{tr("Status")}</Th>
                </>
              }
            >
              {d.data.tax_obligations.map((o) => (
                <tr key={o.tax_calendar_id}>
                  <Td>
                    <span className="font-medium text-foreground">
                      {enumLabel(o.obligation)}
                    </span>
                    {o.country_code ? (
                      <span className="micro text-muted-foreground">
                        {" "}
                        · {o.country_code}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{o.period_code || "—"}</Td>
                  <Td>{dateDmy(o.due_on)}</Td>
                  <Td>
                    <Pill
                      tone={
                        o.status === "DONE"
                          ? "ok"
                          : o.status === "LATE"
                            ? "bad"
                            : o.status === "PENDING"
                              ? "warn"
                              : "mute"
                      }
                    >
                      {enumLabel(o.status)}
                    </Pill>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </div>
      )}

      {tab === "Letterhead" && (
        <LetterheadTab entityId={entityId} onSaved={reload} />
      )}

      {tab === "Working calendar" && <WorkingCalendarTab entityId={entityId} />}

      {tab === "Renewals" && (
        <Section
          title="Renewals"
          description={`Everything on this entity that has expired or is approaching expiry, as of ${dateDmy(renewalsView.as_of)}. Nothing here blocks anything — these are recommendations for a person to act on.`}
          action={
            <div className="flex flex-wrap items-end gap-2">
              {/* Forward, to plan a renewal run; back, to answer "what had already
                  lapsed at the audit date". The endpoint took as_of from the
                  start and the screen never offered one. */}
              <div className="space-y-1 text-sm">
                <span
                  id="renewal-as-of-label"
                  className="micro block text-muted-foreground"
                >
                  {tr("As of")}
                </span>
                <DateField
                  value={renewalAsOf}
                  onChange={setRenewalAsOf}
                  className="w-40"
                  aria-labelledby="renewal-as-of-label"
                />
              </div>
              {renewalAsOf && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRenewalAsOf("")}
                >
                  Today
                </Button>
              )}
            </div>
          }
        >
          {datedRenewals.error && (
            <ErrorState message={errMsg(datedRenewals.error)} />
          )}
          <KpiRow>
            <KpiTile label={tr("Expired")} value={num(renewalsView.counts.expired)} />
            <KpiTile label="Due now" value={num(renewalsView.counts.due)} />
            <KpiTile
              label="Approaching"
              value={num(renewalsView.counts.approaching)}
            />
          </KpiRow>
          <MiniTable
            empty={renewalsView.items.length === 0}
            head={
              <>
                <Th>{tr("Item")}</Th>
                <Th>{tr("Kind")}</Th>
                <Th>{tr("Country")}</Th>
                <Th>{tr("Expires")}</Th>
                <Th r>{tr("Days")}</Th>
                <Th>{tr("State")}</Th>
              </>
            }
          >
            {renewalsView.items.map((i) => (
              <tr key={`${i.kind}-${i.id}`}>
                <Td>
                  <span className="font-medium text-foreground">{i.label}</span>
                </Td>
                <Td>{enumLabel(i.kind)}</Td>
                <Td>{i.country_code || "—"}</Td>
                <Td>{dateDmy(i.expires_on)}</Td>
                <Td r>
                  {i.days_remaining != null ? num(i.days_remaining) : "—"}
                </Td>
                <Td>
                  <Pill tone={RENEWAL_TONE[i.state] || "mute"}>
                    {enumLabel(i.state)}
                  </Pill>
                  {i.severity === "SOFT_BLOCK_RECOMMENDATION" && (
                    <>
                      {" "}
                      <Pill tone="bad">Act now</Pill>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </MiniTable>
          {renewalsView.items.length === 0 && (
            <EmptyState
              title="Nothing expiring"
              hint="Documents and registrations with an expiry date appear here as their deadline approaches."
            />
          )}
        </Section>
      )}

      {tab === "People & shareholding" && (
        <div className="space-y-4">
          {!gov && (
            <div className="rounded-lg border p-3">
              <p className="text-sm text-foreground">
                Ownership details are hidden
              </p>
              <p className="micro text-muted-foreground">
                Shareholdings, dates of birth and identity numbers need the
                entity-admin permission. Roles and names are shown because they
                are on the public trade register.
              </p>
            </div>
          )}

          <Section
            title="Shareholding"
            description={`Reconciled as of ${dateDmy(capView.as_of)}. Warnings never block saving — a partly-recorded cap table is normal during onboarding.`}
            action={
              <div className="flex flex-wrap items-end gap-2">
                {/* GET /cap-table?as_of= has always existed and the assistant's
                    own tool passes a date; the screen only ever got today's
                    snapshot out of the /360 bundle. "Who held what when the
                    accounts were signed" is the question this table is asked. */}
                <div className="space-y-1 text-sm">
                  <span
                    id="cap-table-as-of-label"
                    className="micro block text-muted-foreground"
                  >
                    {tr("As of")}
                  </span>
                  <DateField
                    value={capAsOf}
                    onChange={setCapAsOf}
                    className="w-40"
                    aria-labelledby="cap-table-as-of-label"
                  />
                </div>
                {capAsOf && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCapAsOf("")}
                  >
                    Today
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    setEditing({
                      seg: "people",
                      title: "Add shareholder",
                      row: { role: "SHAREHOLDER" },
                    })
                  }
                >
                  Add shareholder
                </Button>
              </div>
            }
          >
            {datedCap.error && <ErrorState message={errMsg(datedCap.error)} />}
            {capView.findings.length > 0 && (
              <ul className="space-y-1">
                {capView.findings.map((f, i) => (
                  <li key={i} className="text-sm">
                    <Pill tone={f.severity === "WARN" ? "warn" : "mute"}>
                      {enumLabel(f.code)}
                    </Pill>{" "}
                    <span className="text-muted-foreground">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <MiniTable
              empty={shareholders.length === 0}
              head={
                <>
                  <Th>Holder</Th>
                  <Th>{tr("Class")}</Th>
                  <Th r>Shares</Th>
                  <Th r>Ownership</Th>
                  <Th r>Voting</Th>
                  <Th>Held from</Th>
                  <Th />
                </>
              }
            >
              {shareholders.map((p) => {
                // The totals count only holdings current on the reconciliation
                // date. Rows outside that window stay visible — a transfer is
                // history worth seeing — but are marked, so a table summing to
                // less than its own footer has a visible reason.
                const current = heldOn(p, capView.as_of);
                return (
                  <tr
                    key={p.person_id}
                    className={
                      !current || p.is_active === false
                        ? "opacity-60"
                        : undefined
                    }
                  >
                    <Td>
                      <span className="font-medium text-foreground">
                        {p.full_name}
                      </span>
                      {p.holder_type === "COMPANY" && (
                        <>
                          {" "}
                          <Pill tone="blue">{tr("Company")}</Pill>
                        </>
                      )}
                      {p.is_pep && (
                        <>
                          {" "}
                          <Pill tone="orange">{tr("PEP")}</Pill>
                        </>
                      )}
                      {p.holder_entity_code && (
                        <>
                          {" "}
                          <Pill tone="mute">{p.holder_entity_code}</Pill>
                        </>
                      )}
                      {p.is_active === false && (
                        <>
                          {" "}
                          <Pill tone="mute">{tr("Inactive")}</Pill>
                        </>
                      )}
                      {!current && (
                        <>
                          {" "}
                          <Pill tone="mute">Not held on this date</Pill>
                        </>
                      )}
                    </Td>
                    <Td>{p.share_class || "—"}</Td>
                    <Td r>
                      {p.share_count != null ? num(p.share_count) : "—"}
                    </Td>
                    <Td r>
                      {p.ownership_percent != null
                        ? `${num(p.ownership_percent)}%`
                        : "—"}
                    </Td>
                    <Td r>
                      {p.voting_percent != null
                        ? `${num(p.voting_percent)}%`
                        : "—"}
                    </Td>
                    <Td>
                      {p.effective_from ? dateDmy(p.effective_from) : "—"}
                      {p.effective_to ? (
                        <span className="micro text-muted-foreground">
                          {" "}
                          → {dateDmy(p.effective_to)}
                        </span>
                      ) : null}
                    </Td>
                    <Td r>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditing({
                            seg: "people",
                            title: "Edit shareholder",
                            row: p as unknown as Record<string, unknown>,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeChild("people", p.person_id)}
                      >
                        Remove
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </MiniTable>
            {shareholders.length > 0 && (
              <p className="micro text-muted-foreground">
                {num(capView.holder_count)} holder
                {capView.holder_count === 1 ? "" : "s"} ·{" "}
                {num(capView.total_shares)} shares recorded ·{" "}
                {num(capView.total_percent)}% allocated
                {capView.issued_capital > 0
                  ? ` · issued capital ${money(capView.issued_capital, e.share_capital_currency || currency)}`
                  : ""}
              </p>
            )}
          </Section>

          <Section
            title="Directors, officers and signatories"
            description="One person can hold several roles — add a row per role."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setEditing({
                    seg: "people",
                    title: "Add person",
                    row: { role: "DIRECTOR" },
                  })
                }
              >
                Add person
              </Button>
            }
          >
            <MiniTable
              empty={officers.length === 0}
              head={
                <>
                  <Th>{tr("Name")}</Th>
                  <Th>{tr("Role")}</Th>
                  <Th>{tr("Title")}</Th>
                  <Th>Appointed</Th>
                  <Th>Until</Th>
                  <Th />
                </>
              }
            >
              {officers.map((p) => (
                <tr
                  key={p.person_id}
                  className={p.is_active === false ? "opacity-60" : undefined}
                >
                  <Td>
                    <span className="font-medium text-foreground">
                      {p.full_name}
                    </span>
                    {p.is_active === false && (
                      <>
                        {" "}
                        <Pill tone="mute">{tr("Inactive")}</Pill>
                      </>
                    )}
                  </Td>
                  <Td>
                    <Pill tone={ROLE_TONE[p.role] || "mute"}>
                      {enumLabel(p.role)}
                    </Pill>
                  </Td>
                  <Td>
                    {p.title || "—"}
                    {/* A signing limit is the whole point of an AUTHORISED_SIGNATORY
                        row, and nothing rendered it before. */}
                    {p.signature_limit_amount != null && (
                      <div className="micro text-muted-foreground">
                        up to{" "}
                        {money(
                          p.signature_limit_amount,
                          p.signature_limit_currency || currency,
                        )}
                      </div>
                    )}
                  </Td>
                  <Td>{p.effective_from ? dateDmy(p.effective_from) : "—"}</Td>
                  <Td>{p.effective_to ? dateDmy(p.effective_to) : "—"}</Td>
                  <Td r>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          seg: "people",
                          title: "Edit person",
                          row: p as unknown as Record<string, unknown>,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeChild("people", p.person_id)}
                    >
                      Remove
                    </Button>
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
            field="address_registered"
            description="REGISTERED is the statutory office the letterhead prints — often not where people actually work."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setEditing({
                    seg: "addresses",
                    title: "Add address",
                    row: { type: "REGISTERED" },
                  })
                }
              >
                Add address
              </Button>
            }
          >
            <MiniTable
              empty={addresses.length === 0}
              head={
                <>
                  <Th>{tr("Type")}</Th>
                  <Th>{tr("Address")}</Th>
                  <Th>{tr("City")}</Th>
                  <Th>{tr("Country")}</Th>
                  <Th />
                </>
              }
            >
              {addresses.map((a) => (
                <tr
                  key={a.address_id}
                  className={a.is_active === false ? "opacity-60" : undefined}
                >
                  <Td>
                    <Pill tone={a.type === "REGISTERED" ? "ok" : "mute"}>
                      {enumLabel(a.type)}
                    </Pill>
                    {a.is_active === false && (
                      <>
                        {" "}
                        <Pill tone="mute">{tr("Inactive")}</Pill>
                      </>
                    )}
                  </Td>
                  <Td>
                    {[a.line1, a.line2, a.po_box].filter(Boolean).join(", ") ||
                      "—"}
                  </Td>
                  <Td>
                    {[a.postal_code, a.city].filter(Boolean).join(" ") || "—"}
                  </Td>
                  <Td>{a.country_code || "—"}</Td>
                  <Td r>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          seg: "addresses",
                          title: "Edit address",
                          row: a as unknown as Record<string, unknown>,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeChild("addresses", a.address_id)}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>

          <Section
            title="Contacts"
            description="Departmental contact points for this entity — the AP inbox, the legal contact on a tender."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setEditing({ seg: "contacts", title: "Add contact" })
                }
              >
                Add contact
              </Button>
            }
          >
            {/* The department pills are the point of this section: "the AP inbox,
                the legal contact on a tender" is answered by role_tags, and
                without them every row reads as an undifferentiated person. */}
            <MiniTable
              empty={contacts.length === 0}
              head={
                <>
                  <Th>{tr("Name")}</Th>
                  <Th>Departments</Th>
                  <Th>{tr("Title")}</Th>
                  <Th>{tr("Email")}</Th>
                  <Th>{tr("Phone")}</Th>
                  <Th />
                </>
              }
            >
              {contacts.map((c) => (
                <tr
                  key={c.contact_id}
                  className={c.is_active === false ? "opacity-60" : undefined}
                >
                  <Td>
                    <span className="font-medium text-foreground">
                      {c.name}
                    </span>
                    {c.is_primary ? (
                      <>
                        {" "}
                        <Pill tone="ok">{tr("Primary")}</Pill>
                      </>
                    ) : null}
                    {c.is_active === false ? (
                      <>
                        {" "}
                        <Pill tone="mute">{tr("Inactive")}</Pill>
                      </>
                    ) : null}
                  </Td>
                  <Td>
                    {c.role_tags?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {c.role_tags.map((t) => (
                          <Pill key={t} tone="blue">
                            {enumLabel(t)}
                          </Pill>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>{c.title || "—"}</Td>
                  <Td>{c.email || "—"}</Td>
                  <Td>
                    {c.phone || "—"}
                    {c.language ? (
                      <span className="micro text-muted-foreground">
                        {" "}
                        · {c.language.toUpperCase()}
                      </span>
                    ) : null}
                  </Td>
                  <Td r>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          seg: "contacts",
                          title: "Edit contact",
                          row: c as unknown as Record<string, unknown>,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeChild("contacts", c.contact_id)}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </div>
      )}

      {tab === "Structure" && (
        <div className="space-y-4">
          <Section
            title="Position in the group"
            description="A subsidiary is its own entity with its own books — this records how it relates to the parent."
            action={
              <Button size="sm" onClick={() => setStructureOpen(true)}>
                Edit structure
              </Button>
            }
          >
            <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Detail label="Parent">
                {structure.ancestors.length ? (
                  <Link
                    className="underline"
                    to={`/master/corporate-entities/${structure.ancestors[0].entity_id}`}
                  >
                    {structure.ancestors[0].code} —{" "}
                    {structure.ancestors[0].legal_name}
                  </Link>
                ) : null}
              </Detail>
              <Detail label="Relationship">
                {structure.relationship_type
                  ? enumLabel(structure.relationship_type)
                  : null}
              </Detail>
              <Detail label="Owned">
                {structure.ownership_percent != null
                  ? `${num(structure.ownership_percent)}%`
                  : null}
              </Detail>
              <Detail label="Consolidates into parent">
                {structure.consolidates ? "Yes" : "No"}
              </Detail>
              <Detail label="Group parent">
                {structure.is_group_parent ? "Yes" : "No"}
              </Detail>
            </dl>
            {structure.ancestors.length > 1 && (
              <p className="micro text-muted-foreground">
                Chain: {structure.ancestors.map((a) => a.code).join(" → ")}
              </p>
            )}
          </Section>

          <Section
            title="Subsidiaries"
            description="Entities whose parent is this one."
          >
            <MiniTable
              empty={structure.children.length === 0}
              head={
                <>
                  <Th>{tr("Code")}</Th>
                  <Th>{tr("Legal name")}</Th>
                  <Th>{tr("Country")}</Th>
                  <Th>Relationship</Th>
                  <Th r>Owned</Th>
                  <Th>Framework</Th>
                </>
              }
            >
              {structure.children.map((c) => (
                <tr key={c.entity_id}>
                  <Td>
                    <Link
                      className="num font-medium underline"
                      to={`/master/corporate-entities/${c.entity_id}`}
                    >
                      {c.code}
                    </Link>
                  </Td>
                  <Td>{c.legal_name}</Td>
                  <Td>{c.country_code || "—"}</Td>
                  <Td>
                    {c.relationship_type ? enumLabel(c.relationship_type) : "—"}
                  </Td>
                  <Td r>
                    {c.ownership_percent != null
                      ? `${num(c.ownership_percent)}%`
                      : "—"}
                  </Td>
                  <Td>
                    {c.accounting_framework
                      ? enumLabel(c.accounting_framework)
                      : "—"}
                  </Td>
                </tr>
              ))}
            </MiniTable>
          </Section>

          <Section
            title="Establishments"
            field="establishments"
            description="Sites that are not separate legal persons — a warehouse or branch office with its own tax-office reference but no separate books."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setEditing({
                    seg: "establishments",
                    title: "Add establishment",
                  })
                }
              >
                Add establishment
              </Button>
            }
          >
            <MiniTable
              empty={establishments.length === 0}
              head={
                <>
                  <Th>{tr("Name")}</Th>
                  <Th>{tr("Kind")}</Th>
                  <Th>{tr("City")}</Th>
                  <Th>{tr("Country")}</Th>
                  <Th>{tr("Manager")}</Th>
                  <Th>Tax office</Th>
                  <Th />
                </>
              }
            >
              {establishments.map((s) => (
                <tr
                  key={s.establishment_id}
                  className={
                    s.is_active === false || s.closed_on
                      ? "opacity-60"
                      : undefined
                  }
                >
                  <Td>
                    <span className="font-medium text-foreground">
                      {s.name}
                    </span>
                    {s.closed_on ? (
                      <>
                        {" "}
                        <Pill tone="mute">Closed {dateDmy(s.closed_on)}</Pill>
                      </>
                    ) : s.is_active === false ? (
                      <>
                        {" "}
                        <Pill tone="mute">{tr("Inactive")}</Pill>
                      </>
                    ) : null}
                  </Td>
                  <Td>{s.kind ? enumLabel(s.kind) : "—"}</Td>
                  <Td>{s.city || "—"}</Td>
                  <Td>{s.country_code || "—"}</Td>
                  <Td>{s.manager_name || "—"}</Td>
                  <Td>
                    <span className="num">{s.tax_office_ref || "—"}</span>
                  </Td>
                  <Td r>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          seg: "establishments",
                          title: "Edit establishment",
                          row: s as unknown as Record<string, unknown>,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        removeChild("establishments", s.establishment_id)
                      }
                    >
                      Remove
                    </Button>
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
          field="treasury_accounts"
          description="Read-only here. Bank, cash and mobile-money accounts are owned by Treasury so the GL mapping and the invoice payment block can never disagree."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/master/treasury-accounts")}
            >
              Open Treasury →
            </Button>
          }
        >
          <MiniTable
            empty={treasury.length === 0}
            head={
              <>
                <Th>{tr("Label")}</Th>
                <Th>{tr("Kind")}</Th>
                <Th>GL account</Th>
                <Th>{tr("Currency")}</Th>
                <Th>{tr("Status")}</Th>
              </>
            }
          >
            {treasury.map((t) => (
              <tr key={t.treasury_account_id}>
                <Td>
                  <span className="font-medium text-foreground">{t.label}</span>
                </Td>
                <Td>
                  {enumLabel(t.kind)}
                  {t.momo_network ? ` · ${t.momo_network}` : ""}
                </Td>
                <Td>
                  <span className="num">{t.coa_code}</span>
                </Td>
                <Td>{t.currency || "—"}</Td>
                <Td>
                  <Pill tone={t.is_active ? "ok" : "mute"}>
                    {t.is_active ? "Active" : "Inactive"}
                  </Pill>
                </Td>
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
        <EntityChildModal
          seg={editing.seg}
          title={editing.title}
          row={editing.row}
          establishments={establishments}
          onClose={() => setEditing(null)}
          onSubmit={(values) => {
            const pkBySeg: Record<api.EntityCollection, string> = {
              people: "person_id",
              contacts: "contact_id",
              addresses: "address_id",
              registrations: "registration_id",
              establishments: "establishment_id",
              documents: "document_id",
              "tax-registrations": "tax_registration_id",
            };
            const childId = editing.row
              ? (editing.row[pkBySeg[editing.seg]] as string | undefined)
              : undefined;
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

      {structureOpen && (
        <StructureModal
          entityId={entityId}
          structure={structure}
          onClose={() => setStructureOpen(false)}
          onSaved={reload}
        />
      )}

      {opsPrefixOpen && (
        <OpsReferencePrefixModal
          entityId={entityId}
          current={e.ops_reference_prefix ?? ""}
          onClose={() => setOpsPrefixOpen(false)}
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
        <Link
          to="/master/corporate-entities"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Corporate entities
        </Link>
      </div>
      {/* No PageHeader here — the entity's own name is this page's h1. */}
      <EntityDossier
        entityId={entityId}
        titleAs="h1"
        onEdit={() => navigate(`/master/corporate-entities?edit=${entityId}`)}
      />
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
 *
 * WHICH MADE THE MISSING ATTACH CONTROL WORSE, NOT BETTER. `vault_id` is what
 * turns a paper-only record into a scanned one: `nested.js` advances PENDING →
 * SCANNED only when it is set. Nothing in this form set it, so every entity
 * document ever recorded sat at PENDING for good, the "Paper" pill never came
 * off, and the renewals engine kept warning about a missing scan for documents
 * that had been scanned and filed. Attaching one is now a two-step the operator
 * never sees: upload the file to the vault (MOD-64), then patch the returned id
 * onto the document.
 */
function DocumentsTab({
  entityId,
  documents,
  establishments,
  onRemove,
  onSaved,
}: {
  entityId: string;
  documents: api.EntityDocument[];
  establishments: api.EntityEstablishment[];
  onRemove: (id: string) => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const types = useResource(() => api.listDocumentTypes("ENTITY"), []);
  const [adding, setAdding] = React.useState<api.EntityDocument | "new" | null>(
    null,
  );
  const [attachError, setAttachError] = React.useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(
    null,
  );
  const [uploadSuccess, setUploadSuccess] = React.useState(false);
  const [verifyBusy, setVerifyBusy] = React.useState<string | null>(null);
  // `types.data || []` is a fresh array each render, so it cannot be a useMemo
  // dependency — the memo would rebuild the field list on every keystroke.
  const typeList = React.useMemo(() => types.data || [], [types.data]);

  const fields = React.useMemo<FieldSpec[]>(
    () => [
      {
        key: "document_type_id",
        label: "Document type",
        type: "select",
        options: typeList.map((t) => ({
          value: t.document_type_id,
          label: t.name,
        })),
      },
      { key: "title", label: "Title", placeholder: "Customs bond 2026" },
      {
        key: "document_number",
        label: "Reference number",
        systemGenerated: true,
        hint: "Generated automatically when the document is added.",
      },
      {
        key: "issuing_authority",
        label: "Issuing authority",
        placeholder: "Direction Générale des Douanes",
      },
      { key: "country_code", label: "Country", type: "country" },
      {
        key: "establishment_id",
        label: "Belongs to establishment",
        type: "select",
        options: establishments.map((s) => ({
          value: s.establishment_id,
          label: s.name,
        })),
        hint: "For a licence issued to one branch rather than the company as a whole.",
      },
      { key: "issued_on", label: "Issued on", type: "date" },
      {
        key: "expires_on",
        label: "Expires on",
        type: "date",
        hint: "Drives the renewals list.",
      },
      {
        key: "renewal_lead_days",
        label: "Warn this many days ahead",
        type: "number",
        hint: "Blank uses the document type's own lead time.",
      },
      {
        key: "physical_ref",
        label: "Paper original filed at",
        placeholder: "Box A-12",
        hint: "Only for paper originals — where the hard copy is filed.",
      },
      {
        key: "scan_file",
        label: "Document file",
        type: "file",
        hint: "PDF or image (PNG, JPEG, WebP), up to 25 MB. Optional — you can attach it from the row later.",
      },
      {
        key: "is_active",
        label: "Active",
        type: "checkbox",
        defaultValue: true,
        hint: "A superseded certificate stays on file rather than being deleted.",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [typeList, establishments],
  );

  async function save(values: Record<string, unknown>, id?: string) {
    // `scan_file` is a picked File, not a column — pull it out before writing the
    // record, then (if present) upload it to the vault and link the returned id.
    const scanFile = values.scan_file;
    const hasScan = scanFile instanceof File;
    setUploadProgress(hasScan ? 0 : null);
    setUploadSuccess(false);
    setAttachError(null);
    try {
      const body = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) =>
            key !== "scan_file" &&
            key !== "document_number" &&
            value !== "" &&
            value !== undefined,
        ),
      );
      let documentId = id;
      if (id) await api.updateEntityChild(entityId, "documents", id, body);
      else {
        const created = await api.addEntityChild<api.EntityDocument>(
          entityId,
          "documents",
          body,
        );
        documentId = created.document_id;
      }
      if (scanFile instanceof File && documentId) {
        const vaulted = await api.uploadVaultDocument(
          {
            data_url: await readFileAsDataUrl(scanFile),
            doc_type: "ENTITY_DOCUMENT",
            entity_ref: `entity_document:${documentId}`,
          },
          setUploadProgress,
        );
        await api.updateEntityChild(entityId, "documents", documentId, {
          vault_id: vaulted.doc_id,
        });
        setUploadProgress(100);
        setUploadSuccess(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
      onSaved();
    } catch (e) {
      setUploadProgress(null);
      setUploadSuccess(false);
      throw e;
    }
  }

  /**
   * Point the document at the file the vault just took.
   *
   * The upload is `<ScanAttachment>`'s half; this is the second call, which only
   * this screen can make — `entity_document.vault_id` is a reference to the
   * vault row, not a second copy of the bytes.
   */
  async function linkScan(doc: api.EntityDocument, vaultId: string) {
    await api.updateEntityChild(entityId, "documents", doc.document_id, {
      vault_id: vaultId,
    });
    // The API moves PENDING → SCANNED on its own once vault_id lands; saying so
    // explains why the pill changed without the operator touching it.
    toast.success("Scan attached — the document is now marked scanned.");
    onSaved();
  }

  async function verifyDocument(doc: api.EntityDocument) {
    setVerifyBusy(doc.document_id);
    setAttachError(null);
    try {
      await api.verifyEntityDocument(entityId, doc.document_id);
      toast.success("Document verified.");
      onSaved();
    } catch (e) {
      setAttachError(errMsg(e));
    } finally {
      setVerifyBusy(null);
    }
  }

  return (
    <Section
      title="Administrative documents"
      description="Statutes, tax clearances, licences and insurance — add each one and upload its file. Anything with an expiry date feeds the Renewals tab. Uploading marks the scan as scanned; use Verify after checking the file against the original."
      action={
        <Button size="sm" onClick={() => setAdding("new")}>
          Add document
        </Button>
      }
    >
      {types.error && <ErrorState message={errMsg(types.error)} />}
      {attachError && <ErrorState message={attachError} />}
      <MiniTable
        empty={documents.length === 0}
        head={
          <>
            <Th>Document</Th>
            <Th>{tr("Type")}</Th>
            <Th>{tr("Number")}</Th>
            <Th>{tr("Country")}</Th>
            <Th>{tr("Expires")}</Th>
            <Th>Scan</Th>
            <Th>{tr("Verification")}</Th>
            <Th />
          </>
        }
      >
        {documents.map((doc) => (
          <tr
            key={doc.document_id}
            className={doc.is_active === false ? "opacity-60" : undefined}
          >
            <Td>
              <span className="font-medium text-foreground">
                {doc.title || doc.document_type_name || "Untitled"}
              </span>
              {doc.establishment_name ? (
                <div className="micro text-muted-foreground">
                  {doc.establishment_name}
                </div>
              ) : null}
            </Td>
            <Td>{doc.document_type_name || "—"}</Td>
            <Td>
              <span className="num">{doc.document_number || "—"}</span>
            </Td>
            <Td>{doc.country_code || "—"}</Td>
            <Td>{doc.expires_on ? dateDmy(doc.expires_on) : "—"}</Td>
            <Td>
              <Pill tone={SCAN_TONE[doc.scan_status] || "mute"}>
                {enumLabel(doc.scan_status)}
              </Pill>
              {!doc.vault_id && doc.physical_ref ? (
                <>
                  {" "}
                  <Pill tone="mute">Paper</Pill>
                </>
              ) : null}
            </Td>
            <Td>
              <Pill
                tone={
                  doc.verification_status === "VERIFIED"
                    ? "ok"
                    : doc.verification_status === "REJECTED"
                      ? "bad"
                      : "warn"
                }
              >
                {enumLabel(doc.verification_status)}
              </Pill>
            </Td>
            <Td r>
              <div className="flex flex-wrap justify-end gap-2">
                <ScanAttachment
                  vaultId={doc.vault_id}
                  docType="ENTITY_DOCUMENT"
                  entityRef={`entity_document:${doc.document_id}`}
                  onAttached={(vaultId) => linkScan(doc, vaultId)}
                  onError={setAttachError}
                />
                {doc.vault_id && doc.verification_status !== "VERIFIED" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={verifyBusy === doc.document_id}
                    onClick={() => void verifyDocument(doc)}
                  >
                    Verify
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(doc)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(doc.document_id)}
                >
                  Remove
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </MiniTable>

      {documents.length === 0 && (
        <EmptyState
          title="No documents recorded"
          hint="Start with the certificate of incorporation and the statutes — the rest can follow as you gather them. Add document takes the details and the file (PDF or image, up to 25 MB) together; you can also attach the file later from the row."
        />
      )}

      {adding && (
        <ChildModal
          title={adding === "new" ? "Add document" : "Edit document"}
          fields={fields}
          initial={
            adding === "new"
              ? null
              : (adding as unknown as Record<string, unknown>)
          }
          onClose={() => setAdding(null)}
          onSubmit={(values) =>
            save(values, adding === "new" ? undefined : adding.document_id)
          }
          uploadProgress={uploadProgress}
          uploadSuccess={uploadSuccess}
          allowAddAnother={adding === "new"}
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
function LetterheadTab({
  entityId,
  onSaved,
}: {
  entityId: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const lh = useResource<api.LetterheadBundle>(
    () => api.entityLetterhead(entityId),
    [entityId],
  );
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
      header_note_fr: c.header_note_fr ?? "",
      header_note_en: c.header_note_en ?? "",
      footer_note_fr: c.footer_note_fr ?? "",
      footer_note_en: c.footer_note_en ?? "",
      legal_mentions_fr: c.legal_mentions_fr ?? "",
      legal_mentions_en: c.legal_mentions_en ?? "",
      brand_color: c.brand_color ?? "",
      accent_color: c.accent_color ?? "",
      header_height_mm:
        c.header_height_mm != null ? String(c.header_height_mm) : "",
      footer_height_mm:
        c.footer_height_mm != null ? String(c.footer_height_mm) : "",
    });
    setDirty(false);
  }, [lh.data]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.saveEntityLetterhead(entityId, body);
      lh.reload();
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveText() {
    // Empty string clears the field rather than leaving the old value — these are
    // nullable columns and the schema maps "" to undefined, so send null.
    // The two heights are millimetres: the shared `amount` primitive parses a
    // numeric string, so the input's value goes through as it is.
    const body = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [
        k,
        v.trim() === "" ? null : v.trim(),
      ]),
    );
    await patch(body);
    toast.success("Letterhead saved.");
  }

  if (lh.loading) return <LoadingRow label="Loading letterhead…" />;
  if (lh.error || !lh.data)
    return (
      <ErrorState
        message={lh.error ? errMsg(lh.error) : "Could not load the letterhead."}
      />
    );

  const {
    config: c,
    preview,
    treasury_accounts: accounts,
    remittance_account_id: remittance,
  } = lh.data;
  const p = preview[lang];

  return (
    <div className="space-y-4">
      {/*
       * THE STUDIO — the page itself, arranged by dragging.
       *
       * This replaced a hand-drawn React header/footer whose docstring claimed
       * it was "rendered by the same code the invoice generator uses". That was
       * true of the DATA and false of the pixels, and it drifted: it showed a
       * payment block on documents that never print one, and every toggle it
       * saved reached a column the renderer never read.
       *
       * The canvas below draws the renderer's OWN composed blocks, and since
       * 12760 those blocks are what every document prints.
       */}
      <LetterheadStudio
        entityId={entityId}
        bundle={lh.data}
        lang={lang}
        onLang={setLang}
        onReload={lh.reload}
        onSaved={onSaved}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
        <Section
          title="Wording"
          field="wording"
          description="What cannot be derived — a strapline, payment terms, a jurisdiction clause. Per language, so a French document never falls back to English small print."
        >
          <p className="micro text-muted-foreground">
            {tr("Editing")} {lang === "fr" ? tr("Français") : tr("English")} —{" "}
            {tr("switch language on the page above.")}
          </p>
          {(["header_note", "footer_note", "legal_mentions"] as const).map(
            (base) => {
              const key = `${base}_${lang}`;
              const label =
                base === "header_note"
                  ? "Header note"
                  : base === "footer_note"
                    ? "Footer note"
                    : "Legal mentions";
              return (
                // Anchored per FIELD, not per panel: "the late-payment clause
                // is missing" should ring the late-payment box, not the three
                // boxes it sits among. Keyed on the base name so a link works
                // whichever language is being edited.
                <label
                  key={key}
                  data-field={base}
                  className="block space-y-1 text-sm"
                >
                  <span className="font-medium text-foreground">{label}</span>
                  <textarea
                    className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    value={draft[key] ?? ""}
                    placeholder={
                      base === "legal_mentions"
                        ? lang === "fr"
                          ? "Pénalités de retard : 3 fois le taux légal."
                          : "Late payment interest at 3× the statutory rate."
                        : ""
                    }
                    onChange={(ev) => {
                      setDraft((s) => ({ ...s, [key]: ev.target.value }));
                      setDirty(true);
                    }}
                  />
                </label>
              );
            },
          )}
          <p className="micro text-muted-foreground">
            Saved with the brand settings below.
          </p>
        </Section>

        {/* Page geometry and colour. The two Selects save on change like the
            toggles above — a discrete choice has nothing to draft. The colours
            and heights are typed, so they ride the same draft as the wording. */}
        <Section
          title="Page and brand"
          field="brand_color"
          description="How the sheet is laid out and coloured. The preview is drawn from these, so a change here is visible immediately."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paper size" hint="A4 outside North America.">
              <Select
                value={c.paper_size ?? "A4"}
                disabled={busy}
                onChange={(ev) => patch({ paper_size: ev.target.value })}
              >
                <option value="A4">A4 — 210 × 297 mm</option>
                <option value="LETTER">US Letter — 216 × 279 mm</option>
              </Select>
            </Field>
            <Field label="Logo position">
              <Select
                value={c.logo_position ?? "LEFT"}
                disabled={busy}
                onChange={(ev) => patch({ logo_position: ev.target.value })}
              >
                {(["LEFT", "CENTER", "RIGHT"] as const).map((p) => (
                  <option key={p} value={p}>
                    {enumLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand colour" hint="The rule under the header.">
              <Input
                value={draft.brand_color ?? ""}
                placeholder="#C2703D"
                onChange={(ev) => {
                  setDraft((s) => ({ ...s, brand_color: ev.target.value }));
                  setDirty(true);
                }}
              />
            </Field>
            <Field
              label="Accent colour"
              hint="Secondary rules and table headings."
            >
              <Input
                value={draft.accent_color ?? ""}
                placeholder="#1F6F6B"
                onChange={(ev) => {
                  setDraft((s) => ({ ...s, accent_color: ev.target.value }));
                  setDirty(true);
                }}
              />
            </Field>
            <Field
              label="Header height (mm)"
              hint="10–120. Blank uses the renderer's default."
            >
              <Input
                type="number"
                min={10}
                max={120}
                step="any"
                value={draft.header_height_mm ?? ""}
                placeholder="35"
                onChange={(ev) => {
                  setDraft((s) => ({
                    ...s,
                    header_height_mm: ev.target.value,
                  }));
                  setDirty(true);
                }}
              />
            </Field>
            <Field
              label="Footer height (mm)"
              hint="Reserve enough for the legal mentions, or they are clipped."
            >
              <Input
                type="number"
                min={10}
                max={120}
                step="any"
                value={draft.footer_height_mm ?? ""}
                placeholder="25"
                onChange={(ev) => {
                  setDraft((s) => ({
                    ...s,
                    footer_height_mm: ev.target.value,
                  }));
                  setDirty(true);
                }}
              />
            </Field>
          </div>
          {error && <ErrorState message={error} />}
          <div className="flex justify-end">
            <Button loading={busy} disabled={!dirty || busy} onClick={saveText}>
              Save wording and brand
            </Button>
          </div>
        </Section>

        <Section
          title="Payment block"
          description="Which account leads the payment block on this entity's documents. Accounts themselves live in Treasury."
        >
          {p.payment_block.source === "bank_block_legacy" && (
            <Callout tone="warn" title="Still using the old bank block">
              These details come from the entity&apos;s legacy bank block, not a
              treasury account. Activate the migrated account in Treasury and
              flag it &ldquo;show on documents&rdquo; so the payment block and
              the ledger agree.
            </Callout>
          )}
          <Select
            value={remittance ?? ""}
            disabled={busy}
            onChange={(ev) =>
              patch({ remittance_account_id: ev.target.value || null })
            }
          >
            <option value="">{tr("— first flagged account —")}</option>
            {accounts.map((a) => (
              <option key={a.treasury_account_id} value={a.treasury_account_id}>
                {a.label} ({a.currency})
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.assign("/master/treasury-accounts")}
          >
            Manage accounts in Treasury →
          </Button>
        </Section>
      </div>

      </div>
    </div>
  );
}

/**
 * Group structure — parent, relationship, ownership, consolidation.
 *
 * These five columns were rendered read-only on the Structure tab with no way to
 * set them: `api.setEntityStructure` existed and was called by nothing, so
 * ownership percentage, consolidation and the group-parent flag had no write
 * path at all, and the entity form could only ever set the first two.
 *
 * POST /structure rather than PATCH /entities/:id even though both accept these
 * columns: the structure route emits its own `STRUCTURE_CHANGED` audit event, so
 * "who re-parented this subsidiary" is answerable without diffing an entity
 * update that also changed a phone number. The cycle check runs on both.
 */
function StructureModal({
  entityId,
  structure,
  onClose,
  onSaved,
}: {
  entityId: string;
  structure: api.Entity360["structure"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { rows: entities } = useList<api.Entity>("/entities");
  const [parentId, setParentId] = React.useState(
    structure.parent_entity_id ?? "",
  );
  const [relationship, setRelationship] = React.useState<string>(
    structure.relationship_type ?? "",
  );
  const [owned, setOwned] = React.useState(
    structure.ownership_percent != null
      ? String(structure.ownership_percent)
      : "",
  );
  const [consolidates, setConsolidates] = React.useState(
    structure.consolidates === true,
  );
  const [isGroupParent, setIsGroupParent] = React.useState(
    structure.is_group_parent === true,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Never offer this entity as its own parent, nor anything it already sits
  // above — the API rejects both (rules.assertNoCycle), but a picker that leads
  // straight to a 422 is a picker that should not have offered the option.
  const descendants = React.useMemo(
    () => new Set(structure.children.map((c) => c.entity_id)),
    [structure.children],
  );
  const parentOptions = (entities || []).filter(
    (x) => x.entity_id !== entityId && !descendants.has(x.entity_id),
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.setEntityStructure(entityId, {
        parent_entity_id: parentId || null,
        // A relationship with no parent is meaningless; clear it together so the
        // pair can never disagree.
        relationship_type: parentId ? relationship || null : null,
        ownership_percent: owned.trim() === "" ? null : Number(owned),
        consolidates,
        is_group_parent: isGroupParent,
      });
      toast.success("Structure updated.");
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Group structure"
      description="How this entity sits in the group. Changing it is recorded on the audit trail."
    >
      <div className="space-y-3">
        <Field
          label="Parent entity"
          hint="Leave blank for a standalone or top-level company."
        >
          <Select
            value={parentId}
            onChange={(ev) => setParentId(ev.target.value)}
          >
            <option value="">{tr("— none —")}</option>
            {parentOptions.map((p) => (
              <option key={p.entity_id} value={p.entity_id}>
                {p.code} — {p.legal_name}
              </option>
            ))}
          </Select>
        </Field>

        {parentId && (
          <>
            <Field label="Relationship to parent">
              <Select
                value={relationship}
                onChange={(ev) => setRelationship(ev.target.value)}
              >
                <option value="">—</option>
                {entityCommon.RELATIONSHIP_TYPES.filter(
                  (r) => r !== "HEADQUARTERS",
                ).map((r) => (
                  <option key={r} value={r}>
                    {enumLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Owned by the parent (%)"
              hint="What the parent holds. The cap table records who holds what in detail."
            >
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                value={owned}
                onChange={(ev) => setOwned(ev.target.value)}
                placeholder="100"
              />
            </Field>
          </>
        )}

        <Checkbox
          checked={consolidates}
          onCheckedChange={setConsolidates}
          label="Consolidates into the parent"
          hint="Its results are included in the parent's consolidated accounts."
        />
        <Checkbox
          checked={isGroupParent}
          onCheckedChange={setIsGroupParent}
          label="This is the group parent"
          hint="The top of the tree — the entity consolidated reporting is produced for."
        />

        {parentId && isGroupParent && (
          <Callout tone="warn">
            An entity with a parent is not usually the group parent. Leave this
            off unless it heads a sub-group with its own consolidated accounts.
          </Callout>
        )}

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={busy} onClick={save}>
            Save structure
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The two characters that lead this entity's operation-file references.
 *
 * WHY IT IS NOT A BOX ON THE ENTITY FORM. Every other field there is a fact
 * about the company that an administrator may correct at any time. This one is
 * an identifier that goes out to clients on documents and then belongs to the
 * past: the API refuses to change it once an operation file has used one, and
 * records the change on the audit trail when it does allow it. A field with
 * those rules sitting between "Website" and "Phone" would look like an ordinary
 * edit right up until it came back 422.
 *
 * The client keeps no copy of the rule — it sends the change and shows what
 * comes back, so "has a file used this?" is answered by the only thing that can
 * actually answer it.
 */
function OpsReferencePrefixModal({ entityId, current, onClose, onSaved }: {
  entityId: string;
  current: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [prefix, setPrefix] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.setEntityOpsReferencePrefix(entityId, prefix);
      toast.success("Operation reference prefix updated.");
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Operation reference prefix"
      description="The two characters every operations file of this entity starts with. Fixed once a file has used it."
    >
      <div className="space-y-3">
        <Field label="Prefix" hint="Two characters, A–Z or 0–9. Unique across this tenant's entities.">
          <Input
            value={prefix}
            onChange={(ev) => setPrefix(ev.target.value.toUpperCase().slice(0, 2))}
            maxLength={2}
            placeholder="SL"
            className="font-mono"
          />
        </Field>
        <p className="micro text-muted-foreground">
          A file would read <span className="font-mono">{(prefix || "SL")}7Z3K9QW2M4XBSM</span>. This is not the
          invoice prefix — that is <span className="font-mono">{tr("Document prefix")}</span>, and it leads a different
          set of numbers.
        </p>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button loading={busy} disabled={busy || prefix.length !== 2 || prefix === current} onClick={save}>
            Save prefix
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Lifecycle change. The API owns the transition table — this offers every target
 * and lets a rejected move come back as a readable 409, rather than the client
 * keeping a second copy of the rules that can drift from the server's.
 */
function StatusModal({
  entity,
  usage,
  onClose,
  onSaved,
}: {
  entity: api.Entity;
  usage: { subsidiaries: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const current =
    entity.registration_status || (entity.is_active ? "ACTIVE" : "DEACTIVATED");
  const [status, setStatus] = React.useState<api.EntityLifecycle>(
    current as api.EntityLifecycle,
  );
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const needsReason = ["SUSPENDED", "DEACTIVATED", "ARCHIVED"].includes(status);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.setEntityStatus(entity.entity_id, status, reason || undefined);
      toast.success("Status updated.");
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
      open
      onClose={onClose}
      title="Change entity status"
      description={`Currently ${enumLabel(current)}.`}
    >
      <div className="space-y-3">
        <Field label="New status">
          <Select
            value={status}
            onChange={(ev) => setStatus(ev.target.value as api.EntityLifecycle)}
          >
            {entityCommon.LIFECYCLE_STATES.map((s) => (
              <option key={s} value={s}>
                {enumLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
        {needsReason && (
          <Field label={tr("Reason")} required hint="Recorded on the audit trail.">
            <Input
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder="Dormant since the 2026 restructuring"
            />
          </Field>
        )}
        {usage.subsidiaries > 0 &&
          ["DEACTIVATED", "ARCHIVED"].includes(status) && (
            <Callout tone="warn">
              This entity is the parent of {usage.subsidiaries} other{" "}
              {usage.subsidiaries === 1 ? "entity" : "entities"}. Re-parent them
              first.
            </Callout>
          )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={
              busy || status === current || (needsReason && !reason.trim())
            }
            onClick={save}
          >
            Update status
          </Button>
        </div>
      </div>
    </Modal>
  );
}
