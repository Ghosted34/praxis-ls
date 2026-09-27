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
 * CORE, THEN "MORE CHARGES" (meeting 5, 01:36:48 → 01:42:48). The dialog used
 * to open on a Basic / Advanced / Full choice; the tenant found that one more
 * decision than the job needs. It now opens with the service's CORE charges
 * ticked, and every other charge mapped to the service sits unticked in one
 * collapsed, searchable "More charges for this service" section. There is no
 * tier vocabulary left on this screen; the dictionary's "Core for this
 * service" tick decides which list a charge is in.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useResource } from "@/lib/use-resource";
import { amount, dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import * as api from "@/lib/costing-api";
import { suggestionKey as keyOf } from "./costing-model";
import { dictLabel } from "@/lib/dict-label";

/** The line's name in the reader's language (lib/dict-label). */
const labelOf = (l: api.SuggestedLine) =>
  dictLabel({ label_en: l.label_en ?? l.label, label_fr: l.label_fr }) || l.label;



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
  // Converted into the sheet's currency: say from what, so an EUR figure on an
  // XAF rate card is never a mystery to the approver.
  const from =
    l.source_unit_cost != null && l.source_currency
      ? ` · ${amount(l.source_unit_cost)} ${l.source_currency}`
      : "";
  return withFrom(scopeNote(l, carrier), from);
}
const withFrom = (note: string | null, from: string) => (note ? note + from : from ? from.slice(3) : null);

function scopeNote(l: api.SuggestedLine, carrier: string | null): string | null {
  if (l.price_source === "NONE") return null;
  if (l.price_source === "NO_FX") return tr("No exchange rate on file to convert this rate");
  if (l.price_source === "CATALOGUE_DEFAULT") return tr("Catalogue default");
  const eff = l.effective_from ? `, ${tr("from")} ${dateFmt(l.effective_from)}` : "";
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
}: {
  line: api.SuggestedLine;
  checked: boolean;
  onToggle: (next: boolean) => void;
  carrier: string | null;
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
            {labelOf(line)}
            {line.container_type_label ? ` — ${line.container_type_label}` : ""}
          </span>
        }
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="num micro text-muted-foreground">{line.item_code}</span>
          <span className="text-sm font-medium text-foreground">{labelOf(line)}</span>
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
          // No currency on the line: the dialog's heading names the sheet's.
          <span className="num text-sm text-foreground">{amount(line.unit_cost)}</span>
        )}
      </div>
    </div>
  );
}

export function SuggestDialog({
  dossierId,
  currency,
  exchangeRate = 1,
  /** Codes already on the sheet. Suggest TOPS UP: a charge you have already is
   *  offered unticked with its state named, never silently re-added and never
   *  overwriting what you typed into it. */
  existingKeys,
  onImport,
  onClose,
}: {
  dossierId: string;
  currency: string;
  /** The sheet's one rate (1 <currency> = rate XAF); prices arrive converted. */
  exchangeRate?: number;
  existingKeys: Set<string>;
  onImport: (lines: api.SuggestedLine[]) => void;
  onClose: () => void;
}) {
  // Always the whole mapped set: CORE lines are offered ticked, everything else
  // sits unticked under "More charges" (meeting 5 — no Basic/Advanced/Full
  // choice to make before you can see anything).
  const res = useResource(
    () =>
      api.suggestCostingLines(dossierId, "FULL", {
        currency,
        exchangeRateToXaf: exchangeRate,
      }),
    [dossierId, currency, exchangeRate],
  );
  const d = res.data;

  const core = React.useMemo(
    () => (d ? d.bands.filter((b) => b.tier === "BASIC").flatMap((b) => b.lines) : []),
    [d],
  );
  const extras = React.useMemo(
    () => (d ? d.bands.filter((b) => b.tier !== "BASIC").flatMap((b) => b.lines) : []),
    [d],
  );

  /*
   * THE UNSELECT BUG (meeting 5, 01:40:51 — "unselect all doesn't work, and
   * unselecting a line does not even go"). The sheet hands in a NEW Set of
   * existing keys on every render, and the effect that ticks the default lines
   * depended on it — so every click re-rendered the sheet, re-ran the effect,
   * and ticked everything again. The keys are read through a ref now, and the
   * default ticking runs once per suggestion, when it arrives.
   */
  const existingRef = React.useRef(existingKeys);
  existingRef.current = existingKeys;
  const onSheet = (l: api.SuggestedLine) => existingRef.current.has(keyOf(l));

  const [picked, setPicked] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (!d) return;
    const next = new Set<string>();
    for (const l of d.bands.filter((b) => b.tier === "BASIC").flatMap((b) => b.lines))
      if (!existingRef.current.has(keyOf(l))) next.add(keyOf(l));
    setPicked(next);
  }, [d]);

  const sel = picked ?? new Set<string>();
  const toggle = (k: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const allLines = React.useMemo(() => [...core, ...extras], [core, extras]);
  const chosen = allLines.filter((l) => sel.has(keyOf(l)));

  const toggleMany = (lines: api.SuggestedLine[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      for (const l of lines) {
        // An already-present charge stays out of a bulk tick — "select all"
        // must not quietly re-add the line you edited an hour ago.
        if (onSheet(l)) continue;
        if (on) next.add(keyOf(l));
        else next.delete(keyOf(l));
      }
      return next;
    });

  // "More charges" is closed until asked for — or open from the start when the
  // service has no core lines at all, so the dialog is never an empty box.
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const showMore = moreOpen || (!!d && core.length === 0) || q.trim() !== "";
  const needle = q.trim().toLowerCase();
  const shownExtras = needle
    ? extras.filter((l) =>
        [labelOf(l), l.label_fr, l.label_en, l.item_code, l.container_type_label]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)),
      )
    : extras;

  const group = (title: string, lines: api.SuggestedLine[], id: string) => {
    const selectable = lines.filter((l) => !onSheet(l));
    const on = selectable.filter((l) => sel.has(keyOf(l))).length;
    return (
      <section className="space-y-2" aria-labelledby={id}>
        <div className="flex items-center justify-between gap-3 border-b pb-1">
          <Checkbox
            checked={on === 0 ? false : on === selectable.length ? true : "indeterminate"}
            onCheckedChange={(next) => toggleMany(lines, next)}
            disabled={!selectable.length}
            label={
              <span id={id} className="text-sm font-semibold">
                {title}
              </span>
            }
          />
          <span className="micro">
            {on}/{selectable.length} {tr("selected")}
          </span>
        </div>
        <div className="space-y-1.5">
          {lines.map((l) => {
            const k = keyOf(l);
            return onSheet(l) ? (
              <div
                key={k}
                className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">
                  {labelOf(l)}
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
                carrier={d?.file.rate_provider_name ?? null}
              />
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      // The sheet's one currency, named once — the lines below carry none.
      title={`${tr("Suggest charges")} · ${currency}`}
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

        {d && core.length > 0 && (
          <>
            <p className="micro">
              {tr("The core charges for this service are ticked. Untick what this file does not need.")}
            </p>
            {group(tr("Core charges"), core, "suggest-core")}
          </>
        )}

        {d && extras.length > 0 && (
          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showMore}
              aria-controls="suggest-more"
              onClick={() => setMoreOpen((o) => !o)}
            >
              {showMore ? "▾" : "▸"} {tr("More charges for this service")} ({extras.length})
            </Button>
            {showMore && (
              <div id="suggest-more" className="space-y-2">
                <Input
                  aria-label={tr("Search more charges")}
                  placeholder={tr("Search a charge…")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {shownExtras.length ? (
                  group(tr("More charges"), shownExtras, "suggest-more-title")
                ) : (
                  <p className="micro">{tr("No charge matches that search.")}</p>
                )}
              </div>
            )}
          </div>
        )}

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
