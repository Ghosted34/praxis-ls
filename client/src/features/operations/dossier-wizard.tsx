/**
 * Opening an operations file, in three steps.
 *
 * WHY A WIZARD AND NOT ONE LONGER FORM. Creating a file is the most important
 * form in the product — every costing, quotation, invoice, journal line and
 * milestone hangs off it — and a service type can define twenty-five fields. One
 * screen carrying all of them, plus cargo, plus equipment, plus documents, is a
 * screen people abandon and then re-enter badly. The three steps are the three
 * questions in the order somebody actually knows the answers:
 *
 *   1. WHO & WHAT   entity, client, service type, carrier. Five controls, never
 *                   more, whatever the service type defines.
 *   2. THE DETAILS  the service type's own form, exactly as it defines it.
 *   3. CARGO & DOCS the equipment, the marks it generates, and the paperwork.
 *
 * WHY STEP 1 CREATES SOMETHING. Documents can only attach to a file that exists,
 * so step 1 opens a DRAFT and returns its id. A draft burns no ref, fires no
 * `dossier.created` and appears in no list — see migration 0671. Promotion at
 * the end is what makes it a file.
 *
 * THE CARRIER IS HOISTED, BY ROLE AND NOT BY NAME. It is required at creation,
 * and it lives in the service type's own form (the field with
 * `facet_role = 'CARRIER'`). So step 1 renders whichever field carries that
 * role and step 2 renders the remainder. One rule, no per-service-type code,
 * and the same mechanism can hoist ORIGIN/DESTINATION later if that is wanted.
 *
 * EDITING IS NOT A WIZARD. An existing file opens in `DossierForm` as before —
 * somebody correcting an ETA should not be walked through three steps.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PlacePicker } from "@/components/operations/place-picker";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { useCanUseModule } from "@/lib/route-access";
import type { Entity, Client } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
import {
  DetailFieldGroups,
  missingRequired,
  type DetailValues,
  type DetailDisplays,
} from "./detail-fields";
import { CarrierQuickAdd } from "./carrier-quick-add";
import { ContainerEditor } from "./container-editor";
import { DossierDocuments, type AttachedDoc } from "./dossier-documents";

const STEPS = ["Who & what", "The details", "Cargo & documents"] as const;

/** The field carrying the CARRIER role, if this service type defines one. */
function carrierFieldOf(form: api.DetailForm | null) {
  if (!form) return null;
  for (const g of form.groups) for (const f of g.fields) if (f.facet_role === "CARRIER") return f;
  return null;
}

export function DossierWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: clients } = useList<Client>("/clients");
  const { rows: serviceTypes } = useList<api.ServiceType>("/service-types");
  const canAddCarrier = useCanUseModule("MOD-10");
  const canCreatePlace = useCanUseModule("MOD-29");

  const [step, setStep] = React.useState(0);
  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [serviceTypeId, setServiceTypeId] = React.useState("");
  const [title, setTitle] = React.useState("");
  /**
   * The two door-to-door legs the wizard can add up front.
   *
   * WHY HERE AND NOT ONLY IN THE EDITOR. A door-to-door file is sold as
   * door-to-door: the pickup address and the delivery address are known on the day
   * the booking lands, and they are the two things the client asks about first.
   * Making the operator open the file, find the itinerary tab and add two legs is
   * how those legs end up in a notes field instead.
   *
   * Each holds the place NAME and its verified reference, because a leg with only
   * text cannot be drawn — see `itinerary.service.assertLegsResolvable`.
   */
  const [includeLastMile, setIncludeLastMile] = React.useState(false);
  const [lastMileDestination, setLastMileDestination] = React.useState("");
  const [lastMilePlaceId, setLastMilePlaceId] = React.useState<string | null>(null);
  const [includePickup, setIncludePickup] = React.useState(false);
  const [pickupOrigin, setPickupOrigin] = React.useState("");
  const [pickupPlaceId, setPickupPlaceId] = React.useState<string | null>(null);
  const [values, setValues] = React.useState<DetailValues>({});
  const [displays, setDisplays] = React.useState<DetailDisplays>({});
  const [addCarrier, setAddCarrier] = React.useState<{ key: string; term: string; kinds: string[] } | null>(null);

  /** The draft, once step 1 has been confirmed. Null until then. */
  const [draftId, setDraftId] = React.useState<string | null>(null);
  const [attached, setAttached] = React.useState<AttachedDoc[]>([]);
  const [containersOpen, setContainersOpen] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]> | null>(null);

  const form = useResource<api.DetailForm | null>(
    () => (serviceTypeId ? api.getDetailForm(serviceTypeId) : Promise.resolve(null)),
    [serviceTypeId],
  );
  const chosen = (serviceTypes || []).find((s) => s.service_type_id === serviceTypeId);
  const supportsLastMile = /SEA|AIR|END_TO_END|PROJECT/i.test(chosen?.key || "");
  /** Only an end-to-end file collects from the shipper: a port-to-port sea file
   *  starts at the port, and offering a pickup leg there invites a leg nobody
   *  agreed to move. `INLAND` already has pickup in its own template. */
  const supportsPickup = /END_TO_END/i.test(chosen?.key || "");
  const carrierField = carrierFieldOf(form.data ?? null);
  const capturesContainers = form.data?.containers?.enabled === true;

  const setValue = (key: string, v: unknown) => {
    setValues((s) => ({ ...s, [key]: v }));
    setFieldErrors((e) => (e && e[key] ? { ...e, [key]: [] } : e));
  };

  // Required at create, by agreement: entity, client, service type, carrier.
  // The carrier is only demanded when the service type HAS one — a warehousing
  // file has no carrier and must not be blocked waiting for one.
  const step1Missing = [
    !entityId && "an entity",
    !clientId && "a client",
    !serviceTypeId && "a service type",
    carrierField && !values[carrierField.key] && carrierField.label.toLowerCase(),
  ].filter(Boolean) as string[];

  // Step 2 blocks only on what the service type marked required, minus the
  // carrier, which step 1 already demanded.
  const detailsMissing = missingRequired(form.data ?? null, values).filter(
    (f) => f.key !== carrierField?.key,
  );
  // A verified place, not just text. The picker cannot produce anything else, so
  // this only guards the case where the toggle is on and nothing was picked yet.
  const lastMileMissing = includeLastMile && !lastMilePlaceId;
  const pickupMissing = includePickup && !pickupPlaceId;

  async function startDraft() {
    setBusy(true);
    setError(null);
    try {
      const row = await api.createDossierDraft({
        entity_id: entityId,
        client_id: clientId || undefined,
        service_type_id: serviceTypeId || undefined,
        title: title || undefined,
        // The carrier was answered in step 1 and belongs to the service type's
        // form, so it travels as a detail like every other field.
        details: carrierField ? { [carrierField.key]: values[carrierField.key] } : {},
      } as api.DossierInput);
      setDraftId(row.dossier_id);
      setStep(1);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    setFieldErrors(null);
    try {
      await api.promoteDossier(draftId, { details: values });
      /*
       * Pickup goes FIRST and last-mile goes LAST, and the order is the point:
       * the itinerary's sequence is its array order, so a pickup appended after
       * the main carriage would draw a truck leg that happens after the vessel
       * sails. Promotion has already seeded the service type's own template, so
       * these two bracket it.
       */
      if (includePickup && pickupPlaceId) {
        const existing = await api.getItinerary(draftId);
        await api.replaceItinerary(draftId, [
          {
            leg_type: "PICKUP",
            mode: "LAND",
            origin: pickupOrigin.trim(),
            origin_place_id: pickupPlaceId,
            status: "PLANNED",
            is_optional: false,
            source: "MANUAL",
          },
          ...existing,
        ]);
      }
      if (includeLastMile && lastMilePlaceId) {
        const existing = await api.getItinerary(draftId);
        await api.replaceItinerary(draftId, [
          ...existing,
          {
            leg_type: "FINAL_DELIVERY",
            mode: "LAND",
            destination: lastMileDestination.trim(),
            destination_place_id: lastMilePlaceId,
            status: "PLANNED",
            is_optional: false,
            source: "MANUAL",
          },
        ]);
      }
      onCreated();
      onClose();
    } catch (e) {
      const detail = (e as { details?: Record<string, string[]> })?.details;
      if (detail && typeof detail === "object") {
        setFieldErrors(detail);
        // Send them back to the step that owns the offending control.
        setStep(1);
      }
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="New operation file"
      description="A dossier is the anchor everything — costing, transit, invoicing — tags."
    >
      {/* Progress, and where they are in it. `aria-current` is what makes this
          a step indicator rather than three decorative words. */}
      <ol className="mb-5 flex flex-wrap gap-x-6 gap-y-1" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={
              i === step
                ? "text-sm font-medium text-foreground"
                : i < step
                  ? "text-sm text-muted-foreground"
                  : "text-sm text-muted-foreground/60"
            }
          >
            <span className="num">{i + 1}</span>. {s}
            {i < step && <span className="ml-1 text-ok">✓</span>}
          </li>
        ))}
      </ol>

      {/* ── Step 1 — who & what ──────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
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
            <Field label="Client" required>
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
              required
              className="sm:col-span-2"
              hint="Decides which details this file captures, and its milestone chain."
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
            </Field>
          </div>

          {serviceTypeId && form.loading && <Skeleton className="h-20 w-full" />}
          {/* The hoisted carrier — rendered from the service type's OWN
              definition, so it is labelled and scoped per mode. */}
          {carrierField && (
            <DetailFieldGroups
              groups={[{ code: "CARRIER", label: "Carrier", seq: 0, fields: [{ ...carrierField, is_required: true }] }]}
              values={values}
              displays={displays}
              onChange={setValue}
              onCreateCarrier={canAddCarrier ? (key, term, kinds) => setAddCarrier({ key, term, kinds }) : undefined}
              errors={fieldErrors}
              disabled={busy}
            />
          )}
          {form.data && !form.data.field_set && (
            <Callout tone="warn" title="No detail form yet">
              {chosen?.name_en || chosen?.name_fr || "This service type"} has no shipment-detail form. Add one under
              Service types → Details; until then this file records only the fields above.
            </Callout>
          )}

          <Field label="Title" hint="Optional — a short name people will recognise the file by.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bolloré — coffee export" />
          </Field>

          {step1Missing.length > 0 && (
            <p className="micro text-muted-foreground">Still needed: {step1Missing.join(", ")}.</p>
          )}
        </div>
      )}

      {/* ── Step 2 — the service type's own form ─────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          {form.loading && <Skeleton className="h-40 w-full" />}
          {form.error && <ErrorState message={form.error} />}
          {(supportsPickup || supportsLastMile) && (
            <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-medium text-foreground">Door-to-door legs</p>
              <p className="micro text-muted-foreground">
                Optional. Adds a road leg either side of the main carriage, so the Control Tower shows the
                whole journey rather than just the port-to-port part.
              </p>

              {supportsPickup && (
                <div className="space-y-2">
                  <Checkbox
                    checked={includePickup}
                    onCheckedChange={(c: boolean) => setIncludePickup(c === true)}
                    label="Collect from the shipper"
                  />
                  {includePickup && (
                    <Field
                      label="Collection place"
                      required
                      hint="Where the truck loads. If the exact yard is not in the catalogue, search worldwide or use a nearby reference point."
                    >
                      <PlacePicker
                        value={pickupOrigin || null}
                        label="Collection place"
                        canCreate={canCreatePlace}
                        onSelect={({ name, place }) => {
                          setPickupOrigin(name);
                          setPickupPlaceId(place.geo_place_id);
                        }}
                      />
                    </Field>
                  )}
                </div>
              )}

              {supportsLastMile && (
                <div className="space-y-2">
                  <Checkbox
                    checked={includeLastMile}
                    onCheckedChange={(c: boolean) => setIncludeLastMile(c === true)}
                    label="Deliver to the consignee"
                  />
                  {includeLastMile && (
                    <Field
                      label="Delivery place"
                      required
                      hint="Where the cargo is dropped. Delivery instructions stay on the file — this is the point the map uses."
                    >
                      <PlacePicker
                        value={lastMileDestination || null}
                        label="Delivery place"
                        canCreate={canCreatePlace}
                        onSelect={({ name, place }) => {
                          setLastMileDestination(name);
                          setLastMilePlaceId(place.geo_place_id);
                        }}
                      />
                    </Field>
                  )}
                </div>
              )}
            </section>
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
              // Already answered in step 1 — asking twice is how the two come to
              // disagree.
              omitKeys={carrierField ? [carrierField.key] : undefined}
            />
          )}
          {detailsMissing.length > 0 && (
            <p className="micro text-muted-foreground">
              Still needed: {detailsMissing.map((f) => f.label).join(", ")}.
            </p>
          )}
        </div>
      )}

      {/* ── Step 3 — cargo, equipment, documents ─────────────────────────── */}
      {step === 2 && draftId && (
        <div className="space-y-5">
          {capturesContainers ? (
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Equipment</h3>
              <p className="micro text-muted-foreground">
                What is moving, by type and count. Marks &amp; numbers are generated from this.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => setContainersOpen(true)}>
                Containers on this file
              </Button>
            </section>
          ) : (
            <p className="micro text-muted-foreground">
              This service type does not track containers, so there is no equipment to record.
            </p>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">Documents</h3>
            <DossierDocuments
              dossierId={draftId}
              clientId={clientId || null}
              attached={attached}
              onAttached={(d) => setAttached((a) => [...a, d])}
            />
          </section>
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="mt-5 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              Back
            </Button>
          )}
          {step === 0 && (
            <Button type="button" loading={busy} disabled={step1Missing.length > 0 || busy} onClick={startDraft}>
              Continue
            </Button>
          )}
          {step === 1 && (
            <Button type="button" disabled={detailsMissing.length > 0 || lastMileMissing || pickupMissing || busy} onClick={() => setStep(2)}>
              Continue
            </Button>
          )}
          {step === 2 && (
            <Button type="button" loading={busy} disabled={busy} onClick={finish}>
              Create file
            </Button>
          )}
        </div>
      </div>

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

      {containersOpen && draftId && (
        <ContainerEditor
          dossierId={draftId}
          mode={form.data?.containers?.mode || "GROUPED"}
          onClose={() => setContainersOpen(false)}
        />
      )}
    </Dialog>
  );
}
