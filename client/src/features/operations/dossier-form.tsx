/**
 * Create / edit an operation file.
 *
 * Split out of `features/operations/pages.tsx` in Phase 3 (audit F7). Behaviour
 * is unchanged; the two comments below are the ones worth keeping in sight.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { FormButtons } from "@/components/ui/form-buttons";
import { SearchSelect } from "@/components/ui/search-select";
import { ErrorState } from "@/components/ui/states";
import { useList, errMsg } from "@/lib/use-resource";
import type { Entity, Client } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";

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
  // Service types drive the milestone chain (templates version per service type)
  // and the Control Tower map's transport mode. The form never collected this,
  // so every dossier created through the UI had service_type_id = null — which
  // meant milestones could never auto-seed and the map fell back to guessing the
  // mode from text. Active types only: archived ones stay valid on old dossiers
  // but must not be selectable for new ones.
  const { rows: serviceTypes } = useList<api.ServiceType>("/service-types");

  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "",
    client_id: row?.client_id ?? "",
    incoterm: row?.incoterm ?? "",
    service_type_id: row?.service_type_id ?? "",
    pol: row?.pol ?? "",
    pod: row?.pod ?? "",
    customs_regime: row?.customs_regime ?? "",
    bl_mawb: row?.bl_mawb ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  /**
   * POL/POD reference ids (migration 0479). These were free-text only, so
   * "Douala", "DLA" and "Douala Port" were three different ports as far as the
   * database was concerned — and the Control Tower map, which matches those
   * strings to coordinates, silently dropped the ones it couldn't recognise.
   *
   * The text is still sent as the display snapshot (same pattern as the document
   * line items in 0477), so nothing that reads pol/pod has to change and old
   * dossiers keep working. Picking from the list additionally sets the id, which
   * gives the map exact coordinates instead of a fuzzy name match.
   */
  const [polPlaceId, setPolPlaceId] = React.useState<string | null>(row?.pol_place_id ?? null);
  const [podPlaceId, setPodPlaceId] = React.useState<string | null>(row?.pod_place_id ?? null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.DossierInput = {
      entity_id: f.entity_id,
      client_id: f.client_id || undefined,
      incoterm: f.incoterm || undefined,
      service_type_id: f.service_type_id || undefined,
      pol: f.pol || undefined,
      pod: f.pod || undefined,
      customs_regime: f.customs_regime || undefined,
      bl_mawb: f.bl_mawb || undefined,
      // null (not undefined) when cleared: undefined is dropped from the body and
      // would leave a stale reference pointing at the previously chosen port.
      pol_place_id: polPlaceId,
      pod_place_id: podPlaceId,
    };
    try {
      if (isNew) await api.createDossier(body);
      else await api.updateDossier(row!.dossier_id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "New operation file" : "Edit operation file"}
      description="A dossier is the anchor everything (costing, transit, invoicing) tags."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.legal_name || en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <Select value={f.client_id} onChange={(e) => set("client_id", e.target.value)}>
              <option value="">—</option>
              {(clients || []).map((c) => (
                <option key={c.client_id} value={c.client_id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service type" className="sm:col-span-2">
            <Select value={f.service_type_id} onChange={(e) => set("service_type_id", e.target.value)}>
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
                milestone chain.
              </p>
            )}
          </Field>
          {/* allowFreeText keeps this non-blocking: an unlisted port can still be
              typed and will be geocoded on demand server-side. Picking from the
              list is simply better — it stores an exact coordinate reference. */}
          <Field label="Port of loading">
            <SearchSelect
              path="/geo-places"
              value={f.pol}
              placeholder="Shanghai"
              getKey={(r) => String(r.geo_place_id)}
              getLabel={(r) => [r.name, r.country].filter(Boolean).join(" · ")}
              onSelect={(r) => {
                set("pol", String(r.name));
                setPolPlaceId(String(r.geo_place_id));
              }}
              allowFreeText
              onFreeText={(t) => {
                set("pol", t);
                setPolPlaceId(null);
              }}
            />
          </Field>
          <Field label="Port of discharge">
            <SearchSelect
              path="/geo-places"
              value={f.pod}
              placeholder="Douala"
              getKey={(r) => String(r.geo_place_id)}
              getLabel={(r) => [r.name, r.country].filter(Boolean).join(" · ")}
              onSelect={(r) => {
                set("pod", String(r.name));
                setPodPlaceId(String(r.geo_place_id));
              }}
              allowFreeText
              onFreeText={(t) => {
                set("pod", t);
                setPodPlaceId(null);
              }}
            />
          </Field>
          <Field label="Incoterm">
            <Input value={f.incoterm} onChange={(e) => set("incoterm", e.target.value)} placeholder="CIF" />
          </Field>
          <Field label="Customs regime">
            <Input value={f.customs_regime} onChange={(e) => set("customs_regime", e.target.value)} />
          </Field>
          <Field label="BL / MAWB" className="sm:col-span-2">
            <Input value={f.bl_mawb} onChange={(e) => set("bl_mawb", e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!f.entity_id || busy}
          onCancel={onClose}
          saveLabel={isNew ? "Create file" : "Save changes"}
        />
      </form>
    </Dialog>
  );
}
