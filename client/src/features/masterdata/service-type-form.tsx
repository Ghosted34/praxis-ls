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
import { tr } from "@/lib/i18n";
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
    // ROUTE, not "", because the column is NOT NULL with that default — an
    // empty option here would offer a state the database does not have.
    enquiry_shape: (row?.enquiry_shape ?? "ROUTE") as api.EnquiryShape,
    ops_reference_code: row?.ops_reference_code ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Blank means "derive one from the key" — sending "" would fail the
      // two-character rule for a field the user never touched.
      const opsCode = f.ops_reference_code.trim().toUpperCase() || undefined;
      if (isNew) {
        await api.createServiceType({
          key: f.key.trim().toUpperCase(),
          name_fr: f.name_fr,
          name_en: f.name_en || undefined,
          territory: f.territory || undefined,
          enquiry_shape: f.enquiry_shape,
          ops_reference_code: opsCode,
        });
      } else {
        // `key` is intentionally absent: it's the stable identifier referenced by
        // dictionary_item.service_type_key, so renaming would orphan references.
        await api.updateServiceType(row!.service_type_id, {
          name_fr: f.name_fr,
          name_en: f.name_en || null,
          territory: f.territory || null,
          enquiry_shape: f.enquiry_shape,
          // Unchanged codes are not resent: the API refuses a change once a file
          // has used one, and echoing the same value would turn a name edit into
          // a rejected save on a service type that has been in use for months.
          ...(opsCode && opsCode !== (row!.ops_reference_code || "") ? { ops_reference_code: opsCode } : {}),
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
      description="A service you sell. Operations files are classified by it, and each one carries its own milestone chain."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Key")} required className={isNew ? "" : "opacity-60"}>
            <Input
              value={f.key}
              onChange={(e) => set("key", e.target.value.toUpperCase())}
              placeholder="SEA_FREIGHT_IMPORT"
              disabled={!isNew}
            />
            {isNew ? (
              <p className="micro mt-1">
                Permanent identifier, SCREAMING_SNAKE. Cannot be changed later.
              </p>
            ) : (
              <p className="micro mt-1">
                Fixed — other records reference this key.
              </p>
            )}
          </Field>
          <Field label={tr("Territory")}>
            <Select
              value={f.territory}
              onChange={(e) => set("territory", e.target.value)}
            >
              <option value="">—</option>
              {api.TERRITORIES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          {/* Sales-side, and deliberately next to Territory so the difference is
              visible: Territory is where the goods move, which routes a dossier.
              This is what a stranger is asked on the public quote form, and it
              is authored rather than guessed — the form used to infer it from
              the service key, so anything that was not warehousing demanded an
              origin, a destination and an Incoterm, including services that
              move nothing at all. */}
          <Field
            label={tr("Quote form asks for")}
            hint="What a visitor requesting this service has to tell you before the form will continue."
          >
            <Select
              value={f.enquiry_shape}
              onChange={(e) =>
                set("enquiry_shape", e.target.value as api.EnquiryShape)
              }
            >
              {api.ENQUIRY_SHAPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {tr(o.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name (FR)" required>
            <Input
              value={f.name_fr}
              onChange={(e) => set("name_fr", e.target.value)}
              placeholder="Fret maritime import"
            />
          </Field>
          <Field label={tr("Name (EN)")}>
            <Input
              value={f.name_en}
              onChange={(e) => set("name_en", e.target.value)}
              placeholder="Sea freight import"
            />
          </Field>
          {/*
            The two characters that CLOSE an operations file's reference —
            `SM` in `SL7Z3K9QW2M4XBSM`. Shown here rather than hidden because the
            business already reads these off legacy paperwork ("that's an SM
            file"), and because it is frozen the moment a file uses it: better to
            let someone set the code they actually use before that happens than
            to discover it afterwards.
          */}
          <Field label="Reference code">
            <Input
              value={f.ops_reference_code}
              onChange={(e) => set("ops_reference_code", e.target.value.toUpperCase().slice(0, 2))}
              placeholder={isNew ? "auto" : "SM"}
              maxLength={2}
            />
            <p className="micro mt-1">
              Closes this service&rsquo;s operation-file references, e.g.{" "}
              <span className="font-mono">SL7Z3K9QW2M4XB{f.ops_reference_code || "SM"}</span>. Leave blank to
              generate one. Fixed once a file has used it.
            </p>
          </Field>
        </div>
        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={busy || !f.name_fr || (isNew && !f.key)}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
