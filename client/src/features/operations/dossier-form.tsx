/**
 * Create / edit an operation file.
 *
 * WHAT CHANGED, AND WHY (SSDC, migration 0660).
 *
 * This form used to be ONE fixed set of controls for all twelve service types:
 * Port of loading, Port of discharge, BL/MAWB, Incoterm, Customs regime. That
 * meant a WAREHOUSING file was asked for a port it does not have and a Bill of
 * Lading it will never be issued, while there was nowhere at all to record the
 * warehouse, the bonded status or the stock-in date that a storage job is
 * actually about. Air files were asked for a BL and had nowhere to put a flight
 * number.
 *
 * Now the top half asks the three questions that are true of every file —
 * entity, client, service type — and everything below is rendered from the
 * SERVICE TYPE'S OWN FORM, fetched the moment a service type is picked. There
 * is no per-service-type code in this file, and adding a service type (or
 * changing what an existing one asks for) needs no change here at all.
 *
 * THE CARRIER USED TO BE HERE TWICE. A hard-coded `<Select>` in this file AND a
 * seeded `RATE_PROVIDER` field on SEA, AIR, HINTERLAND and PROJECT — both
 * writing `dossier.rate_provider_id`, so whichever saved last won. The select
 * also offered every shipping line and airline on every file, including a
 * warehousing job that has no carrier at all, and it could not offer a haulier
 * because the kind did not exist.
 *
 * The service-type field is now the single definition: correctly labelled per
 * mode ("Compagnie maritime" vs "Compagnie aérienne"), scoped to the kinds that
 * make sense (`ref_kind`), absent on warehousing, and already seeded. Deleting
 * the local copy is the point — two controls for one column is how they drift.
 *
 * The dossier columns have not moved: a field definition binds "Port of
 * loading" to `dossier.pol`, so the Control Tower map, the dossier search and
 * the carrier rate lookup all keep working on exactly the columns they always
 * read. See migration 0660's header for the storage split.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { FormButtons } from "@/components/ui/form-buttons";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { useCanUseModule } from "@/lib/route-access";
import type { Entity, Client } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
import { CarrierQuickAdd } from "./carrier-quick-add";
import { DetailFieldGroups, missingRequired, valuesFromDetails, displaysFromDetails, type DetailValues, type DetailDisplays } from "./detail-fields";

export function DossierForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.Dossier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: clients } = useList<Client>("/clients");
  // Service types drive the milestone chain, the Control Tower map's transport
  // mode, AND — since 0660 — which fields this form renders at all. Active only:
  // archived types stay valid on old dossiers but must not be selectable.
  const { rows: serviceTypes } = useList<api.ServiceType>("/service-types");
  // Rate providers are MOD-10. Offering "+ Add carrier" to someone with no
  // grant there is a button that always fails — see useCanUseModule.
  const canAddCarrier = useCanUseModule("MOD-10");

  const [entityId, setEntityId] = React.useState(row?.entity_id ?? "");
  const [clientId, setClientId] = React.useState(row?.client_id ?? "");
  const [serviceTypeId, setServiceTypeId] = React.useState(row?.service_type_id ?? "");
  const [values, setValues] = React.useState<DetailValues>({});
  /** The pending "+ Add carrier": which field asked, what they had typed, and
   *  which kinds that field accepts. */
  const [addCarrier, setAddCarrier] = React.useState<{ key: string; term: string; kinds: string[] } | null>(null);
  const [displays, setDisplays] = React.useState<DetailDisplays>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]> | null>(null);

  /**
   * The service type's form. Re-fetched whenever the picker changes — this IS
   * the "select the service type and it immediately gives you the fields"
   * behaviour, and it is one request against definitions the tenant owns.
   */
  const form = useResource<api.DetailForm | null>(
    () => (serviceTypeId ? api.getDetailForm(serviceTypeId) : Promise.resolve(null)),
    [serviceTypeId],
  );

  /**
   * When EDITING, load what the file already holds — from the projection, so the
   * values are read by the same rule the panel displays them by (some live in
   * dossier columns, the rest in details_json) rather than by a second copy of
   * that logic here.
   */
  const existing = useResource<api.ShipmentDetails | null>(
    () => (row ? api.getShipmentDetails(row.dossier_id) : Promise.resolve(null)),
    [row?.dossier_id],
  );
  React.useEffect(() => {
    if (!existing.data) return;
    setValues(valuesFromDetails(existing.data.groups));
    // The carrier field stores a uuid; this is the name the projection resolved
    // for it, so the picker opens reading "Maersk" and not the id.
    setDisplays(displaysFromDetails(existing.data.groups));
  }, [existing.data]);

  /**
   * Changing the service type on an EXISTING file is deliberately destructive
   * of the detail values, because they belong to the old form: a warehouse
   * location has no meaning on a sea file. Clearing them and saying so is
   * honest; carrying them across silently would leave orphaned values that no
   * form renders and no panel explains.
   */
  const switched = !isNew && serviceTypeId !== (row?.service_type_id ?? "");
  React.useEffect(() => {
    if (switched) setValues({});
  }, [switched]);

  const setValue = (key: string, v: unknown) => {
    setValues((s) => ({ ...s, [key]: v }));
    setFieldErrors((e) => (e && e[key] ? { ...e, [key]: [] } : e));
  };

  const missing = missingRequired(form.data ?? null, values);
  const canSubmit = !!entityId && !busy && missing.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors(null);
    // NO `rate_provider_id` here. The service type's own CARRIER field binds to
    // that column, and `foldDetails` lets an explicit body key win over the
    // folded patch — so sending it from this form would overwrite whatever the
    // picker chose with whatever this form last thought.
    const body: api.DossierInput & { details?: DetailValues } = {
      entity_id: entityId,
      client_id: clientId || undefined,
      service_type_id: serviceTypeId || undefined,
      details: values,
    };
    try {
      if (isNew) await api.createDossier(body);
      else await api.updateDossier(row!.dossier_id, body);
      onSaved();
      onClose();
    } catch (err) {
      // A 422 from the detail validator is field-keyed; route it to the
      // controls rather than showing one banner over a twenty-field form.
      const detail = (err as { details?: Record<string, string[]> })?.details;
      if (detail && typeof detail === "object") setFieldErrors(detail);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const chosen = (serviceTypes || []).find((s) => s.service_type_id === serviceTypeId);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "New operation file" : "Edit operation file"}
      description="A dossier is the anchor everything (costing, transit, invoicing) tags."
    >
      <form className="space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">—</option>
              {(clients || []).map((c) => (
                <option key={c.client_id} value={c.client_id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Service type"
            className="sm:col-span-2"
            hint="Choosing a service decides which details this file captures, and its milestone chain."
          >
            <Select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
              <option value="">—</option>
              {(serviceTypes || []).map((s) => (
                <option key={s.service_type_id} value={s.service_type_id}>
                  {s.name_en || s.name_fr}
                  {s.has_active_template === false ? " (no milestone template)" : ""}
                </option>
              ))}
            </Select>
            {!(serviceTypes || []).length && (
              <p className="micro mt-1">
                No service types yet — add them under Operations → Service types. Without one, a dossier gets no
                milestone chain and no detail form.
              </p>
            )}
          </Field>
        </div>

        {switched && (
          <Callout tone="warn" title="Service type changed">
            The details below belong to the new service type. Anything captured under the previous one has been
            cleared — a warehouse location has no meaning on a sea file.
          </Callout>
        )}

        {serviceTypeId && form.loading && <Skeleton className="h-32 w-full" />}
        {form.error && <ErrorState message={form.error} />}

        {form.data && !form.data.field_set && (
          <Callout tone="warn" title="No detail form yet">
            {chosen?.name_en || chosen?.name_fr || "This service type"} has no shipment-detail form. Add one under
            Service types → Details; until then this file records only the fields above.
          </Callout>
        )}

        {form.data?.field_set && (
          <DetailFieldGroups
            groups={form.data.groups}
            values={values}
            displays={displays}
            onChange={setValue}
            onCreateCarrier={canAddCarrier ? (key, term, kinds) => setAddCarrier({ key, term, kinds }) : undefined}
            errors={fieldErrors}
            disabled={busy}
          />
        )}

        {/* Say WHY the button is disabled. A greyed-out control with no reason
            is the single most common way a form wastes somebody's afternoon. */}
        {missing.length > 0 && (
          <p className="micro text-muted-foreground">
            Still needed: {missing.map((f) => f.label).join(", ")}.
          </p>
        )}

        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!canSubmit}
          onCancel={onClose}
          saveLabel={isNew ? "Create file" : "Save changes"}
        />
      </form>

      {/* Created and selected without leaving the file — the alternative is a
          trip to Master data and a half-filled form abandoned behind it. */}
      {addCarrier && (
        <CarrierQuickAdd
          open
          initialName={addCarrier.term}
          kinds={addCarrier.kinds}
          onClose={() => setAddCarrier(null)}
          onCreated={(row) => {
            setValue(addCarrier.key, row.rate_provider_id);
            setDisplays((d) => ({ ...d, [addCarrier.key]: row.name }));
          }}
        />
      )}
    </Dialog>
  );
}
