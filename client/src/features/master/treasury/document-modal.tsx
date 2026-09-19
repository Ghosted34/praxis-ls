import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { ErrorState } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/treasury-api";

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
  const [docType, setDocType] = React.useState<api.TreasuryDocument["document_type"]>("BANK_RIB");
  const [title, setTitle] = React.useState("");
  const [docNum, setDocNum] = React.useState("");
  const [issueDate, setIssueDate] = React.useState("");
  const [expiryDate, setExpiryDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDocType("BANK_RIB");
    setTitle("Bank RIB / Attestation");
    setDocNum("");
    setIssueDate("");
    setExpiryDate("");
    setNotes("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.addDocument(accountId, {
        document_type: docType,
        title: title.trim(),
        document_number: docNum.trim() || null,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        notes: notes.trim() || null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Attach Treasury Document" description="Attach bank RIB, mandate, KYC or signature card">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document Type" required>
            <Select value={docType} onChange={(e) => {
              const v = e.target.value as api.TreasuryDocument["document_type"];
              setDocType(v);
              if (v === "BANK_RIB") setTitle("Bank RIB / Attestation");
              else if (v === "BANK_MANDATE") setTitle("Bank Mandate");
              else if (v === "KYC_DOCUMENT") setTitle("KYC / Identity Document");
              else if (v === "SIGNATURE_CARD") setTitle("Signature Card");
              else if (v === "ACCOUNT_LETTER") setTitle("Account Opening Letter");
            }}>
              <option value="BANK_RIB">Bank RIB / Attestation</option>
              <option value="BANK_MANDATE">Bank Mandate</option>
              <option value="KYC_DOCUMENT">KYC / Identity Document</option>
              <option value="SIGNATURE_CARD">Signature Card</option>
              <option value="ACCOUNT_LETTER">Account Opening Letter</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label={tr("Title")} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Document Number">
            <Input value={docNum} onChange={(e) => setDocNum(e.target.value)} placeholder="RIB-2026-..." />
          </Field>
          <Field label="Issue Date">
            <DateField value={issueDate} onChange={setIssueDate} />
          </Field>
          <Field label="Expiry Date">
            <DateField value={expiryDate} onChange={setExpiryDate} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || busy}>Attach</Button>
        </div>
      </div>
    </Modal>
  );
}
