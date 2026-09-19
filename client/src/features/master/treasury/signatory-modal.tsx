import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { ErrorState } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/treasury-api";

export function SignatoryModal({
  open,
  onClose,
  accountId,
  currency,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  currency: string;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [sigType, setSigType] = React.useState<"PRIMARY" | "JOINT">("PRIMARY");
  const [ruleType, setRuleType] = React.useState<"SINGLE_SIGNATURE" | "JOINT_REQUIRED">("SINGLE_SIGNATURE");
  const [limit, setLimit] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFullName("");
    setEmail("");
    setPhone("");
    setRoleTitle("");
    setSigType("PRIMARY");
    setRuleType("SINGLE_SIGNATURE");
    setLimit("");
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setEffectiveTo("");
    setNotes("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.addSignatory(accountId, {
        full_name: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        role_title: roleTitle.trim() || null,
        signatory_type: sigType,
        rule_type: ruleType,
        limit_amount: limit ? Number(limit) : null,
        currency,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
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
    <Modal open={open} onClose={onClose} title="Add Authorized Signatory" description="Register a bank or account signatory and authorization rules">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full Name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Role / Title">
            <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Managing Director" />
          </Field>
          <Field label={tr("Email")}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </Field>
          <Field label={tr("Phone")}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+237 6..." />
          </Field>
          <Field label="Signatory Type" required>
            <Select value={sigType} onChange={(e) => setSigType(e.target.value as "PRIMARY" | "JOINT")}>
              <option value="PRIMARY">Primary Signatory</option>
              <option value="JOINT">Joint Signatory</option>
            </Select>
          </Field>
          <Field label="Signing Rule" required>
            <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as "SINGLE_SIGNATURE" | "JOINT_REQUIRED")}>
              <option value="SINGLE_SIGNATURE">Single Signature Authorized</option>
              <option value="JOINT_REQUIRED">Joint Signature Required</option>
            </Select>
          </Field>
          <Field label={`Spending Limit (${currency})`} hint="Leave blank for unlimited">
            <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 5000000" />
          </Field>
          <Field label="Effective From" required>
            <DateField value={effectiveFrom} onChange={setEffectiveFrom} />
          </Field>
          <Field label="Effective To" hint="Leave blank if indefinite">
            <DateField value={effectiveTo} onChange={setEffectiveTo} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!fullName.trim() || busy}>Save Signatory</Button>
        </div>
      </div>
    </Modal>
  );
}
