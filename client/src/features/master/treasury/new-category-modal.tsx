/**
 * "+ New treasury category" — the inline dialog that lets a treasurer add a
 * type of account beyond the five seeded ones (BANK / CASH / PETTY_CASH /
 * MTN_MOMO / ORANGE_MONEY). Called from NewAccountModal's category picker
 * ("Airtel SmartCash — add it") and standalone from the Categories tab.
 *
 * The CoA parent field is a class-5 non-postable code (e.g. 5383 for a new
 * MoMo network). The backend validates class + non-postable; we surface the
 * error text as-is so nobody has to memorise the constraint.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/treasury-api";

type Kind = "BANK" | "CASH" | "MOMO";

export function NewCategoryModal({
  open,
  onClose,
  onCreated,
  presetKind,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: api.TreasuryCategory) => void;
  /** When invoked from the account form ("Add MTN-like network"), pre-seed the
   *  kind and pre-check MoMo identity so the treasurer types only the code +
   *  label + 4-digit parent. */
  presetKind?: Kind;
}) {
  const [code, setCode] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [legacyKind, setLegacyKind] = React.useState<Kind>(
    presetKind ?? "MOMO",
  );
  const [parent, setParent] = React.useState("");
  const [reqCust, setReqCust] = React.useState(false);
  const [bankIdentity, setBankIdentity] = React.useState(false);
  const [momoIdentity, setMomoIdentity] = React.useState(presetKind === "MOMO");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setLabel("");
    setParent("");
    setLegacyKind(presetKind ?? "MOMO");
    setReqCust(false);
    setBankIdentity(false);
    setMomoIdentity(presetKind === "MOMO");
    setError(null);
  }, [open, presetKind]);

  // When kind switches, prime the flags to what "most rows of this kind" carry
  // — the treasurer can uncheck if their case is unusual.
  React.useEffect(() => {
    setBankIdentity(legacyKind === "BANK");
    setMomoIdentity(legacyKind === "MOMO");
    if (legacyKind !== "CASH") setReqCust(false);
  }, [legacyKind]);

  const canSubmit = !!code.trim() && !!label.trim() && !!parent.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createCategory({
        code: code.trim().toUpperCase(),
        label: label.trim(),
        legacy_kind: legacyKind,
        coa_parent_code: parent.trim(),
        requires_custodian: reqCust,
        is_bank_identity: bankIdentity,
        is_momo_identity: momoIdentity,
      });
      onCreated(created);
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
      title="New treasury category"
      description="A treasury account type — e.g. Airtel SmartCash, Wave, Trust account. Mapped to a class-5 CoA parent; new accounts of this type get a 6-digit leaf under it."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            required
            hint="UPPER_SNAKE (e.g. AIRTEL_SMART_CASH)"
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="AIRTEL_SMART_CASH"
            />
          </Field>
          <Field label="Label" required>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Airtel SmartCash"
            />
          </Field>
          <Field
            label="Kind"
            required
            hint="Wide bucket used by legacy readers"
          >
            <Select
              value={legacyKind}
              onChange={(e) => setLegacyKind(e.target.value as Kind)}
            >
              <option value="BANK">Bank</option>
              <option value="CASH">Cash</option>
              <option value="MOMO">Mobile Money</option>
            </Select>
          </Field>
          <Field
            label="CoA parent (class 5)"
            required
            hint="Non-postable class-5 code (e.g. 5383)"
          >
            <Input
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              placeholder="5383"
            />
          </Field>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="micro text-muted-foreground">
            Field groups the create form shows
          </div>
          <Checkbox
            checked={bankIdentity}
            onCheckedChange={(v) => setBankIdentity(v === true)}
            label="Bank identity (bank name, branch, account number, IBAN, SWIFT)"
          />
          <Checkbox
            checked={momoIdentity}
            onCheckedChange={(v) => setMomoIdentity(v === true)}
            label="Mobile-money identity (number, till, agent)"
          />
          <Checkbox
            checked={reqCust}
            onCheckedChange={(v) => setReqCust(v === true)}
            disabled={legacyKind !== "CASH"}
            label="Requires a custodian (petty cash floats)"
          />
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create category
          </Button>
        </div>
      </div>
    </Modal>
  );
}
