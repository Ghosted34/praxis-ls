/**
 * Service type — create/edit modal.
 *
 * Extracted from the (formerly monolithic) service-types.tsx so the list shell,
 * the 360° dossier and this form each read on their own. `key` is intentionally
 * absent from the update path: it's the stable machine identifier referenced by
 * `dictionary_item.service_type_key` and stamped onto the Control Tower map's
 * transport mode, so renaming would orphan every reference silently
 * (service_type.validator.js:9). Display names stay freely editable.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

export function ServiceTypeForm({
  row,
  onClose,
  onSaved,
}: {
  row: api.ServiceType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const [f, setF] = React.useState({
    key: row?.key ?? "",
    name_fr: row?.name_fr ?? "",
    name_en: row?.name_en ?? "",
    territory: row?.territory ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        await api.createServiceType({
          key: f.key.trim().toUpperCase(),
          name_fr: f.name_fr,
          name_en: f.name_en || undefined,
          territory: f.territory || undefined,
        });
      } else {
        // `key` is intentionally absent: it's the stable identifier referenced by
        // dictionary_item.service_type_key, so renaming would orphan references.
        await api.updateServiceType(row!.service_type_id, {
          name_fr: f.name_fr,
          name_en: f.name_en || null,
          territory: f.territory || null,
        });
      }
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
      title={isNew ? "New service type" : "Edit service type"}
      description="A service you sell. Dossiers are classified by it, and each one carries its own milestone chain."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Key" required className={isNew ? "" : "opacity-60"}>
            <Input
              value={f.key}
              onChange={(e) => set("key", e.target.value.toUpperCase())}
              placeholder="SEA_FREIGHT_IMPORT"
              disabled={!isNew}
            />
            {isNew ? (
              <p className="micro mt-1">Permanent identifier, SCREAMING_SNAKE. Cannot be changed later.</p>
            ) : (
              <p className="micro mt-1">Fixed — other records reference this key.</p>
            )}
          </Field>
          <Field label="Territory">
            <Select value={f.territory} onChange={(e) => set("territory", e.target.value)}>
              <option value="">—</option>
              {api.TERRITORIES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name (FR)" required>
            <Input value={f.name_fr} onChange={(e) => set("name_fr", e.target.value)} placeholder="Fret maritime import" />
          </Field>
          <Field label="Name (EN)">
            <Input value={f.name_en} onChange={(e) => set("name_en", e.target.value)} placeholder="Sea freight import" />
          </Field>
        </div>
        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !f.name_fr || (isNew && !f.key)}>
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
