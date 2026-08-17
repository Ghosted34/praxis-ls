/**
 * "+ Add carrier", from inside the file you are opening.
 *
 * WHY IT IS INLINE AND NOT A TRIP TO SETTINGS. A booking arrives naming a
 * haulier nobody has priced before. The alternative to this dialog is: abandon
 * the half-filled file, find Master data → Expense rates → Carriers, add the
 * row, come back, re-enter everything. In practice what happens instead is that
 * the clerk picks the nearest-looking carrier, and the file is wrong in a way
 * that only shows up when the rate resolves against somebody else's rate card.
 *
 * FOUR FIELDS, AND NO MORE. Name, kind, country, SCAC/IATA. Everything else on
 * `rate_provider` has a sensible default, and a modal that asked for sort order
 * mid-booking would be answered with whatever dismisses it fastest.
 *
 * The code is derived from the name the same way 0634's backfill does
 * (`upper(regexp_replace(name,'[^A-Za-z0-9]+','_','g'))`), so a carrier added
 * here and the same carrier added by the migration collide on the unique key
 * instead of becoming two rows.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { FormButtons } from "@/components/ui/form-buttons";
import { ErrorState } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import { countries } from "@praxis/shared";
import {
  createRateProvider,
  CARRIER_KINDS,
  type RateProvider,
  type RateProviderKind,
} from "@/lib/masterdata-api";

const KIND_LABEL: Record<RateProviderKind, string> = {
  SHIPPING_LINE: "Shipping line",
  AIRLINE: "Airline",
  TRUCKING: "Haulier (road)",
  RAIL: "Rail",
  BARGE: "Barge",
  COURIER: "Courier",
  PORT_AUTHORITY: "Port authority",
  CUSTOMS_AUTHORITY: "Customs authority",
  OTHER: "Other",
};

/** Same rule as 0634's backfill, so the two cannot mint two rows for one name. */
export const codeFromName = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

export function CarrierQuickAdd({
  open,
  initialName,
  kinds,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** What the user had typed in the picker when they gave up searching. */
  initialName?: string;
  /** The kinds the field accepts. One kind is preselected and the choice
   *  hidden — asking "is this a haulier?" on a field that only takes hauliers
   *  is a question with one answer. */
  kinds?: string[];
  onClose: () => void;
  onCreated: (row: RateProvider) => void;
}) {
  const allowed = React.useMemo(
    () => (kinds?.length ? (kinds as RateProviderKind[]) : CARRIER_KINDS),
    [kinds],
  );
  const [name, setName] = React.useState(initialName || "");
  const [kind, setKind] = React.useState<RateProviderKind>(allowed[0]);
  const [country, setCountry] = React.useState("");
  const [carrierCode, setCarrierCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(initialName || "");
    setKind(allowed[0]);
    setCountry("");
    setCarrierCode("");
    setError(null);
  }, [open, initialName, allowed]);

  const code = codeFromName(name);
  const canSubmit = !!name.trim() && !!code && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = await createRateProvider({
        kind,
        code,
        name: name.trim(),
        carrier_code: carrierCode.trim() || null,
        country_code: country || null,
      });
      onCreated(row);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Add carrier"
      description="Added to the carrier registry — available on every file and every rate card afterwards."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("Name")}
            required
            className="sm:col-span-2"
            hint={code ? `Stored as ${code}` : undefined}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sotramaf"
            />
          </Field>
          {/* One allowed kind means no question to ask. */}
          {allowed.length > 1 && (
            <Field label={tr("Kind")} required>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as RateProviderKind)}
              >
                {allowed.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k] || k}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={tr("Country")}>
            <Select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">—</option>
              {countries.COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="SCAC / IATA"
            hint="The carrier's trade code, if it has one — shown beside the name in pickers."
          >
            <Input
              value={carrierCode}
              onChange={(e) => setCarrierCode(e.target.value.toUpperCase())}
              placeholder="MAEU"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={!canSubmit}
          onCancel={onClose}
          saveLabel="Add carrier"
        />
      </form>
    </Modal>
  );
}
