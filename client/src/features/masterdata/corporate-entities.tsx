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
import { IndexRow } from "@/components/ui/index-row";
import { useSearchParams } from "react-router-dom";
import { useFieldHighlight } from "@/lib/use-url-tab";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Modal, Field, Select } from "@/components/ui/modal";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";
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
import { useToast } from "@/components/ui/toast";
import { useList, useListPaged, errMsg } from "@/lib/use-resource";
import { useDebounced } from "@/lib/use-debounced";
import { Pagination } from "@/components/ui/pagination";
import { EntityPicker } from "@/components/entity-picker";
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
/**
 * One entity logo field — light or dark — on the upload engine.
 *
 * Extracted into its own component because the form renders this TWICE and
 * `useUpload` is a hook: two independent uploads need two independent
 * lifecycles, and a render function called twice cannot hold either.
 *
 * `profile="brand"`: this logo is printed on the entity's letterhead and its
 * invoices, so its colours have to survive the round trip exactly. The
 * enhancement chain is off for that reason, not for lack of ambition.
 */
function EntityLogoField({
  entityId,
  variant,
  current,
  hint,
  onUploaded,
  onError,
}: {
  /** Null until the entity exists — the upload is keyed by its id. */
  entityId: string | null;
  variant: "light" | "dark";
  current: string;
  hint: string;
  onUploaded: (updated: api.Entity) => void;
  onError: (message: string | null) => void;
}) {
  const upload = useUpload<api.Entity>({
    profile: "brand",
    send: async (file, ctx) =>
      api.uploadEntityLogo(
        entityId as string,
        await fileToDataUrl(file),
        variant,
        ctx.onProgress,
      ),
    onAllComplete: ([updated]) => {
      if (updated) onUploaded(updated);
    },
  });

  const item = upload.items[0] ?? null;
  const busy = item?.state === "uploading" || item?.state === "compressing";

  React.useEffect(() => {
    if (item?.state === "error" && item.error) onError(item.error);
  }, [item?.state, item?.error, onError]);

  return (
    <Field
      label={
        variant === "light"
          ? "Logo (light background)"
          : "Logo (dark background)"
      }
      hint={hint}
    >
      <div className="flex items-center gap-3">
        {item?.previewUrl || current ? (
          <img
            src={item?.previewUrl || current}
            alt=""
            className={`h-10 w-auto rounded border object-contain p-1 ${variant === "dark" ? "bg-foreground" : "bg-background"}`}
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <FilePicker
            variant="inline"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={busy || !entityId}
            trigger={busy ? "Uploading…" : current ? "Replace" : "Upload logo"}
            onPick={(files) => {
              if (!entityId) return;
              onError(null);
              void upload.pick(files);
            }}
          />
          {item && item.state !== "idle" && (
            <UploadProgress
              state={item.state}
              percent={item.percent}
              error={item.error}
            />
          )}
        </div>
      </div>
    </Field>
  );
}

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
  onClose,
  onSaved,
}: {
  row: api.Entity | null;
  onClose: () => void;
  onSaved: (saved: api.Entity) => void;
}) {
  const isNew = row === null;
  const [v, setV] = React.useState<EntityFormValues>(() => valuesFrom(row));
  const [logoLight, setLogoLight] = React.useState(row?.logo_light_ref ?? "");
  const [logoDark, setLogoDark] = React.useState(row?.logo_dark_ref ?? "");
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

  /*
   * A subsidiary's parent can be any other entity — never itself, which the API
   * rejects anyway (rules.assertNoCycle), but offering it would be a trap.
   * PR-09: the parent is no longer chosen from a browser-filtered copy of the
   * whole tenant (which capped out at entity 200); the picker searches the
   * server and offers only ACTIVE entities for a NEW link (Decision Q6). An
   * existing parent that has since been deactivated stays visible on the
   * trigger and in the open panel as history, with the active entities right
   * below it as the replacement path.
   */

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
       *
       * PR-02: the initial REGISTERED address is part of the same durable
       * operation as the entity itself. The client builds `initial_address` from
       * the registered-office fields and sends it on the same POST, so one
       * server transaction owns both rows (Decision Q7 / CE-08 / CE-19). A
       * successful create can no longer silently lose the address, and an
       * offline create is not reported complete before both records exist —
       * the outbox holds the combined payload and replays it atomically.
       */
      // Build the initial REGISTERED address from the form's office fields.
      // Kept in the same shape the dossier's address modal uses, so the
      // validation path (entityCommon.addressCreate) is identical.
      const addr = {
        line1: v.address_line1.trim(),
        line2: v.address_line2.trim(),
        city: v.address_city.trim(),
        region: v.address_region.trim(),
        postal_code: v.address_postal_code.trim(),
        country_code: (v.address_country_code || v.country_code || "").trim().toUpperCase(),
        po_box: v.address_po_box.trim(),
      };
      const hasAddr = addr.line1 || addr.city || addr.po_box || addr.postal_code;
      const initialAddress = hasAddr
        ? {
            type: "REGISTERED" as const,
            line1: addr.line1 || null,
            line2: addr.line2 || null,
            city: addr.city || null,
            region: addr.region || null,
            postal_code: addr.postal_code || null,
            country_code: addr.country_code || null,
            po_box: addr.po_box || null,
            is_primary: true,
          }
        : undefined;

      const result = isNew
        ? // An entity may be opened as a DRAFT and completed over several sittings —
          // gathering statutes, certificates and a cap table is not a one-form job.
          // The address is part of the same queued operation, so offline creates
          // hold both and report queued rather than partial success.
          await submitQueued<api.Entity>({
            path: "/entities",
            method: "POST",
            body: {
              ...body,
              code: v.code.trim(),
              legal_name: v.legal_name.trim(),
              registration_status: (v.registration_status || undefined) as
                api.EntityLifecycle | undefined,
              ...(initialAddress ? { initial_address: initialAddress } : {}),
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
        // For a new entity the queued entry now includes the initial address,
        // so "complete" is not reported before both records exist.
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
    <EntityLogoField
      entityId={isNew || !row ? null : row.entity_id}
      variant={variant}
      current={current}
      hint={hint}
      onUploaded={(updated) => {
        if (variant === "dark") setLogoDark(updated.logo_dark_ref ?? "");
        else setLogoLight(updated.logo_light_ref ?? "");
      }}
      onError={setError}
    />
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
          {/* `data-field`: the anchor `?field=legal_name` focuses and rings. */}
          <Field label={tr("Legal name")} required data-field="legal_name">
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
          <Field label={tr("Website")} data-field="website">
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

        {isNew && (
          <Fieldset
            legend="Registered office"
            hint="Creates the REGISTERED address used on letterheads. Example: 1030, Avenue Douala Manga Bell, PO Box 5120, Douala, CM."
          >
            <Field label="Address line 1" hint="Street and number — e.g. 1030, Avenue Douala Manga Bell">
              <Input
                value={v.address_line1}
                onChange={(e) => set("address_line1", e.target.value)}
                placeholder="1030, Avenue Douala Manga Bell"
              />
            </Field>
            <Field label="Address line 2">
              <Input
                value={v.address_line2}
                onChange={(e) => set("address_line2", e.target.value)}
                placeholder="Akwa"
              />
            </Field>
            <Field label="City">
              <Input
                value={v.address_city}
                onChange={(e) => set("address_city", e.target.value)}
                placeholder="Douala"
              />
            </Field>
            <Field label="Region">
              <Input
                value={v.address_region}
                onChange={(e) => set("address_region", e.target.value)}
                placeholder="Littoral"
              />
            </Field>
            <Field label="Postal code">
              <Input
                value={v.address_postal_code}
                onChange={(e) => set("address_postal_code", e.target.value)}
              />
            </Field>
            <Field label="Registered country">
              <CountrySelect
                value={v.address_country_code || v.country_code}
                onChange={(c) => set("address_country_code", c)}
                label="Registered country"
              />
            </Field>
            <Field label="PO Box" hint="Printed on letterhead as 'PO Box …'">
              <Input
                value={v.address_po_box}
                onChange={(e) => set("address_po_box", e.target.value)}
                placeholder="5120"
              />
            </Field>
          </Fieldset>
        )}

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
            hint="Leave blank for a standalone or top-level company. Only active entities can be a new parent."
            className="sm:col-span-2"
          >
            <EntityPicker
              label="Parent entity"
              value={v.parent_entity_id || null}
              onChange={(id) => set("parent_entity_id", id ?? "")}
              excludeIds={row ? [row.entity_id] : []}
              emptyLabel={tr("— none —")}
            />
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
  /*
   * PR-09 (CE-03 / CE-35): the list is searched and paged SERVER-SIDE. This
   * screen used to fetch `?limit=200` — `page()`'s own maximum — and filter
   * those rows in the browser, so entity 201 was unfindable by search no
   * matter what it was called, and nothing said the list had been cut. The
   * repo's `q` ILIKE branch does the matching, the `X-Total-Count` header the
   * list route now sends does the counting, and every entity in the tenant is
   * reachable through the pager.
   */
  const PAGE_SIZE = 50;
  const [page, setPage] = React.useState(0);
  const [q, setQ] = React.useState("");
  const search = useDebounced(q.trim(), 300);
  const paged = useListPaged<api.Entity>("/entities", {
    page,
    pageSize: PAGE_SIZE,
    q: search || undefined,
  });
  const { rows, error, loading, reload } = paged;
  const [params, setParams] = useSearchParams();
  const [selId, setSelId] = React.useState<string | null>(null);
  /** The last row clicked, so the dossier survives paging away from it. */
  const [selRow, setSelRow] = React.useState<api.Entity | null>(null);
  const [editing, setEditing] = React.useState<api.Entity | "new" | null>(null);
  const entities = React.useMemo(() => rows ?? [], [rows]);

  // A new search starts from the first page — page 3 of a previous search is
  // not a meaningful place to land in the results of a new one.
  React.useEffect(() => {
    setPage(0);
  }, [search]);

  const statusOf = (r: api.Entity) =>
    r.registration_status || (r.is_active ? "ACTIVE" : "DEACTIVATED");
  /*
   * The selected entity may not be on the LOADED page (the user paged or
   * searched past it), so the last-clicked row is kept and used as a fallback.
   * Without it the dossier would unmount the moment its row left the current
   * page — closing the very record the operator is reading.
   */
  const selected =
    entities.find((e) => e.entity_id === selId) ??
    (selRow && selRow.entity_id === selId ? selRow : null);
  React.useEffect(() => {
    if (!selId && entities.length) {
      setSelId(entities[0].entity_id);
      setSelRow(entities[0]);
    }
  }, [entities, selId]);

  /*
   * OPEN THE EDIT FORM FROM THE URL. Two spellings, both live:
   *
   *   ?edit=<entityId>          the dossier's "Edit details" link (original)
   *   ?edit=entity&row=<id>     the deep-link contract signature gaps emit
   *
   * The second exists because `edit` names WHAT to open on every other screen
   * ("employee", "addresses", "motto") and an entity id there would be the one
   * screen speaking a different dialect. The first is kept working rather than
   * migrated: it is a link people have in their history, and honouring both
   * costs one line.
   *
   * `legal_name` and `website` are entity SCALARS — the dossier only displays
   * them, this form is where they are edited — which is why a "your website is
   * missing" gap points at the list screen and not at the 360.
   *
   * PR-09: the row is fetched by id rather than looked up in the loaded page,
   * because with a server-paged list the entity can sit past the visible page
   * — the old lookup silently did nothing for exactly the entities this PR
   * makes reachable.
   */
  const editParam = params.get("edit");
  const rowParam = params.get("row");
  const editId = editParam === "entity" ? rowParam : editParam;
  const editHandled = React.useRef<string | null>(null);
  const toast = useToast();
  React.useEffect(() => {
    if (!editId) return;
    // Strip the arrival, keep the location: `?field=` stays so the highlight
    // still runs, and closing the dialog does not put it back on refresh.
    const next = new URLSearchParams(params);
    next.delete("edit");
    next.delete("row");
    setParams(next, { replace: true });
    if (editHandled.current === editId) return;
    editHandled.current = editId;
    if (editId === "new") {
      setEditing("new");
      return;
    }
    let live = true;
    api
      .getEntity(editId)
      .then((row) => {
        if (!live || !row?.entity_id) return;
        setEditing(row);
        setSelId(row.entity_id);
        setSelRow(row);
      })
      .catch((err) => {
        // Real handling rather than silence: a deep link someone followed is
        // an expectation, and "the screen did nothing" sends the reader
        // hunting for a grant that is not the problem. The param is already
        // stripped, so the toast fires once and a refresh does not repeat it.
        if (live) toast.error(`Couldn't open that entity. ${errMsg(err)}`);
      });
    return () => {
      live = false;
    };
  }, [editId, params, setParams, toast]);

  // Runs again when the dialog opens, because the field it is looking for is
  // inside it and does not exist until then.
  useFieldHighlight([editing]);

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
          activeKind={tr("Corporate entity")}
          active={!!selected}
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
              ) : entities.length === 0 ? (
                <div className="px-3 py-4 micro">
                  {search
                    ? `No entity matches “${search}”.`
                    : "No entities yet."}
                </div>
              ) : (
                entities.map((en) => (
                  <IndexRow
                    key={en.entity_id}
                    selected={en.entity_id === selId}
                    onClick={() => {
                      setSelId(en.entity_id);
                      setSelRow(en);
                    }}
                    className="items-center justify-between gap-2"
                  >
                    <span className="min-w-0 truncate">
                      <span className="num font-medium">{en.code}</span> ·{" "}
                      {en.legal_name}
                    </span>
                    <Pill tone={LIFECYCLE_TONE[statusOf(en)] || "mute"}>
                      {enumLabel(statusOf(en))}
                    </Pill>
                  </IndexRow>
                ))
              )}
            </div>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={paged.total}
              onPageChange={setPage}
            />
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
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            reload();
            // A brand-new entity is selected straight away: the readiness
            // checklist on its dossier is what says what is still missing.
            if (saved?.entity_id) {
              setSelId(saved.entity_id);
              setSelRow(saved);
            }
          }}
        />
      )}
      <ScreenAi path="master/corporate-entities" />
    </section>
  );
}
