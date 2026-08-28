/**
 * The operations-file picker. One of them, for the whole system.
 *
 * ── WHAT IT REPLACES ────────────────────────────────────────────────────────
 *
 * A `<select>` of bare references:
 *
 *     SBX-2026-0001
 *     SBX-2026-0004
 *     SL-7Z3K9QW2M4XB-SM
 *
 * Nobody recognises a file that way. An operator raising a delivery note knows
 * it as "the Brasseries beer export, the one on ET901" — the client, what is on
 * it, and the air waybill they have been quoting all week. The reference is the
 * one thing they have to look up, and it was the only thing on offer.
 *
 * ── WHAT A ROW SHOWS, AND WHY EACH PART EARNS ITS PLACE ─────────────────────
 *
 *   reference     what the file is called everywhere else, so the pick is
 *                 verifiable against an email or a printed sheet
 *   client        which customer — the first thing anybody narrows by
 *   title         the short name the file was opened with ("Export of Beer").
 *                 Optional on the file, and the reason it exists.
 *   service       Sea Freight Export / Air Freight Import. Decides what the
 *                 document downstream will even ask for.
 *   B/L or AWB    the transport reference, because that is what a client quotes
 *                 down the phone and what a driver has on his paperwork
 *   opened        the date, to separate this year's file from last year's when
 *                 a repeat customer ships the same commodity every quarter
 *
 * ── SEARCHING ───────────────────────────────────────────────────────────────
 *
 * The server already matches the reference, the client name, the B/L and the
 * vessel/flight (`operations_file.repo.listPaged`), including the canonical
 * spelling of a reference typed with or without its separators. So typing any
 * of those finds the file; this component sends the term and renders the rows.
 */
import { SearchSelect } from "@/components/ui/search-select";
import type { Row } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { Dossier } from "@/lib/operations-api";

/** What a picked file is, to the screen that picked it. */
export type PickedFile = {
  dossier_id: string;
  ref: string;
  client_name?: string | null;
  title?: string | null;
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function OperationsFilePicker({
  value,
  onSelect,
  label = "Operations file",
  placeholder,
  disabled,
  id,
  /** Narrow the list — e.g. to one entity, or to files that move goods. */
  filter,
}: {
  /** The reference of the currently-picked file, shown on the closed control. */
  value?: string | null;
  onSelect: (file: PickedFile, row: Dossier) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  filter?: (row: Dossier) => boolean;
}) {
  return (
    <SearchSelect
      id={id}
      path="/operations"
      value={value || ""}
      label={label}
      placeholder={placeholder || tr("Search by reference, client, B/L or AWB…")}
      disabled={disabled}
      filter={filter as ((row: Row) => boolean) | undefined}
      /*
       * The CLOSED control shows the reference and the client, because that is
       * the shortest phrase that identifies a file unambiguously. It is also
       * what the client-side narrowing matches on, so a term that found the row
       * keeps finding it.
       */
      getLabel={(r) => [str(r.ref), str(r.client_name)].filter(Boolean).join(" · ")}
      getKey={(r) => str(r.dossier_id)}
      onSelect={(r) => {
        const row = r as unknown as Dossier;
        onSelect(
          {
            dossier_id: str(row.dossier_id),
            ref: str(row.ref),
            client_name: row.client_name ?? null,
            title: row.title ?? null,
          },
          row,
        );
      }}
      renderRow={(r) => {
        const row = r as unknown as Dossier;
        const service = row.service_name_en || row.service_name_fr || row.service_key;
        // The transport reference, whichever this mode calls it. A file carries
        // one or the other, never both, so there is nothing to disambiguate.
        const transport = row.bl_mawb || row.vessel_flight;
        return (
          <span className="block min-w-0">
            <span className="flex items-baseline justify-between gap-2">
              <span className="num truncate font-medium text-foreground">{str(row.ref)}</span>
              {row.created_at && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateFmt(row.created_at)}
                </span>
              )}
            </span>
            <span className="block truncate text-foreground">{str(row.client_name) || "—"}</span>
            {row.title && (
              <span className="block truncate text-xs text-muted-foreground">{row.title}</span>
            )}
            <span className="block truncate text-xs text-muted-foreground">
              {[service, transport].filter(Boolean).join(" · ")}
            </span>
          </span>
        );
      }}
    />
  );
}
