/**
 * Attaching documents while the file is being created.
 *
 * WHY THIS IS THE THIRD STEP AND NOT A LATER ERRAND. Legacy could only upload
 * after save (`upload.php` requires an existing ref), so in practice the
 * paperwork arrived days later or not at all — the person holding the bill of
 * lading is the person filling in the form, and once they leave the screen the
 * moment is gone. The draft dossier exists by the time this renders, so an
 * upload here is an ordinary upload with a real `dossier_id`.
 *
 * THE TYPE IS A REGISTRY VALUE, AND A NEW ONE CAN BE ADDED FROM HERE. A hard
 * list would be wrong within a month: tenants meet documents Praxis has never
 * heard of, and the answer to "there is no type for this" must not be "pick
 * Other and put it in the filename". So the picker searches `DOCUMENT_TYPE` and
 * offers to create what was typed — the TYPE is reusable from then on, on every
 * file, while each uploaded FILE stays its own vault row.
 *
 * LIMITS ARE LEGACY'S, AND THE SERVER IS THE AUTHORITY. 5 MB, PDF/PNG/JPG. The
 * checks here are a courtesy so the person is told before a slow upload rather
 * than after; the server sniffs the actual bytes, which is the check that counts.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { FileDrop } from "@/components/ui/file-drop";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import {
  listDictRefs,
  createDictRef,
  uploadVaultDocument,
  type DictRef,
} from "@/lib/masterdata-api";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg";
const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
];

/** Attached in this session — the vault is the record, this is the receipt. */
export type AttachedDoc = { doc_id: string; name: string; type: string };

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file"));
    r.readAsDataURL(file);
  });

export function DossierDocuments({
  dossierId,
  clientId,
  attached,
  onAttached,
}: {
  dossierId: string;
  clientId?: string | null;
  attached: AttachedDoc[];
  onAttached: (doc: AttachedDoc) => void;
}) {
  const toast = useToast();
  const types = useResource<DictRef[]>(() => listDictRefs("DOCUMENT_TYPE"), []);
  const [typeId, setTypeId] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Adding a type inline, without leaving a half-filled file for Settings.
  const [newType, setNewType] = React.useState<{
    code: string;
    name: string;
  } | null>(null);

  const active = (types.data || []).filter((t) => t.is_active !== false);

  // Told before the upload, not after — the server checks the bytes themselves,
  // but a person should not wait through a transfer to be refused.
  const fileError = !file
    ? null
    : file.size > MAX_BYTES
      ? `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`
      : file.type && !ACCEPTED_TYPES.includes(file.type)
        ? "Only PDF, PNG and JPG can be attached to a file."
        : null;

  async function addType() {
    if (!newType?.code.trim() || !newType.name.trim()) return;
    setBusy(true);
    try {
      const row = await createDictRef({
        kind: "DOCUMENT_TYPE",
        code: newType.code
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_"),
        name_fr: newType.name.trim(),
      });
      await types.reload();
      setTypeId(row.ref_id);
      setNewType(null);
      toast.success("Document type added — it is available on every file now");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!file || fileError) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await uploadVaultDocument({
        data_url: await readAsDataUrl(file),
        dossier_id: dossierId,
        doc_type_ref_id: typeId || undefined,
        client_id: clientId || undefined,
        original_name: file.name,
        entity_ref: `dossier:${dossierId}`,
      });
      const t = active.find((x) => x.ref_id === typeId);
      onAttached({
        doc_id: doc.doc_id,
        name: file.name,
        type: t ? t.name_en || t.name_fr : "Untyped",
      });
      setFile(null);
      setTypeId("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Document type"
          hint="Not listed? Add it — it stays available on every file."
        >
          <div className="flex gap-2">
            <Select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              aria-label="Document type"
            >
              <option value="">—</option>
              {active.map((t) => (
                <option key={t.ref_id} value={t.ref_id}>
                  {t.name_en || t.name_fr}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setNewType({ code: "", name: "" })}
            >
              + New
            </Button>
          </div>
        </Field>
        <FileDrop
          file={file}
          onPick={setFile}
          accept={ACCEPT}
          label="File"
          hint="PDF, PNG or JPG — up to 5 MB."
          error={fileError}
        />
      </div>

      {newType && (
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="CODE (e.g. APEC)"
              aria-label="New document type code"
              value={newType.code}
              onChange={(e) =>
                setNewType((s) => ({
                  ...s!,
                  code: e.target.value.toUpperCase(),
                }))
              }
            />
            <Input
              placeholder="Name (e.g. Attestation de Prise en Charge)"
              aria-label="New document type name"
              value={newType.name}
              onChange={(e) =>
                setNewType((s) => ({ ...s!, name: e.target.value }))
              }
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setNewType(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" loading={busy} onClick={addType}>
              Add type
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          loading={busy}
          disabled={!file || !!fileError || busy}
          onClick={upload}
        >
          Attach
        </Button>
      </div>

      {error && <ErrorState message={error} />}

      {attached.length > 0 && (
        <ul className="space-y-1" aria-label="Attached documents">
          {attached.map((d) => (
            <li
              key={d.doc_id}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"
            >
              <Pill tone="ok">{d.type}</Pill>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {d.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
