/**
 * Master data — corporate entities: the legal companies the tenant invoices as.
 *
 * Split out of `features/masterdata/pages.tsx` in Phase 4 (audit F7).
 *
 * A master–detail screen: a searchable list of entities on the left, the full
 * dossier inline on the right (features/masterdata/entity-360.tsx, EntityDossier)
 * — the same shape as the client and supplier masters. Everything about an entity
 * lives on the dossier: registrations, people and shareholding, addresses, group
 * structure, treasury. It stays deep-linkable on its own route
 * (/master/corporate-entities/:id) for links from payroll, invoices and alerts.
 *
 * THE FORM COVERS THE WHOLE MASTER RECORD, in sections. It used to ask for
 * thirteen fields out of the shared schema's thirty-three, and the twenty it
 * skipped were not skippable: `share_capital` is on the readiness checklist and
 * on the letterhead, so the dossier's "not yet complete for statutory documents"
 * callout could never be satisfied and the letterhead's share-capital block could
 * never print. A column the API accepts and the dossier displays but no control
 * writes reads `—` forever. `ENTITY_FORM_KEYS` below is the list of what this
 * form writes, and a build gate diffs it against the shared schema so the gap
 * cannot re-open silently.
 *
 * What it still does NOT write, deliberately:
 *   - `niu` / `rccm` / `address` / `bank_block` — the legacy single-value columns,
 *     superseded by the registrations, addresses and treasury collections on the
 *     dossier. Offering both would be two writers for one fact.
 *   - `ownership_percent` / `consolidates` / `is_group_parent` — the Structure
 *     tab owns those, because they describe the edge to the parent rather than
 *     the entity, and POST /structure runs the cycle check.
 *   - `logo_light_ref` / `logo_dark_ref` — written by the upload control here,
 *     via POST /entities/:id/logo, not by the PATCH body.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { useSearchParams } from "react-router-dom";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Modal, Field, Select } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { DraftBanner } from "@/components/ui/draft-banner";
import { useFormDraft } from "@/lib/form-draft";
import { submitQueued } from "@/lib/outbox";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { CountrySelect } from "@/components/country-select";
import { SmartCurrencyPicker } from "@/components/smart-currency-picker";
import { TimezonePicker } from "@/components/timezone-picker";
import { LegalFormPicker } from "@/components/legal-form-picker";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import { entityCommon } from "@shared";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";
import { EntityDossier } from "./entity-360";
import {
  entityFormBody,
  valuesFrom,
  type EntityFormValues,
} from "./entity-form-fields";

const LIFECYCLE_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  PENDING_REVIEW: "blue",
  ACTIVE: "ok",
  SUSPENDED: "orange",
  DEACTIVATED: "mute",
  ARCHIVED: "mute",
};

const FRAMEWORKS: { value: api.AccountingFramework; label: string }[] = [
  { value: "OHADA", label: "OHADA (SYSCOHADA révisé)" },
  { value: "IFRS", label: "IFRS" },
  { value: "IFRS_SME", label: "IFRS for SMEs" },
  { value: "US_GAAP", label: "US GAAP" },
  { value: "FR_PCG", label: "France — Plan Comptable Général" },
  { value: "UK_GAAP", label: "UK GAAP" },
  { value: "LOCAL_OTHER", label: "Other local framework" },
];

/** How an entity's document numbers restart. Null means "inherit the tenant default". */
const NUMBERING_RESETS = ["NEVER", "ANNUAL", "MONTHLY"] as const;

/** A titled block of fields — thirty controls in one flat grid is a wall. */
function Fieldset({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {legend}
      </legend>
      {hint && <p className="micro text-muted-foreground">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function EntityForm({
  row,
  entities,
  onClose,
  onSaved,
}: {
  row: api.Entity | null;
  entities: api.Entity[];
  onClose: () => void;
  onSaved: (saved: api.Entity) => void;
}) {
  const isNew = row === null;
  const [v, setV] = React.useState<EntityFormValues>(() => valuesFrom(row));
  const [logoLight, setLogoLight] = React.useState(row?.logo_light_ref ?? "");
  const [logoDark, setLogoDark] = React.useState(row?.logo_dark_ref ?? "");
  const [logoBusy, setLogoBusy] = React.useState<"light" | "dark" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [queued, setQueued] = React.useState(false);
  const { rows: jurisdictions } =
    useList<api.TaxJurisdiction>("/tax-jurisdictions");

  /**
   * Autosave. Keyed by entity id (or "new") so the draft for a NEW entity and
   * the draft for an edit of SLAS cannot overwrite each other — this modal is
   * opened from three places, including a deep link, and the same component
   * instance serves all of them.
   */
  const draft = useFormDraft<EntityFormValues>({
    key: `entity:${row?.entity_id ?? "new"}`,
    values: v,
    label: "Corporate entity",
  });

  const set = (k: string, value: string) => setV((s) => ({ ...s, [k]: value }));
  const setCountry = (countryCode: string) =>
    setV((current) =>
      current.country_code === countryCode
        ? current
        : {
            ...current,
            country_code: countryCode,
            // A legal form only means something inside its jurisdiction. Keeping
            // Cameroon SARL after switching the entity to Germany would create
            // internally contradictory statutory data.
            legal_form: "",
            legal_form_code: "",
            legal_form_source: "",
            legal_form_jurisdiction: "",
          },
    );

  // A subsidiary's parent can be any other entity — never itself, which the API
  // rejects anyway (rules.assertNoCycle), but offering it would be a trap.
  const parentOptions = entities.filter((x) => x.entity_id !== row?.entity_id);

  /** Entities must exist before a logo can be attached (the upload is keyed by id). */
  async function pickLogo(file: File | null, variant: "light" | "dark") {
    if (!file || isNew || !row) return;
    setLogoBusy(variant);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const updated = await api.uploadEntityLogo(
        row.entity_id,
        dataUrl,
        variant,
      );
      if (variant === "dark") setLogoDark(updated.logo_dark_ref ?? "");
      else setLogoLight(updated.logo_light_ref ?? "");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLogoBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = entityFormBody(v);
    try {
      /**
       * Routed through the outbox rather than `api.createEntity` so that a
       * network drop between pressing Save and the request landing HOLDS the
       * write instead of losing it. Everything else is unchanged: a 422 still
       * throws and still reaches `errMsg` below, because a validation failure
       * is a decision the server made and queueing it would only delay the
       * same answer.
       */
      const result = isNew
        ? // An entity may be opened as a DRAFT and completed over several sittings —
          // gathering statutes, certificates and a cap table is not a one-form job.
          await submitQueued<api.Entity>({
            path: "/entities",
            method: "POST",
            body: {
              ...body,
              code: v.code.trim(),
              legal_name: v.legal_name.trim(),
              registration_status: (v.registration_status || undefined) as
                api.EntityLifecycle | undefined,
            },
            label: `New corporate entity — ${v.legal_name.trim() || v.code.trim()}`,
          })
        : await submitQueued<api.Entity>({
            path: `/entities/${row!.entity_id}`,
            method: "PATCH",
            body,
            label: `Corporate entity — ${row!.legal_name}`,
          });

      // The draft has served its purpose either way: the values are now the
      // server's problem (sent) or the outbox's (queued), and leaving it behind
      // would offer to restore them on top of themselves.
      draft.clear();

      if (result.status === "queued") {
        // Deliberately NOT closed. The user pressed Save and nothing has been
        // saved yet; closing the form would look identical to a success and is
        // exactly the lie this feature exists to stop telling.
        setQueued(true);
        return;
      }
      onSaved(result.data);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const logoField = (
    variant: "light" | "dark",
    current: string,
    hint: string,
  ) => (
    <Field
      label={
        variant === "light"
          ? "Logo (light background)"
          : "Logo (dark background)"
      }
      hint={hint}
    >
      <div className="flex items-center gap-3">
        {current ? (
          <img
            src={current}
            alt=""
            className={`h-10 w-auto rounded border object-contain p-1 ${variant === "dark" ? "bg-foreground" : "bg-background"}`}
          />
        ) : null}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={logoBusy !== null}
          onChange={(e) => pickLogo(e.target.files?.[0] ?? null, variant)}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
        />
      </div>
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "New corporate entity" : "Edit corporate entity"}
      description="A legal entity we bill and report from. Its registrations, shareholders and addresses are collections on the entity's own page."
    >
      <form className="space-y-4" onSubmit={submit}>
        {draft.pending && (
          <DraftBanner
            savedAt={draft.pending.savedAt}
            what="entity"
            onRestore={() => {
              const restored = draft.restore();
              if (restored) setV(restored);
            }}
            onDiscard={draft.discard}
          />
        )}

        {/* The write is held, not done. Said plainly, and the form stays open —
            see `submit`. */}
        {queued && (
          <div
            role="status"
            className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok"
          >
            You're offline, so this is saved on your device and will be sent
            automatically the moment the connection comes back. You can close
            this — nothing will be lost.
          </div>
        )}

        <Fieldset legend="Identity">
          <Field label={tr("Code")} required hint="Short unique key">
            <Input
              value={v.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="SLAS"
              disabled={!isNew}
            />
          </Field>
          <Field label={tr("Legal name")} required>
            <Input
              value={v.legal_name}
              onChange={(e) => set("legal_name", e.target.value)}
              placeholder="Smart Logistics and Services Ltd"
            />
          </Field>
          <Field
            label="Trading name"
            hint="If it trades under a different name"
          >
            <Input
              value={v.trading_name}
              onChange={(e) => set("trading_name", e.target.value)}
            />
          </Field>
          <Field
            label={tr("Country")}
            hint="Legal forms below are limited to this jurisdiction"
          >
            <CountrySelect
              value={v.country_code}
              onChange={setCountry}
              allowEmpty={false}
              label={tr("Country")}
            />
          </Field>
          <Field
            label="Legal form"
            hint="Verified for the selected country and printed on the letterhead"
          >
            <LegalFormPicker
              countryCode={v.country_code}
              value={v.legal_form}
              reference={{
                code: v.legal_form_code,
                source: v.legal_form_source,
                jurisdictionCode: v.legal_form_jurisdiction,
              }}
              onChange={(selection) =>
                setV((current) => ({
                  ...current,
                  legal_form: selection?.abbreviation || "",
                  legal_form_code: selection?.code || "",
                  legal_form_source: selection?.source || "",
                  legal_form_jurisdiction: selection?.jurisdiction_code || "",
                }))
              }
            />
          </Field>
          <Field label="Industry">
            <Input
              value={v.industry}
              onChange={(e) => set("industry", e.target.value)}
              placeholder="Freight forwarding"
            />
          </Field>
          {isNew && (
            <Field
              label="Opening status"
              hint="A file can be opened as a draft and completed later"
            >
              <Select
                value={v.registration_status}
                onChange={(e) => set("registration_status", e.target.value)}
              >
                {["DRAFT", "PENDING_REVIEW", "ACTIVE"].map((s) => (
                  <option key={s} value={s}>
                    {enumLabel(s)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label={tr("Description")}
            hint="Shown on the entity picker and internal directories"
            className="sm:col-span-2"
          >
            <Input
              value={v.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Handles European clients and EU customs clearance."
            />
          </Field>
        </Fieldset>

        <Fieldset
          legend="Public contact"
          hint="Printed in the letterhead's contact line. The readiness checklist wants at least one of email or phone."
        >
          <Field label={tr("Email")}>
            <Input
              type="email"
              value={v.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="contact@example.cm"
            />
          </Field>
          <Field label={tr("Phone")}>
            <Input
              value={v.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+237690000000"
            />
          </Field>
          <Field label={tr("Website")}>
            <Input
              value={v.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://example.cm"
            />
          </Field>
          <Field
            label="Headcount"
            hint="Indicative — HR holds the real establishment"
          >
            <Input
              type="number"
              min={0}
              value={v.headcount}
              onChange={(e) => set("headcount", e.target.value)}
            />
          </Field>
          <Field
            label="Timezone"
            hint="Used when a document's date matters locally"
          >
            <TimezonePicker
              value={v.timezone}
              onChange={(timezone) => set("timezone", timezone)}
              label="Timezone"
            />
          </Field>
        </Fieldset>

        <Fieldset
          legend="Incorporation and capital"
          hint="The statutory facts documents print. Share capital is mandatory on French invoices and is on the readiness checklist."
        >
          <Field label="Date of incorporation">
            <DateField
              value={v.incorporation_date}
              onChange={(iso) => set("incorporation_date", iso)}
            />
          </Field>
          <Field
            label="Place of incorporation"
            hint="The registry town, not the trading address"
          >
            <Input
              value={v.incorporation_place}
              onChange={(e) => set("incorporation_place", e.target.value)}
              placeholder={tr("Douala")}
            />
          </Field>
          <Field
            label="Country of incorporation"
            hint="Differs from the country above for a redomiciled company"
          >
            <CountrySelect
              value={v.incorporation_country}
              onChange={(c) => set("incorporation_country", c)}
              label="Country of incorporation"
            />
          </Field>
          <Field
            label="Dissolution date"
            hint="Leave blank while the company exists"
          >
            <DateField
              value={v.dissolution_date}
              onChange={(iso) => set("dissolution_date", iso)}
            />
          </Field>
          <Field
            label="Share capital"
            hint="The registered figure, as stated in the statutes"
          >
            <Input
              type="number"
              min={0}
              step="any"
              value={v.share_capital}
              onChange={(e) => set("share_capital", e.target.value)}
              placeholder="10000000"
            />
          </Field>
          <Field
            label="Paid up"
            hint="How much of it has actually been called and paid"
          >
            <Input
              type="number"
              min={0}
              step="any"
              value={v.share_capital_paid_up}
              onChange={(e) => set("share_capital_paid_up", e.target.value)}
            />
          </Field>
          <Field
            label="Capital currency"
            hint="Often not the reporting currency"
          >
            <SmartCurrencyPicker
              value={v.share_capital_currency}
              onChange={(c) => set("share_capital_currency", c)}
              label="Capital currency"
            />
          </Field>
        </Fieldset>

        <Fieldset legend="Documents and reporting">
          <Field
            label={tr("Document prefix")}
            hint="Leads this entity's invoice numbers"
          >
            <Input
              value={v.doc_prefix}
              onChange={(e) => set("doc_prefix", e.target.value)}
              placeholder="SLAS"
            />
          </Field>
          <Field label="Default language">
            <Select
              value={v.default_language}
              onChange={(e) => set("default_language", e.target.value)}
            >
              <option value="fr">{tr("Français")}</option>
              <option value="en">{tr("English")}</option>
            </Select>
          </Field>
          <Field label="Fiscal year start month">
            <Select
              value={v.fiscal_year_start_month}
              onChange={(e) => set("fiscal_year_start_month", e.target.value)}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString("en", { month: "long" })}
                </option>
              ))}
            </Select>
          </Field>
          {/* Per ENTITY, not per tenant: a Cameroon parent on OHADA can hold a
              France subsidiary reporting under IFRS, and consolidation needs to
              know which is which. */}
          <Field
            label="Accounting framework"
            hint="What this entity reports under"
          >
            <Select
              value={v.accounting_framework}
              onChange={(e) => set("accounting_framework", e.target.value)}
            >
              {FRAMEWORKS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Numbering resets"
            hint="When this entity's document counters restart"
          >
            <Select
              value={v.numbering_reset}
              onChange={(e) => set("numbering_reset", e.target.value)}
            >
              <option value="">{tr("— tenant default —")}</option>
              {NUMBERING_RESETS.map((n) => (
                <option key={n} value={n}>
                  {enumLabel(n)}
                </option>
              ))}
            </Select>
          </Field>
        </Fieldset>

        <Fieldset
          legend="Defaults carried into other modules"
          hint="What HR, payroll and billing inherit when someone picks this entity."
        >
          <Field
            label={tr("Default currency")}
            hint="What this entity invoices and reports in"
          >
            <SmartCurrencyPicker
              value={v.default_currency}
              onChange={(c) => set("default_currency", c)}
              label={tr("Default currency")}
            />
          </Field>
          <Field
            label={tr("Payroll country")}
            hint="Which country's payroll rules apply to its staff"
          >
            <CountrySelect
              value={v.payroll_country}
              onChange={(c) => set("payroll_country", c)}
              label={tr("Payroll country")}
            />
          </Field>
          <Field
            label="Default tax jurisdiction"
            hint="Which rate card a new document reaches for first"
          >
            <Select
              value={v.default_tax_jurisdiction_id}
              onChange={(e) =>
                set("default_tax_jurisdiction_id", e.target.value)
              }
            >
              <option value="">{tr("— none —")}</option>
              {(jurisdictions || []).map((j) => (
                <option key={j.jurisdiction_id} value={j.jurisdiction_id}>
                  {j.name}
                  {j.country_code ? ` (${j.country_code})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="VAT registered"
            hint="Drives whether its documents carry VAT"
          >
            <Select
              value={v.vat_registered}
              onChange={(e) => set("vat_registered", e.target.value)}
            >
              <option value="">{tr("— not stated —")}</option>
              <option value="true">{tr("Yes")}</option>
              <option value="false">{tr("No")}</option>
            </Select>
          </Field>
        </Fieldset>

        <Fieldset
          legend="Group"
          hint="Ownership percentage and consolidation live on the entity's Structure tab, which runs the cycle check."
        >
          <Field
            label="Parent entity"
            hint="Leave blank for a standalone or top-level company"
            className="sm:col-span-2"
          >
            <Select
              value={v.parent_entity_id}
              onChange={(e) => set("parent_entity_id", e.target.value)}
            >
              <option value="">{tr("— none —")}</option>
              {parentOptions.map((p) => (
                <option key={p.entity_id} value={p.entity_id}>
                  {p.code} — {p.legal_name}
                </option>
              ))}
            </Select>
          </Field>
          {v.parent_entity_id && (
            <Field label="Relationship to parent">
              <Select
                value={v.relationship_type}
                onChange={(e) => set("relationship_type", e.target.value)}
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
          )}
        </Fieldset>

        {!isNew && (
          <Fieldset
            legend="Letterhead logos"
            hint="PNG/JPG/WebP/SVG, max 512 KB. The dark variant is used on dark document themes and on the app's dark mode."
          >
            {logoField(
              "light",
              logoLight,
              "Printed on white paper and light headers.",
            )}
            {logoField(
              "dark",
              logoDark,
              "Optional — the light logo is used when this is blank.",
            )}
          </Fieldset>
        )}

        {error && <ErrorState message={error} />}
        {/* `queued` disables Save. The entry already holds this write under its
            own idempotency key; a second press would mint a NEW key and queue a
            second entry, and the reconnect would then create two entities —
            turning the rescue into the duplicate it was designed to prevent. */}
        <FormButtons
          busy={busy}
          disabled={!v.code || !v.legal_name || busy || queued}
          onCancel={onClose}
          saveLabel={isNew ? "Create entity" : "Save changes"}
        />
      </form>
    </Modal>
  );
}

export function CorporateEntitiesPage() {
  const { rows, error, loading, reload } = useList<api.Entity>("/entities");
  const [params, setParams] = useSearchParams();
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<api.Entity | "new" | null>(null);
  const entities = React.useMemo(() => rows || [], [rows]);

  const statusOf = (r: api.Entity) =>
    r.registration_status || (r.is_active ? "ACTIVE" : "DEACTIVATED");
  const filtered = q
    ? entities.filter((e) =>
        `${e.code} ${e.legal_name}`.toLowerCase().includes(q.toLowerCase()),
      )
    : entities;
  const selected = entities.find((e) => e.entity_id === selId) || null;
  React.useEffect(() => {
    if (!selId && entities.length) setSelId(entities[0].entity_id);
  }, [entities, selId]);

  // The dossier's "Edit details" links back here with ?edit=<id> — used by the
  // deep-link page. One form, reachable from both places: open it and select
  // that entity in the list.
  const editId = params.get("edit");
  React.useEffect(() => {
    if (!editId) return;
    const found = entities.find((e) => e.entity_id === editId);
    if (found) {
      setEditing(found);
      setSelId(found.entity_id);
      params.delete("edit");
      setParams(params, { replace: true });
    }
  }, [editId, entities, params, setParams]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Corporate entities"
        description="The legal entities we bill and report from — registrations, shareholders, addresses and group structure, per entity."
        action={<Button onClick={() => setEditing("new")}>New entity</Button>}
      />
      <HubTabs />
      {error ? (
        <ScreenError
          message={error}
          what="Corporate entities"
          onRetry={reload}
        />
      ) : (
        <SplitPane
          storageKey="master.corporate-entities"
          label="Entity list width"
          defaultSize={280}
          min={220}
          max={480}
        >
          <div className="space-y-2">
            <Input
              placeholder="Search entity…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {loading ? (
                <LoadingRow label="Loading entities…" />
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No entities.</div>
              ) : (
                filtered.map((en) => (
                  <button
                    key={en.entity_id}
                    onClick={() => setSelId(en.entity_id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${en.entity_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="num font-medium">{en.code}</span> ·{" "}
                      {en.legal_name}
                    </span>
                    <Pill tone={LIFECYCLE_TONE[statusOf(en)] || "mute"}>
                      {enumLabel(statusOf(en))}
                    </Pill>
                  </button>
                ))
              )}
            </div>
          </div>
          {selected ? (
            <EntityDossier
              entityId={selected.entity_id}
              onEdit={() => setEditing(selected)}
              onChanged={reload}
            />
          ) : (
            <EmptyState
              title="No entity selected"
              hint="Choose an entity from the list."
            />
          )}
        </SplitPane>
      )}
      {editing !== null && (
        <EntityForm
          row={editing === "new" ? null : editing}
          entities={entities}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            reload();
            // A brand-new entity is selected straight away: the readiness
            // checklist on its dossier is what says what is still missing.
            if (saved?.entity_id) setSelId(saved.entity_id);
          }}
        />
      )}
      <ScreenAi path="master/corporate-entities" />
    </section>
  );
}
