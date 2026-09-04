/**
 * The cash-request worksheet's line grid and its footer.
 *
 * ── WHAT MAKES THIS GRID DIFFERENT FROM THE COSTING'S ──────────────────────
 *
 * Four money columns, not one. A costing line answers "what will this cost";
 * a cash-request line answers "how much of that am I taking now, and how much
 * is left" — so every row carries its budget, what is already claimed against
 * it, what this request wants, and what remains. That last figure is the whole
 * point of the module and it has to be on the row, next to the input, not in a
 * panel somewhere the person editing the number will not look.
 *
 * Lines are TICKED, not deleted. The request is seeded with every claimable
 * budget line, and the ordinary act is to untick the ones this request is not
 * for — deleting them would lose the budget context and make adding one back a
 * hunt. An unticked line is simply not sent.
 *
 * ── WHAT THE CATALOGUE DECIDES ─────────────────────────────────────────────
 *
 * An imported line's identity belongs to the budget line: its description and
 * its charge are locked, because `costing_line_id` is what says they are the
 * same thing. Its AMOUNT stays editable — a partial claim is the normal case —
 * and so does its justification tick, which may be raised above the catalogue's
 * requirement but never lowered below it.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { Panel } from "@/components/ui/panel";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { money } from "@/lib/format";
import { tr } from "@/lib/i18n";
import {
  computeTotals,
  isOverBudget,
  lineAmount,
  lineClaim,
  lineRemainingAfter,
  type LineDraft,
} from "./cash-request-model";

/* ── The grid ──────────────────────────────────────────────────────────────── */

export function CashLineGrid({
  lines,
  currency,
  readOnly,
  onChange,
}: {
  lines: LineDraft[];
  currency: string;
  readOnly: boolean;
  onChange: (next: LineDraft[]) => void;
}) {
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // A budgeted line shows its balance; a manual overhead line has none, so the
  // budget columns are omitted entirely rather than printed as dashes.
  const budgeted = lines.some((l) => l.remaining !== undefined);

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            {!readOnly && <TH className="w-10" />}
            <TH>{tr("Charge")}</TH>
            <TH className="w-20 text-right">{tr("Qty")}</TH>
            <TH className="w-32 text-right">{tr("Unit cost (TTC)")}</TH>
            {budgeted && <TH className="w-32 text-right">{tr("Budget")}</TH>}
            {budgeted && <TH className="w-32 text-right">{tr("Available")}</TH>}
            <TH className="w-32 text-right">{tr("This request")}</TH>
            {budgeted && <TH className="w-32 text-right">{tr("Remaining")}</TH>}
            <TH className="w-16 text-center">
              <Tooltip content={tr("A receipt must come back for this line")}>
                <span>{tr("Just.")}</span>
              </Tooltip>
            </TH>
          </TR>
        </THead>
        <TBody>
          {lines.map((l, i) => {
            const claim = lineClaim(l);
            const after = lineRemainingAfter(l);
            const over = isOverBudget(l);
            const dim = !l.picked ? "opacity-45" : "";
            return (
              <TR key={l.cash_request_line_id || l.costing_line_id || `new-${i}`} className={dim}>
                {!readOnly && (
                  <TD>
                    <Checkbox
                      // Same trade `DataList` makes for its selection column: a
                      // visible label would cost a column's width to say what
                      // the control already says, and `tap-24` is the WCAG 2.2
                      // §2.5.8 floor for a 16px box in a compact row.
                      className="[&>button]:mt-0 [&>button]:tap-24"
                      checked={l.picked}
                      onCheckedChange={(v) => setLine(i, { picked: v === true })}
                      label={
                        <span className="sr-only">
                          {tr("Include this line in the request")} — {l.label || `${tr("line")} ${i + 1}`}
                        </span>
                      }
                    />
                  </TD>
                )}
                <TD>
                  {/* Locked to the budget line: `costing_line_id` is what says
                      the claim and the budget are the same thing. */}
                  {l.costing_line_id || readOnly ? (
                    <span className="text-sm font-medium text-foreground">{l.label || "—"}</span>
                  ) : (
                    <Input
                      value={l.label}
                      onChange={(e) => setLine(i, { label: e.target.value })}
                      placeholder={tr("What the money is for")}
                      aria-label={`${tr("Description")} — ${tr("line")} ${i + 1}`}
                    />
                  )}
                  <p className="micro mt-0.5 flex flex-wrap items-center gap-1.5">
                    {l.is_disbursement && <Pill tone="mute">{tr("Débours")}</Pill>}
                    {l.costing_line_id && <Pill tone="blue">{tr("From the budget")}</Pill>}
                    {over && <Pill tone="bad">{tr("Over budget")}</Pill>}
                  </p>
                </TD>
                <TD className="text-right">
                  {readOnly ? (
                    <span className="num">{l.qty}</span>
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="num text-right"
                      value={String(l.qty)}
                      onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                      aria-label={`${tr("Quantity")} — ${l.label || i + 1}`}
                    />
                  )}
                </TD>
                <TD className="text-right">
                  {readOnly ? (
                    <span className="num">{money(l.unit_cost, currency)}</span>
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="num text-right"
                      value={String(l.unit_cost)}
                      onChange={(e) => setLine(i, { unit_cost: Number(e.target.value) })}
                      aria-label={`${tr("Unit cost (TTC)")} — ${l.label || i + 1}`}
                    />
                  )}
                </TD>
                {budgeted && (
                  <TD className="num text-right text-muted-foreground">
                    {l.budget === undefined ? "—" : money(l.budget, currency)}
                  </TD>
                )}
                {budgeted && (
                  <TD className="num text-right text-muted-foreground">
                    {l.remaining === undefined ? "—" : money(l.remaining, currency)}
                  </TD>
                )}
                <TD className="num text-right font-medium tabular-nums">
                  {money(claim, currency)}
                  {l.vat_percent ? (
                    <span className="micro block">{tr("net")} {money(lineAmount(l), currency)}</span>
                  ) : null}
                </TD>
                {budgeted && (
                  <TD
                    className={`num text-right tabular-nums ${
                      over ? "font-medium text-[rgb(var(--bad))]" : "text-muted-foreground"
                    }`}
                  >
                    {after === null ? "—" : money(after, currency)}
                  </TD>
                )}
                <TD className="text-center">
                  <Checkbox
                    className="justify-center [&>button]:mt-0 [&>button]:tap-24"
                    checked={l.justification_required}
                    disabled={readOnly}
                    onCheckedChange={(v) => setLine(i, { justification_required: v === true })}
                    label={
                      <span className="sr-only">
                        {tr("A receipt must come back for this line")} — {l.label || `${tr("line")} ${i + 1}`}
                      </span>
                    }
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

/* ── The footer ────────────────────────────────────────────────────────────── */

/**
 * What this request adds up to, over the TICKED lines only. An unticked line is
 * not part of this request, so counting it would make the footer disagree with
 * what is about to be submitted.
 *
 * Subtotal and VAT appear only when there IS one. The amounts a cash request
 * claims are the costing's own TTC figures, so on every request raised since
 * that changed the VAT row is zero and the subtotal restates the total — three
 * rows saying one thing, which is how a reader learns to skip a footer. A
 * request approved before it still shows its breakdown, because that is what
 * was approved.
 */
export function CashTotalsFooter({
  lines,
  currency,
}: {
  lines: LineDraft[];
  currency: string;
}) {
  const t = React.useMemo(() => computeTotals(lines), [lines]);
  const row = (label: string, value: number, grand = false) => (
    <div className={`flex items-baseline justify-between ${grand ? "border-t border-border pt-2" : ""}`}>
      <span className={grand ? "text-sm font-medium text-foreground" : "micro"}>{label}</span>
      <span className={`num tabular-nums ${grand ? "text-lg font-semibold text-foreground" : "text-sm"}`}>
        {money(value, currency)}
      </span>
    </div>
  );
  return (
    <Panel title={tr("Amount requested")}>
      <div className="space-y-2">
        {t.vat_total > 0 && row(tr("Subtotal"), t.subtotal)}
        {t.vat_total > 0 && row(tr("VAT"), t.vat_total)}
        {row(tr("TOTAL PAYABLE"), t.total_payable, true)}
      </div>
    </Panel>
  );
}
