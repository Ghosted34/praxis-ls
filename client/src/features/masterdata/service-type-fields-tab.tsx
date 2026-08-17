/**
 * Service Type → Details: the form this service asks for.
 *
 * This is the screen the whole SSDC feature is configured from. A manager
 * decides here that Sea Freight Import asks for a Bill of Lading, a vessel and
 * two ports, and that Warehousing asks for a warehouse and a bonded status —
 * and every operations file, costing, quotation and invoice of that service
 * follows, with no deploy.
 *
 * IT MIRRORS THE MILESTONES TAB ON PURPOSE. Versions, one live, edit-by-cloning,
 * publish to supersede. Somebody who has learned how milestone templates work
 * on this same page already knows how this works, and both solve the identical
 * problem: changing a definition that hundreds of open files were created
 * against.
 *
 * WHY A PUBLISHED VERSION IS READ-ONLY. Editing the live form in place breaks
 * three ways at once — files created under the old form become retroactively
 * incomplete, a renamed key orphans every value stored under it, and a locked
 * invoice cites a field that no longer exists. Cloning costs one click.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { errMsg, useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";
import { FieldOptionsDialog } from "./field-options-dialog";
import { optionProblems } from "./field-options";

/* ── The equipment toggle ──────────────────────────────────────────────────── */

/**
 * One radio, with its consequence spelled out beside it.
 *
 * The label carries the SHORT name as its accessible text and the explanation
 * rides on `aria-describedby`, so a screen reader announces "Counts by type"
 * and then the trade-off — rather than one run-on string, or (worse) a control
 * whose only text is nested too deep for anything to associate with it.
 */
function ModeChoice({
  id,
  checked,
  disabled,
  onSelect,
  title,
  body,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <input
        type="radio"
        id={id}
        name="container-mode"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-body`}
        onChange={onSelect}
      />
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block cursor-pointer text-sm font-medium text-foreground"
        >
          {title}
        </label>
        <p id={`${id}-body`} className="micro text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}

/**
 * Both switches are explained in full, because neither is guessable from its
 * name and getting one wrong is invisible until somebody opens a file and finds
 * either a container table on a warehousing job or no way to record the boxes
 * on a sea one.
 */
function ContainerCapture({
  serviceTypeId,
  captures,
  mode,
  onSaved,
}: {
  serviceTypeId: string;
  captures: boolean;
  mode: "GROUPED" | "PER_BOX";
  onSaved: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function set(body: {
    captures_containers?: boolean;
    container_detail_mode?: "GROUPED" | "PER_BOX";
  }) {
    setBusy(true);
    setError(null);
    try {
      await api.configureServiceTypeContainers(serviceTypeId, body);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">
          Equipment on the file
        </h4>
        <p className="micro text-muted-foreground">
          Whether files of this service type record the containers they move.
        </p>
      </div>

      <Checkbox
        checked={captures}
        disabled={busy}
        onCheckedChange={(c: boolean) =>
          set({ captures_containers: c === true })
        }
        label="This service moves containers"
        hint={
          captures
            ? "ON — a file of this type carries the boxes on it, and every costing, quotation and document can read them."
            : "OFF — no container table appears anywhere on a file of this type. Correct for air freight (the airline owns the ULDs), representation mandates and most storage jobs."
        }
      />

      {captures && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium text-foreground">
            How much detail per container?
          </p>
          {/* Spelled out rather than labelled "Grouped / Per box", because the
              consequence — whether per-container charges are exact or estimated
              — is the actual decision being made, and the label alone does not
              convey it. */}
          <ModeChoice
            id="container-mode-grouped"
            checked={mode === "GROUPED"}
            disabled={busy}
            onSelect={() => set({ container_detail_mode: "GROUPED" })}
            title="Counts by type"
            body="Record “3 × 40' HC, 2 × 20' Flat Rack”. Fastest to enter, and enough for anything charged per container type or per TEU. Charges that depend on each box's own dates — demurrage, detention — can only be estimated across the group."
          />
          <ModeChoice
            id="container-mode-per-box"
            checked={mode === "PER_BOX"}
            disabled={busy}
            onSelect={() => set({ container_detail_mode: "PER_BOX" })}
            title="Counts by type, plus each container individually"
            body="The same counts, and additionally each box's number, seal and dates. More to type, and never required to open a file — the numbers are filled in when the Bill of Lading arrives. This is what makes per-container charges exact instead of estimated."
          />
        </div>
      )}

      {error && <ErrorState message={error} />}
    </div>
  );
}

/* ── The field table ───────────────────────────────────────────────────────── */

const DATA_TYPES: api.FieldDataType[] = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "INTEGER",
  "DATE",
  "DATETIME",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
  "GEO_PLACE",
  "RATE_PROVIDER",
];

/** The types whose whole behaviour is their option list. */
const NEEDS_OPTIONS = (t: api.FieldDataType) =>
  t === "SELECT" || t === "MULTISELECT";

const FACET_ROLES: (api.FacetRole | "")[] = [
  "",
  "TRANSPORT_REF",
  "CONVEYANCE",
  "CARRIER",
  "ORIGIN",
  "DESTINATION",
  "ROUTE_VIA",
  // The door legs (0678) and the scheduled commitment (0679). They were in the
  // server's vocabulary and missing from this list, so the three roles the last
  // two migrations added could not be set from the screen that exists to set them.
  "COLLECTION",
  "FINAL_DELIVERY",
  "DEPARTURE_DATE",
  "ARRIVAL_DATE",
  "DELIVERY_DATE",
  "CARGO_DESC",
  "CARGO_WEIGHT",
  "CARGO_VOLUME",
  "CARGO_PACKAGES",
  "CARGO_MARKS",
  "CUSTODY_LOCATION",
  "CUSTODY_STATUS",
  "CUSTODY_IN",
  "CUSTODY_OUT",
  "INCOTERM",
  "CUSTOMS_REF",
  "CUSTOMS_REGIME",
  "SCOPE_SUMMARY",
  "COUNTERPARTY",
  "PERIOD_START",
  "PERIOD_END",
];

function FieldRow({
  field,
  editable,
  onPatch,
  onRemove,
  onEditOptions,
  busy,
}: {
  field: api.ServiceTypeField;
  editable: boolean;
  onPatch: (patch: Partial<api.ServiceTypeField>) => void;
  onRemove: () => void;
  /** Open the option editor. Available on a live version too, read-only — "what
   *  regimes does this service offer?" is asked far more often than it changes. */
  onEditOptions: () => void;
  busy: boolean;
}) {
  return (
    <TR className={field.is_active ? undefined : "opacity-50"}>
      <TD className="num text-sm">{field.key}</TD>
      <TD>
        {editable ? (
          <Input
            aria-label={`Label for ${field.key}`}
            value={field.label_en || field.label_fr}
            onChange={(e) => onPatch({ label_en: e.target.value })}
            disabled={busy}
          />
        ) : (
          <span className="text-sm">{field.label_en || field.label_fr}</span>
        )}
      </TD>
      <TD className="micro">
        {field.data_type}
        {/*
          The option list hangs off the TYPE, because that is what it belongs to and
          where somebody looks for it. The count is on the button so a form with an
          empty dropdown is visible from the table rather than only when a file
          fails to fill it in.
        */}
        {NEEDS_OPTIONS(field.data_type) && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-1 h-auto px-1.5 py-0.5"
            disabled={busy}
            onClick={onEditOptions}
          >
            {(field.options_json || []).length} option
            {(field.options_json || []).length === 1 ? "" : "s"}
            {!(field.options_json || []).length && " — none yet"}
          </Button>
        )}
      </TD>
      <TD>
        {editable ? (
          <Select
            aria-label={`Meaning of ${field.key}`}
            value={field.facet_role || ""}
            onChange={(e) =>
              onPatch({
                facet_role: (e.target.value || null) as api.FacetRole | null,
              })
            }
            disabled={busy}
          >
            {FACET_ROLES.map((r) => (
              <option key={r || "none"} value={r}>
                {r || "— not on the shared panel —"}
              </option>
            ))}
          </Select>
        ) : (
          <span className="micro">{field.facet_role || "—"}</span>
        )}
      </TD>
      <TD>
        <Checkbox
          checked={field.is_required}
          disabled={!editable || busy}
          onCheckedChange={(c: boolean) => onPatch({ is_required: c === true })}
          label={<span className="sr-only">Required: {field.key}</span>}
        />
      </TD>
      <TD>
        <Checkbox
          checked={field.is_client_visible}
          disabled={!editable || busy}
          onCheckedChange={(c: boolean) =>
            onPatch({ is_client_visible: c === true })
          }
          label={<span className="sr-only">Client-visible: {field.key}</span>}
        />
      </TD>
      <TD>
        {field.is_system ? (
          <Pill tone="mute">shipped</Pill>
        ) : (
          <Pill tone="blue">yours</Pill>
        )}
      </TD>
      <TD>
        {editable && field.is_active && (
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={busy}>
            {field.is_system ? "Retire" : "Delete"}
          </Button>
        )}
      </TD>
    </TR>
  );
}

/* ── The tab ───────────────────────────────────────────────────────────────── */

export function ServiceTypeFieldsTab({
  serviceTypeId,
  containers,
  onChanged,
}: {
  serviceTypeId: string;
  containers: {
    captures_containers: boolean;
    container_detail_mode: "GROUPED" | "PER_BOX";
  };
  onChanged?: () => void;
}) {
  const sets = useResource<api.ServiceTypeFieldSet[]>(
    () => api.listFieldSets(serviceTypeId),
    [serviceTypeId],
  );
  const [openId, setOpenId] = React.useState<string | null>(null);
  /** The field whose option list is open, by id — not the field object, so it
   *  cannot go stale against a reload that happens while the dialog is up. */
  const [optionsFor, setOptionsFor] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const live = (sets.data || []).find((s) => s.is_active) || null;
  const selectedId =
    openId ||
    live?.service_type_field_set_id ||
    (sets.data || [])[0]?.service_type_field_set_id ||
    null;

  const detail = useResource<api.ServiceTypeFieldSet | null>(
    () =>
      selectedId
        ? api.getFieldSet(serviceTypeId, selectedId)
        : Promise.resolve(null),
    [serviceTypeId, selectedId],
  );

  const set = detail.data;
  const editable = !!set && !set.is_active;
  const optionsField =
    (set?.fields || []).find((f) => f.service_type_field_id === optionsFor) ||
    null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      detail.reload();
      sets.reload();
      onChanged?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (sets.error) return <ErrorState message={sets.error} />;
  if (sets.loading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-5">
      <ContainerCapture
        serviceTypeId={serviceTypeId}
        captures={containers.captures_containers}
        mode={containers.container_detail_mode}
        onSaved={() => onChanged?.()}
      />

      {!(sets.data || []).length ? (
        <EmptyState
          title={tr("No detail form yet")}
          hint="Files of this service type will only record client, entity and carrier until a form is defined."
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Form version"
          value={selectedId || ""}
          onChange={(e) => setOpenId(e.target.value)}
          className="max-w-xs"
        >
          {(sets.data || []).map((s) => (
            <option
              key={s.service_type_field_set_id}
              value={s.service_type_field_set_id}
            >
              v{s.version}
              {s.is_active ? " — live" : " — draft"} · {s.field_count ?? 0}{" "}
              fields
              {s.dossier_count ? ` · ${s.dossier_count} files` : ""}
            </option>
          ))}
        </Select>

        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const created = await api.createFieldSetVersion(
                serviceTypeId,
                live ? { from: live.service_type_field_set_id } : {},
              );
              setOpenId(created.service_type_field_set_id);
            })
          }
        >
          {live ? "New version from live" : "Create first version"}
        </Button>

        {set && !set.is_active && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() =>
                api.publishFieldSet(
                  serviceTypeId,
                  set.service_type_field_set_id,
                ),
              )
            }
          >
            Publish v{set.version}
          </Button>
        )}
      </div>

      {set?.is_active && (
        <Callout tone="info" title={`v${set.version} is live and read-only`}>
          Every new file of this service type is created against this version.
          To change it, create a new version from it, edit that, and publish —
          files already open keep the version they were created under, so
          nothing in flight is disturbed.
        </Callout>
      )}

      {error && <ErrorState message={error} />}

      {detail.loading && <Skeleton className="h-40 w-full" />}

      {set && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tr("Key")}</TH>
                <TH>{tr("Label")}</TH>
                <TH>{tr("Type")}</TH>
                <TH>Means (shared panel)</TH>
                <TH>{tr("Required")}</TH>
                <TH>Client sees</TH>
                <TH>{tr("Origin")}</TH>
                <TH>{tr("Actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {(set.fields || []).map((f) => (
                <FieldRow
                  key={f.service_type_field_id}
                  field={f}
                  editable={editable}
                  busy={busy}
                  onPatch={(patch) =>
                    run(() =>
                      api.updateFieldInSet(
                        serviceTypeId,
                        set.service_type_field_set_id,
                        f.service_type_field_id,
                        patch,
                      ),
                    )
                  }
                  onRemove={() =>
                    run(() =>
                      api.removeFieldFromSet(
                        serviceTypeId,
                        set.service_type_field_set_id,
                        f.service_type_field_id,
                      ),
                    )
                  }
                  onEditOptions={() => setOptionsFor(f.service_type_field_id)}
                />
              ))}
            </TBody>
          </Table>

          <p className="micro text-muted-foreground">
            <strong>Means (shared panel)</strong> is how a field is understood
            by every document, costing and quotation that references a file —
            tag a Bill of Lading and a MAWB both as the transport reference and
            they render in the same place, whatever the service type. A field
            with no meaning still appears on the form and the file; it just does
            not join the shared header.
          </p>

          {editable && (
            <NewFieldForm
              busy={busy}
              onAdd={(body) =>
                run(() =>
                  api.addFieldToSet(
                    serviceTypeId,
                    set.service_type_field_set_id,
                    body,
                  ),
                )
              }
            />
          )}

          {optionsField && (
            <FieldOptionsDialog
              open
              editable={editable}
              busy={busy}
              fieldKey={optionsField.key}
              fieldLabel={optionsField.label_en || optionsField.label_fr}
              options={optionsField.options_json || []}
              onClose={() => setOptionsFor(null)}
              onSave={(options_json) => {
                setOptionsFor(null);
                run(() =>
                  api.updateFieldInSet(
                    serviceTypeId,
                    set.service_type_field_set_id,
                    optionsField.service_type_field_id,
                    { options_json },
                  ),
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Adding a field to a DRAFT. The key is immutable once created — it is the
 *  property values are stored under — so it is asked for here and never again. */
function NewFieldForm({
  onAdd,
  busy,
}: {
  onAdd: (
    body: Partial<api.ServiceTypeField> & { key: string; label_fr: string },
  ) => void;
  busy: boolean;
}) {
  const [key, setKey] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<api.FieldDataType>("TEXT");
  const [group, setGroup] = React.useState("DETAILS");
  const [role, setRole] = React.useState<api.FacetRole | "">("");
  /**
   * A new dropdown's options, collected BEFORE it is created.
   *
   * This form offered SELECT in its type list and sent no options, and the server
   * refuses a SELECT with an empty list — so adding one always failed with a 422
   * and there was no way to get past it. A dropdown is its option list; asking for
   * the list is not an extra step, it is the step that was missing.
   */
  const [options, setOptions] = React.useState<api.FieldOption[]>([]);
  const [optionsOpen, setOptionsOpen] = React.useState(false);

  const slug = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const optionsNeeded = NEEDS_OPTIONS(type);
  const optionsOk = !optionsNeeded || optionProblems(options).length === 0;
  const ok =
    /^[a-z][a-z0-9_]*$/.test(slug) &&
    slug.length >= 2 &&
    label.trim().length > 0 &&
    optionsOk;

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <h4 className="text-sm font-medium text-foreground">Add a field</h4>
      <div className="grid gap-3 sm:grid-cols-12">
        <Field
          label={tr("Key")}
          required
          className="sm:col-span-3"
          hint="Permanent — values are stored under it."
        >
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="booking_ref"
          />
        </Field>
        <Field label={tr("Label")} required className="sm:col-span-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Booking reference"
          />
        </Field>
        <Field label={tr("Type")} className="sm:col-span-2">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as api.FieldDataType)}
          >
            {DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Section")} className="sm:col-span-2">
          <Input
            value={group}
            onChange={(e) => setGroup(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Means" className="sm:col-span-2">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as api.FacetRole | "")}
          >
            {FACET_ROLES.map((r) => (
              <option key={r || "none"} value={r}>
                {r || "—"}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {optionsNeeded && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setOptionsOpen(true)}
          >
            {options.length
              ? `Edit ${options.length} option${options.length === 1 ? "" : "s"}`
              : "Set the options"}
          </Button>
          {!optionsOk && (
            <span className="micro text-muted-foreground">
              A dropdown needs its options before it can be added.
            </span>
          )}
        </div>
      )}

      <Button
        size="sm"
        disabled={!ok || busy}
        onClick={() => {
          onAdd({
            key: slug,
            label_fr: label.trim(),
            label_en: label.trim(),
            data_type: type,
            group_code: group || "DETAILS",
            facet_role: (role || null) as api.FacetRole | null,
            ...(optionsNeeded ? { options_json: options } : {}),
          });
          setKey("");
          setLabel("");
          setRole("");
          setOptions([]);
        }}
      >
        Add field
      </Button>
      {key && !/^[a-z][a-z0-9_]*$/.test(slug) && (
        <p className="micro text-muted-foreground">
          A key is snake_case and at least two characters — “{key}” becomes “
          {slug || "…"}”.
        </p>
      )}

      {optionsOpen && (
        <FieldOptionsDialog
          open
          editable
          fieldKey={slug || "new_field"}
          fieldLabel={label.trim() || "new field"}
          options={options}
          onClose={() => setOptionsOpen(false)}
          onSave={(next) => {
            setOptions(next);
            setOptionsOpen(false);
          }}
        />
      )}
    </div>
  );
}
