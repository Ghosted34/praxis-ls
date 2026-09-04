/**
 * Suggest — the standard charge set for an operations file, offered for picking.
 *
 * WHY IT IS A PREVIEW AND NOT AN INSERT. The legacy sheet had a Suggest button
 * that loaded every line for the service straight onto the worksheet
 * (costing-module.php:1896-1975), and the sample sheet it produced has eighteen
 * rows of which several were deleted by hand afterwards. The lines that need a
 * human — the ones with no rate on file, and the per-day charges nothing can
 * count — are exactly the ones you want to see BEFORE they are on your sheet,
 * not after.
 *
 * WHY ONE LIST WITH BANDS AND NOT THREE TABS. The tiers NEST: BASIC ⊆ ADVANCED
 * ⊆ FULL (0630). Three tabs would show Ocean Freight under all three, which is
 * not a presentation choice — it is the UI lying about the data. One list, three
 * bands, a master checkbox per band, and the tier control decides how far down
 * the long tail the list goes.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useResource } from "@/lib/use-resource";
import { money } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import * as api from "@/lib/costing-api";
import { suggestionKey as keyOf } from "./costing-model";

type Tier = "BASIC" | "ADVANCED" | "FULL";


/** Why this quantity, in words a person can check. */
const BASIS_NOTE: Record<api.SuggestedLine["qty_basis"], string> = {
  CONTAINERS: "one line per container type on the file",
  GROSS_WEIGHT: "from the file's gross weight",
  VOLUME: "from the file's volume",
  PACKAGES: "from the file's package count",
  DEFAULT: "once per file",
  TYPED: "nothing on the file can tell us — type it",
};

/** Where the price came from. A rate scoped to no carrier is the item's
 *  fallback, NOT this carrier's price, and saying so stops "MSC rate card"
 *  appearing beside a number MSC never quoted. */
function priceNote(l: api.SuggestedLine, carrier: string | null): string | null {
  if (l.price_source === "NONE") return null;
  if (l.price_source === "CATALOGUE_DEFAULT") return tr("Catalogue default");
  const eff = l.effective_from ? `, from ${l.effective_from}` : "";
  if (l.rate_scope === "CARRIER_AND_TYPE")
    return `${carrier || tr("Carrier")} · ${l.container_type_code}${eff}`;
  if (l.rate_scope === "CARRIER") return `${carrier || tr("Carrier")}${eff}`;
  if (l.rate_scope === "TYPE") return `${l.container_type_code}${eff}`;
  return tr("Default rate") + eff;
}

function LineRow({
  line,
  checked,
  onToggle,
  carrier,
  currency,
}: {
  line: api.SuggestedLine;
  checked: boolean;
  onToggle: (next: boolean) => void;
  carrier: string | null;
  currency: string;
}) {
  const note = priceNote(line, carrier);
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border px-3 py-2",
        checked ? "bg-card" : "bg-muted/30 opacity-70",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        // The accessible name has to identify WHICH line, because a screen
        // reader hearing "Demurrage" twice on one file cannot tell the 45' from
        // the 40'. The visible label is the row body beside it.
        label={
          <span className="sr-only">
            {line.label}
            {line.container_type_label ? ` — ${line.container_type_label}` : ""}
          </span>
        }
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="num micro text-muted-foreground">{line.item_code}</span>
          <span className="text-sm font-medium text-foreground">{line.label}</span>
          {line.container_type_label && (
            <Pill tone="blue">{line.container_type_label}</Pill>
          )}
          {line.is_disbursement ? (
            <Pill tone="mute">{tr("Débours")}</Pill>
          ) : line.tax_rate_percent != null ? (
            <Pill tone="mute">{`${tr("VAT")} ${line.tax_rate_percent}%`}</Pill>
          ) : (
            <Pill tone="mute">{tr("No VAT")}</Pill>
          )}
        </div>
        <p className="micro mt-0.5">
          {line.qty === null
            ? tr("Quantity: ") + BASIS_NOTE.TYPED
            : `${tr("Qty")} ${line.qty} — ${BASIS_NOTE[line.qty_basis]}`}
          {note ? ` · ${note}` : ""}
        </p>
      </div>
      <div className="text-right">
        {line.unit_cost === null ? (
          <Pill tone="warn">{tr("Needs a price")}</Pill>
        ) : (
          <span className="num text-sm text-foreground">
            {money(line.unit_cost, line.currency || currency)}
          </span>
        )}
      </div>
    </div>
  );
}

export function SuggestDialog({
  dossierId,
  currency,
  /** Codes already on the sheet. Suggest TOPS UP: a charge you have already is
   *  offered unticked with its state named, never silently re-added and never
   *  overwriting what you typed into it. */
  existingKeys,
  onImport,
  onClose,
}: {
  dossierId: string;
  currency: string;
  existingKeys: Set<string>;
  onImport: (lines: api.SuggestedLine[]) => void;
  onClose: () => void;
}) {
  const [tier, setTier] = React.useState<Tier>("ADVANCED");
  const res = useResource(
    () => api.suggestCostingLines(dossierId, tier),
    [dossierId, tier],
  );
  const d = res.data;

  // Ticked by default, minus anything already on the sheet. Re-derived whenever
  // the tier changes, because the line set itself changes with it.
  const [picked, setPicked] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (!d) return;
    const next = new Set<string>();
    for (const band of d.bands)
      for (const l of band.lines) if (!existingKeys.has(keyOf(l))) next.add(keyOf(l));
    setPicked(next);
  }, [d, existingKeys]);

  const sel = picked ?? new Set<string>();
  const toggle = (k: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const allLines = React.useMemo(
    () => (d ? d.bands.flatMap((b) => b.lines) : []),
    [d],
  );
  const chosen = allLines.filter((l) => sel.has(keyOf(l)));

  const toggleBand = (lines: api.SuggestedLine[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      for (const l of lines) {
        // An already-present charge stays out of a bulk tick — "select all"
        // must not quietly re-add the line you edited an hour ago.
        if (existingKeys.has(keyOf(l))) continue;
        if (on) next.add(keyOf(l));
        else next.delete(keyOf(l));
      }
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={tr("Suggest charges")}
      description={
        d
          ? `${d.file.service_name_en || d.file.service_type_key || ""}${
              d.file.rate_provider_name ? ` · ${d.file.rate_provider_name}` : ""
            }${
              d.file.containers.length
                ? ` · ${d.file.containers.map((c) => `${c.qty}×${c.code}`).join(", ")}`
                : ""
            }`
          : tr("The standard charge set for this file's service.")
      }
    >
      <div className="space-y-4">
        <Segmented
          label={tr("How much of the catalogue to offer")}
          value={tier}
          options={[
            { value: "BASIC", label: tr("Basic") },
            { value: "ADVANCED", label: tr("Advanced") },
            { value: "FULL", label: tr("Full") },
          ]}
          onChange={(v) => setTier(v as Tier)}
        />
        <p className="micro">
          {tr(
            "The bands nest — Advanced includes Basic, Full includes both. Everything is ticked; untick what this file does not need.",
          )}
        </p>

        {res.loading && <SkeletonTable rows={6} cols={3} />}
        {res.error && (
          <ScreenError
            message={res.error}
            what="Suggested charges"
            onRetry={res.reload}
          />
        )}

        {d && !allLines.length && (
          <EmptyState
            title={tr("No charges mapped to this service yet")}
            hint="Map charges to this service type in Settings → Financial Dictionary, and they will be offered here."
          />
        )}

        {d &&
          d.bands.map((band) => {
            const selectable = band.lines.filter((l) => !existingKeys.has(keyOf(l)));
            const on = selectable.filter((l) => sel.has(keyOf(l))).length;
            return (
              <section key={band.tier} className="space-y-2">
                <div className="flex items-center justify-between gap-3 border-b pb-1">
                  <Checkbox
                    checked={
                      on === 0
                        ? false
                        : on === selectable.length
                          ? true
                          : "indeterminate"
                    }
                    onCheckedChange={(next) => toggleBand(band.lines, next)}
                    disabled={!selectable.length}
                    label={
                      <span className="text-sm font-semibold">
                        {tr(band.tier === "BASIC" ? "Basic" : band.tier === "ADVANCED" ? "Advanced" : "Full")}
                      </span>
                    }
                  />
                  <span className="micro">
                    {on}/{selectable.length} {tr("selected")}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {band.lines.map((l) => {
                    const k = keyOf(l);
                    const already = existingKeys.has(k);
                    return already ? (
                      <div
                        key={k}
                        className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2"
                      >
                        <span className="text-sm text-muted-foreground">
                          {l.label}
                          {l.container_type_label ? ` — ${l.container_type_label}` : ""}
                        </span>
                        <Pill tone="ok">{tr("Already on the sheet")}</Pill>
                      </div>
                    ) : (
                      <LineRow
                        key={k}
                        line={l}
                        checked={sel.has(k)}
                        onToggle={(next) => toggle(k, next)}
                        carrier={d.file.rate_provider_name}
                        currency={currency}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}

        {d && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="micro space-y-0.5">
              {d.counts.needs_price > 0 && (
                <p>
                  {d.counts.needs_price} {tr("line(s) have no rate on file — you will price them.")}
                </p>
              )}
              {d.counts.needs_quantity > 0 && (
                <p>
                  {d.counts.needs_quantity} {tr("line(s) need a quantity only you can know.")}
                </p>
              )}
              {/* A franchise-regime entity is offered no VAT at all. Saying so
                  stops the sheet looking broken. */}
              {!d.defaults.tax_code_id && (
                <p>
                  {d.defaults.vat_regime
                    ? `${tr("No VAT offered — this entity is on the")} ${d.defaults.vat_regime} ${tr("regime.")}`
                    : tr("No VAT offered — no sales tax code is effective for this entity.")}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {tr("Cancel")}
              </Button>
              <Button
                disabled={!chosen.length}
                onClick={() => {
                  onImport(chosen);
                  onClose();
                }}
              >
                {chosen.length === 1
                  ? tr("Import 1 line")
                  : `${tr("Import")} ${chosen.length} ${tr("lines")}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
