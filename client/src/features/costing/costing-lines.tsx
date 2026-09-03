/**
 * The costing worksheet's line grid, its VAT panel and its footer.
 *
 * Split out of the sheet because the sheet is already the largest screen in the
 * module and these three are one concern: what the file will cost, line by
 * line, and what that adds up to.
 *
 * ── WHAT THE CATALOGUE DECIDES, AND WHAT THE USER DECIDES ──────────────────
 *
 * The legacy sheet asked the user to tick a VAT box per line, and it defaulted
 * to ticked. The supplied sample sheet shows the result: `#-1047 Customs Duties
 * & Taxes` charged 19.25% VAT, on a customs duty, which is a disbursement and
 * can never carry our output tax. So nature and VAT are DERIVED here — from the
 * dictionary item the line was picked from — and the controls that would let
 * you contradict the catalogue are disabled with the reason shown, not hidden.
 * The database agrees: `chk_disbursement_no_tax` refuses a pass-through line
 * carrying a tax code.
 *
 * ── FLAT, NOT GROUPED ──────────────────────────────────────────────────────
 *
 * Lines render in `line_no` order and nothing else. Grouping by the dictionary
 * `subcategory` was considered and dropped (Q14): a costing is read as a total,
 * and sub-headings turn a fourteen-row sheet into five sections of three.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { Pill } from "@/components/ui/pill";
import { Panel } from "@/components/ui/panel";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DictionaryFinder } from "@/components/dictionary-finder";
import type { DictSearchHit } from "@/lib/masterdata-api";
import type { EquipmentPick } from "@/components/equipment-step";
import { money } from "@/lib/format";
import { tr } from "@/lib/i18n";
import {
  BLANK_LINE,
  computeTotals,
  defaultVatCode,
  deboursVatFromRate,
  lineKey,
  withVatDefault,
  type LineDraft,
} from "./costing-model";

/* ── The grid ──────────────────────────────────────────────────────────────── */

export function LineGrid({
  lines,
  dossierId,
  serviceTypeId,
  currency,
  vatCodes,
  readOnly,
  onChange,
}: {
  lines: LineDraft[];
  dossierId?: string | null;
  /** Scopes the charge picker to this file's service. Without it the finder
   *  offers all 165 catalogue items instead of the ~20 mapped to this service —
   *  which is what it did before this screen passed it. */
  serviceTypeId?: string | null;
  currency: string;
  vatCodes: { tax_code_id: string; code: string; rate_percent?: number | null }[];
  readOnly: boolean;
  onChange: (next: LineDraft[]) => void;
}) {
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const replaceLine = (i: number, line: LineDraft) =>
    onChange(lines.map((l, j) => (j === i ? line : l)));

  /** The VAT control's default — TVA_STD (12768). Every VAT box a new line is
   *  born with lands here unless the catalogue or the user says otherwise. */
  const defaultTax = defaultVatCode(vatCodes);

  /** Patch a line and, if it is a rate-priced débours, re-derive its VAT from
   *  the new net — so changing a quantity or unit cost keeps the VAT honest. */
  const setLineCalc = (i: number, patch: Partial<LineDraft>) => {
    const merged = { ...lines[i], ...patch };
    if (merged.is_disbursement && merged.vat_mode !== "AMOUNT" && merged.upstream_vat_rate_percent != null) {
      merged.upstream_vat_amount = deboursVatFromRate(merged, merged.upstream_vat_rate_percent);
    }
    replaceLine(i, merged);
  };

  /** Box 1: pick a rate (or No VAT) — the amount follows from the net. */
  const setDeboursRate = (i: number, value: string) => {
    const rate = value === "" ? 0 : Number(value);
    setLine(i, {
      vat_mode: "RATE",
      upstream_vat_rate_percent: rate,
      upstream_vat_amount: deboursVatFromRate(lines[i], rate),
    });
  };

  /** Toggle a débours between the rate box (default) and the free-text amount. */
  const switchDeboursMode = (i: number, mode: "RATE" | "AMOUNT") => {
    const l = lines[i];
    if (mode === "AMOUNT") {
      setLine(i, {
        vat_mode: "AMOUNT",
        upstream_vat_rate_percent: null,
        // Carry the current figure across so switching does not blank it.
        upstream_vat_amount:
          l.upstream_vat_amount ?? deboursVatFromRate(l, l.upstream_vat_rate_percent ?? (defaultTax?.rate_percent ?? 19.25)),
      });
    } else {
      const rate = l.upstream_vat_rate_percent ?? (defaultTax?.rate_percent ?? 19.25);
      setLine(i, {
        vat_mode: "RATE",
        upstream_vat_rate_percent: rate,
        upstream_vat_amount: deboursVatFromRate(l, rate),
      });
    }
  };

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  /** One pick of an equipment-varying charge becomes one line PER container
   *  type — the reason 0632 moved equipment off the catalogue and onto the
   *  rate, and why our sheet has 14 lines where legacy's had 18. */
  const pickMulti =
    (at: number) =>
    (id: string, label: string, hit: DictSearchHit, picks: EquipmentPick[]) => {
      const made: LineDraft[] = picks.map((p) =>
        // A picked line is born here, so it gets the TVA_STD default (12768) —
        // rate mode for a débours, the standard code for a service line.
        withVatDefault(
          {
            ...BLANK_LINE,
            dictionary_item_id: id,
            label,
            is_disbursement: hit.is_disbursement === true,
            container_type_ref_id: p.container_type_ref_id,
            container_type_label: p.label,
            qty: p.qty || 1,
          },
          defaultTax,
        ));
      if (!made.length) return;
      onChange([...lines.slice(0, at), ...made, ...lines.slice(at + 1)]);
    };

  const pickOne = (i: number) => (id: string, label: string, hit?: DictSearchHit) =>
    replaceLine(
      i,
      withVatDefault(
        {
          ...lines[i],
          dictionary_item_id: id || undefined,
          label: id ? label : "",
          // Nature comes from the catalogue, not from a checkbox the user ticks.
          is_disbursement: id ? hit?.is_disbursement === true : false,
          container_type_ref_id: undefined,
          container_type_label: undefined,
          // Clear the previous VAT decision so the default re-applies for the
          // line's new nature (a service line just turned débours, or back).
          tax_code_id: undefined,
          tax_rate_percent: undefined,
          upstream_vat_rate_percent: undefined,
          upstream_vat_amount: undefined,
          vat_mode: undefined,
        },
        defaultTax,
      ));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH className="w-10">#</TH>
              <TH>{tr("Charge")}</TH>
              <TH className="w-24 text-right">{tr("Qty")}</TH>
              <TH className="w-32 text-right">{tr("Unit cost")}</TH>
              <TH className="w-44">{tr("VAT")}</TH>
              <TH className="w-32 text-right">{tr("Amount")}</TH>
              {!readOnly && <TH className="w-24" />}
            </TR>
          </THead>
          <TBody>
            {lines.map((l, i) => {
              const amount = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
              return (
                <TR key={`${lineKey(l)}-${i}`}>
                  <TD className="num text-muted-foreground">{i + 1}</TD>
                  <TD>
                    {readOnly ? (
                      <span className="text-sm font-medium text-foreground">
                        {l.label || "—"}
                        {l.container_type_label && (
                          <Pill tone="blue" className="ml-2">
                            {l.container_type_label}
                          </Pill>
                        )}
                      </span>
                    ) : (
                      <DictionaryFinder
                        value={l.dictionary_item_id}
                        valueLabel={l.label}
                        dossierId={dossierId || null}
                        serviceTypeId={serviceTypeId || null}
                        onPick={pickOne(i)}
                        onPickMulti={pickMulti(i)}
                        placeholder={tr("Search a charge…")}
                      />
                    )}
                    <p className="micro mt-0.5 flex flex-wrap items-center gap-1.5">
                      {l.item_code && <span className="num">{l.item_code}</span>}
                      {l.is_disbursement && <Pill tone="mute">{tr("Débours")}</Pill>}
                      {l.container_type_label && !readOnly && (
                        <Pill tone="blue">{l.container_type_label}</Pill>
                      )}
                      {l.price_note && <span>{l.price_note}</span>}
                    </p>
                  </TD>
                  <TD className="text-right">
                    {readOnly ? (
                      <span className="num">{l.qty ?? "—"}</span>
                    ) : (
                      <Input
                        type="number"
                        className="num text-right"
                        aria-label={`${tr("Quantity")} — ${l.label || tr("line")} ${i + 1}`}
                        value={l.qty === null ? "" : String(l.qty)}
                        // Blank is a real state: a per-day charge has no
                        // quantity anything on the file can supply, and a
                        // plausible wrong number gets approved.
                        placeholder={tr("Qty")}
                        onChange={(e) =>
                          setLineCalc(i, {
                            qty: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    )}
                  </TD>
                  <TD className="text-right">
                    {readOnly ? (
                      <span className="num">{money(l.unit_cost ?? 0, currency)}</span>
                    ) : (
                      <Input
                        type="number"
                        className="num text-right"
                        aria-label={`${tr("Unit cost")} — ${l.label || tr("line")} ${i + 1}`}
                        value={l.unit_cost === null ? "" : String(l.unit_cost)}
                        placeholder={tr("Needs a price")}
                        onChange={(e) =>
                          setLineCalc(i, {
                            unit_cost:
                              e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    )}
                  </TD>
                  <TD>
                    {l.is_disbursement ? (
                      // 12768: a débours is a pass-through, but its supplier VAT
                      // is now BUDGETED — so instead of "not taxed" the cell
                      // carries the two boxes the VAT is entered through: a rate
                      // (default, TVA_STD) whose amount follows the net, or a
                      // free-text amount for the rare bill that is not a clean
                      // rate. (PT) marks it pass-through in both.
                      readOnly ? (
                        <span className="num">
                          {l.upstream_vat_amount != null && l.upstream_vat_amount > 0
                            ? `${money(l.upstream_vat_amount, currency)} `
                            : ""}
                          <span className="micro">{tr("(PT)")}</span>
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <Segmented
                            label={`${tr("VAT entry")} — ${l.label || tr("line")} ${i + 1}`}
                            value={l.vat_mode || "RATE"}
                            options={[
                              { value: "RATE", label: tr("Rate") },
                              { value: "AMOUNT", label: tr("Amount") },
                            ]}
                            onChange={(m) => switchDeboursMode(i, m as "RATE" | "AMOUNT")}
                          />
                          {(l.vat_mode || "RATE") === "RATE" ? (
                            <Select
                              value={
                                l.upstream_vat_rate_percent == null
                                  ? "0"
                                  : String(l.upstream_vat_rate_percent)
                              }
                              aria-label={`${tr("VAT rate")} — ${l.label || tr("line")} ${i + 1}`}
                              onChange={(e) => setDeboursRate(i, e.target.value)}
                            >
                              <option value="0">{tr("No VAT")}</option>
                              {vatCodes.map((c) => (
                                <option key={c.tax_code_id} value={String(c.rate_percent ?? 0)}>
                                  {c.code}
                                  {c.rate_percent != null ? ` (${c.rate_percent}%)` : ""}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Input
                              type="number"
                              className="num text-right"
                              aria-label={`${tr("VAT amount")} — ${l.label || tr("line")} ${i + 1}`}
                              placeholder={tr("VAT amount")}
                              value={
                                l.upstream_vat_amount == null
                                  ? ""
                                  : String(l.upstream_vat_amount)
                              }
                              onChange={(e) =>
                                setLine(i, {
                                  vat_mode: "AMOUNT",
                                  upstream_vat_rate_percent: null,
                                  upstream_vat_amount:
                                    e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                            />
                          )}
                          <span className="micro text-muted-foreground">{tr("Pass-through (PT)")}</span>
                        </div>
                      )
                    ) : readOnly ? (
                      <span className="num">
                        {l.tax_rate_percent != null ? `${l.tax_rate_percent}%` : "—"}
                      </span>
                    ) : (
                      <Select
                        value={l.tax_code_id || ""}
                        aria-label={`${tr("VAT code")} — ${l.label || tr("line")} ${i + 1}`}
                        onChange={(e) => {
                          const code = vatCodes.find(
                            (c) => c.tax_code_id === e.target.value,
                          );
                          setLine(i, {
                            tax_code_id: e.target.value || null,
                            tax_rate_percent: code?.rate_percent ?? null,
                          });
                        }}
                      >
                        <option value="">{tr("No VAT")}</option>
                        {vatCodes.map((c) => (
                          <option key={c.tax_code_id} value={c.tax_code_id}>
                            {c.code}
                            {c.rate_percent != null ? ` (${c.rate_percent}%)` : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </TD>
                  <TD className="num text-right">{money(amount, currency)}</TD>
                  {!readOnly && (
                    <TD>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${tr("Move up")} — ${tr("line")} ${i + 1}`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${tr("Move down")} — ${tr("line")} ${i + 1}`}
                          disabled={i === lines.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${tr("Remove")} — ${tr("line")} ${i + 1}`}
                          onClick={() => onChange(lines.filter((_, j) => j !== i))}
                        >
                          ✕
                        </Button>
                      </div>
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
      {/* 12768: the upstream-VAT figures used to live in a separate panel below
          the grid. They are now the two boxes in each débours line's VAT cell,
          so what a reader sees on the line is what the total is built from. */}
    </div>
  );
}

/* ── The VAT panel and the footer ──────────────────────────────────────────── */

/**
 * VAT, grouped by rate, with the reason each untaxed line is untaxed.
 *
 * A single "VAT: 192,500" line cannot be checked. Grouped by rate against the
 * base it was charged on, it can be — and the untaxed bucket is where a
 * mis-classified line shows up.
 */
export function VatPanel({
  lines,
  currency,
}: {
  lines: LineDraft[];
  currency: string;
}) {
  const bands = new Map<string, { rate: number; base: number; vat: number }>();
  let passThrough = 0;
  let passThroughVat = 0;
  let noCode = 0;
  for (const l of lines) {
    const amt = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
    if (l.is_disbursement) {
      passThrough += amt;
      // 12768: a débours now carries VAT, and it is in the total. Kept in its
      // own (PT) row rather than folded into the rate bands so a reader can see
      // how much of the VAT is the supplier's, re-billed at cost.
      passThroughVat += Number(l.upstream_vat_amount) || 0;
      continue;
    }
    const rate = Number(l.tax_rate_percent) || 0;
    if (!l.tax_code_id) {
      noCode += amt;
      continue;
    }
    const k = String(rate);
    const b = bands.get(k) || { rate, base: 0, vat: 0 };
    b.base += amt;
    b.vat += (amt * rate) / 100;
    bands.set(k, b);
  }
  const r = (n: number) => Math.round(n * 100) / 100;

  return (
    <Panel title={tr("VAT")}>
      <Table>
        <THead>
          <TR>
            <TH>{tr("Rate")}</TH>
            <TH className="text-right">{tr("Base")}</TH>
            <TH className="text-right">{tr("VAT")}</TH>
          </TR>
        </THead>
        <TBody>
          {[...bands.values()]
            .sort((a, b) => b.rate - a.rate)
            .map((b) => (
              <TR key={b.rate}>
                <TD>{b.rate}%</TD>
                <TD className="num text-right">{money(r(b.base), currency)}</TD>
                <TD className="num text-right">{money(r(b.vat), currency)}</TD>
              </TR>
            ))}
          {noCode > 0 && (
            <TR>
              <TD>
                {tr("No VAT code")}
                <p className="micro">{tr("No tax code picked on these lines.")}</p>
              </TD>
              <TD className="num text-right">{money(r(noCode), currency)}</TD>
              <TD className="num text-right">—</TD>
            </TR>
          )}
          {passThrough > 0 && (
            <TR>
              <TD>
                {tr("Débours (PT)")}
                <p className="micro">
                  {tr("Re-billed at cost; the VAT is the supplier's, budgeted into the total.")}
                </p>
              </TD>
              <TD className="num text-right">{money(r(passThrough), currency)}</TD>
              <TD className="num text-right">
                {passThroughVat > 0 ? money(r(passThroughVat), currency) : "—"}
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </Panel>
  );
}

/** The footer: the legacy sheet's three figures, with débours VAT now inside
 *  them and named as a memo below (12768). */
export function TotalsFooter({
  lines,
  currency,
}: {
  lines: LineDraft[];
  currency: string;
}) {
  const t = computeTotals(lines);
  return (
    <div className="space-y-2">
      <KpiRow>
        <KpiTile
          label={tr("Subtotal (HT)")}
          value={money(t.total_ht, currency)}
          hint={
            t.disbursement_total > 0
              ? `${tr("of which débours")} ${money(t.disbursement_total, currency)}`
              : undefined
          }
        />
        <KpiTile
          label={tr("VAT")}
          value={money(t.vat_total, currency)}
          hint={
            t.upstream_vat_total > 0
              ? `${tr("of which on débours (PT)")} ${money(t.upstream_vat_total, currency)}`
              : undefined
          }
        />
        <KpiTile
          label={tr("Total estimate")}
          value={money(t.total_ttc, currency)}
        />
      </KpiRow>
      {t.upstream_vat_total > 0 && (
        <p className="micro">
          <span className="num">{money(t.upstream_vat_total, currency)}</span>{" "}
          {tr(
            "of the VAT is the supplier's own on débours (PT), re-billed at cost and budgeted into the total.",
          )}
        </p>
      )}
    </div>
  );
}
