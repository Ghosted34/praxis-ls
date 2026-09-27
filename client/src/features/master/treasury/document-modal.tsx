/**
 * Attach a treasury document — the RECORD (type, number, dates) and, optionally,
 * the FILE behind it.
 *
 * Meeting 5 (21 Sep 2026): the form could register a bank RIB but had no way to
 * attach the RIB itself. The file now goes through the upload engine like every
 * other scan in the product: preview the moment the picker closes, compression,
 * a 0→100% bar, and an explicit "Upload complete" before the modal closes.
 *
 * Deferred (`autoStart: false`): the vault file is filed against the document
 * record, which does not exist until Save — so Save creates the record, THEN
 * sends the bytes (`send` reads the new id from a ref), then links the returned
 * vault id onto the record. The file stays optional: a mandate you are holding
 * is still worth registering before it has been scanned.
 *
 * Expiry is optional too; when set, the dossier and the treasury list warn
 * 60 days out (the corporate-entity renewal ladder).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { ErrorState } from "@/components/ui/states";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { useUpload } from "@/lib/use-upload";
import { SCAN_ACCEPT, scanFileProblem } from "@/lib/vault-file";
import { uploadVaultFile } from "@/lib/masterdata-api";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/treasury-api";

type DocType = api.TreasuryDocument["document_type"];

const TYPES: { value: DocType; label: string }[] = [
  { value: "BANK_RIB", label: "Bank RIB / Attestation" },
  { value: "BANK_MANDATE", label: "Bank Mandate" },
  { value: "KYC_DOCUMENT", label: "KYC / Identity Document" },
  { value: "SIGNATURE_CARD", label: "Signature Card" },
  { value: "ACCOUNT_LETTER", label: "Account Opening Letter" },
  { value: "OTHER", label: "Other" },
];

/** The vault doc type every treasury scan is filed under (MOD-09 reads it). */
export const TREASURY_VAULT_TYPE = "TREASURY_DOCUMENT";

export function DocumentModal({
  open,
  onClose,
  accountId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onSaved: () => void;
}) {
  const [docType, setDocType] = React.useState<DocType>("BANK_RIB");
  const [title, setTitle] = React.useState("");
  const [docNum, setDocNum] = React.useState("");
  const [issueDate, setIssueDate] = React.useState("");
  const [expiryDate, setExpiryDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Set once the record exists, so a failed upload retried from the list does
  // not register the document a second time.
  const savedRef = React.useRef<api.TreasuryDocument | null>(null);

  const upload = useUpload<{ doc_id: string }>({
    profile: "document",
    autoStart: false,
    send: (file, ctx) =>
      uploadVaultFile(
        file,
        {
          doc_type: TREASURY_VAULT_TYPE,
          entity_ref: `treasury_account_document:${savedRef.current?.document_id}`,
          original_name: file.name,
        },
        ctx,
      ),
  });
  const { reset } = upload;
  const item = upload.items[0] ?? null;

  React.useEffect(() => {
    if (!open) return;
    setDocType("BANK_RIB");
    setTitle(tr("Bank RIB / Attestation"));
    setDocNum("");
    setIssueDate("");
    setExpiryDate("");
    setNotes("");
    setError(null);
    savedRef.current = null;
    reset();
  }, [open, reset]);

  function pick(files: FileList | null) {
    const file = files?.[0];
    setError(null);
    if (!file) return;
    const problem = scanFileProblem(file);
    if (problem) return setError(problem);
    reset();
    void upload.pick([file]);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!savedRef.current) {
        savedRef.current = await api.addDocument(accountId, {
          document_type: docType,
          title: title.trim(),
          document_number: docNum.trim() || null,
          issue_date: issueDate || null,
          expiry_date: expiryDate || null,
          notes: notes.trim() || null,
        });
      }
      if (item) {
        const res = await upload.start();
        const vaulted = res.results[0];
        if (!res.ok || !vaulted) {
          // The record is saved; only the file failed. Say so, keep the modal
          // open with the retry the list offers, and let the dossier refresh.
          onSaved();
          setError(
            tr("The document is saved, but the file did not upload. Retry it below, or attach it later from the Documents tab."),
          );
          return;
        }
        await api.attachDocumentScan(accountId, savedRef.current.document_id, {
          vault_id: vaulted.doc_id,
          file_name: item.file.name,
          file_size: item.bytes,
          mime_type: (item.prepared ?? item.file).type || null,
        });
      }
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
      open={open}
      onClose={onClose}
      title={tr("Attach Treasury Document")}
      description={tr("Bank RIB, mandate, KYC or signature card — with the scan, if you have it.")}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Document Type")} required>
            <Select
              value={docType}
              disabled={!!savedRef.current}
              onChange={(e) => {
                const v = e.target.value as DocType;
                setDocType(v);
                const hit = TYPES.find((t) => t.value === v);
                if (hit && v !== "OTHER") setTitle(tr(hit.label));
              }}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {tr(t.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Title")} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!savedRef.current} />
          </Field>
          <Field label={tr("Document Number")}>
            <Input
              value={docNum}
              onChange={(e) => setDocNum(e.target.value)}
              placeholder="RIB-2026-..."
              disabled={!!savedRef.current}
            />
          </Field>
          <Field label={tr("Issue Date")}>
            <DateField value={issueDate} onChange={setIssueDate} />
          </Field>
          <Field
            label={tr("Expiry Date")}
            hint={tr("Optional. The account warns 60 days before it lapses.")}
          >
            <DateField value={expiryDate} onChange={setExpiryDate} min={issueDate || undefined} />
          </Field>
          <Field label={tr("Notes")}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <Field label={tr("File")} hint={tr("Optional — PDF or a photo, up to 25 MB.")}>
          <div className="space-y-2">
            {!item && (
              <FilePicker
                accept={SCAN_ACCEPT}
                label={tr("Choose the scan")}
                disabled={busy}
                onPick={pick}
              />
            )}
            <UploadList
              items={upload.items}
              onRemove={upload.remove}
              onRetry={upload.retry}
            />
          </div>
        </Field>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!title.trim() || busy || upload.busy}
          >
            {item ? tr("Attach and upload") : tr("Attach")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
